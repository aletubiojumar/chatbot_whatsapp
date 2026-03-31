// src/bot/index.js
require('dotenv').config({ override: true });
const express = require('express');
const bodyParser = require('body-parser');

const { processMessage } = require('./messageHandler');
const adapter = require('../channels/whatsappAdapter');
const { isDuplicate } = require('./dedup');
const { checkLimit } = require('./rateLimiter');
const { markAsRead } = require('./sendMessage');
const log = require('../utils/logger');
const conversationManager = require('./conversationManager');
const { startScheduler } = require('./reminderScheduler');
const { cleanOldLogs } = require('../utils/fileLogger');
const resourceMonitor = require('../utils/resourceMonitor');
const { getQueueStatus } = require('./peritolineAutoSync');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Token de verificación del webhook (string simple, NO el access token)
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

// ── Health checks ─────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WhatsApp Bot Jumar',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  const lastRes = resourceMonitor.getLastStats();
  res.json({
    status: 'healthy',
    gemini: {
      model: process.env.GEMINI_MODEL || 'n/a',
      key: Boolean(process.env.GEMINI_API_KEY),
    },
    whatsapp: {
      phoneNumberId: process.env.PHONE_NUMBER_ID,
      token: Boolean(process.env.USER_ACCESS_TOKEN),
    },
    resources: lastRes ? {
      cpuPct:      lastRes.cpuPct,
      ramFreeMB:   lastRes.mem.freeMB,
      ramTotalMB:  lastRes.mem.totalMB,
      ramFreePercent: lastRes.mem.freePercent,
      available:   lastRes.available,
      sampledAt:   new Date(lastRes.ts).toISOString(),
    } : null,
    peritolineQueue: getQueueStatus(),
    messageConcurrency: {
      active:  _activeMessages,
      waiting: _waitingSlots.length,
      max:     MAX_CONCURRENT_MESSAGES,
    },
  });
});

// ── Verificación del webhook (GET) ────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Verificación de Meta correcta');
    res.status(200).send(challenge);
  } else {
    console.warn('⚠️  Verificación de Meta fallida — token no coincide');
    res.sendStatus(403);
  }
});

// ── Semáforo global de concurrencia ──────────────────────────────────────────
// Limita el número de processMessage activos simultáneamente para evitar
// saturación de CPU/RAM cuando responden varios asegurados a la vez.
// Los mensajes que superen el límite esperan en cola hasta que se libere un slot.

const MAX_CONCURRENT_MESSAGES = Number(process.env.MAX_CONCURRENT_MESSAGES || 5);
let _activeMessages = 0;
const _waitingSlots = [];

function _acquireSlot() {
  return new Promise(resolve => {
    if (_activeMessages < MAX_CONCURRENT_MESSAGES) {
      _activeMessages++;
      resolve();
    } else {
      log.info(`⏳ Cola IA: ${_waitingSlots.length + 1} mensaje(s) esperando slot (${_activeMessages}/${MAX_CONCURRENT_MESSAGES} activos)`);
      _waitingSlots.push(resolve);
    }
  });
}

function _releaseSlot() {
  if (_waitingSlots.length > 0) {
    const next = _waitingSlots.shift();
    next(); // transfiere el slot al siguiente en espera sin decrementar
  } else {
    _activeMessages--;
  }
}

// ── Cola de procesamiento por usuario (evita respuestas duplicadas) ──────────
// Garantiza que los mensajes de un mismo usuario se procesen de forma secuencial.

const _userQueues = new Map();

function enqueueForUser(userId, fn) {
  const previous = _userQueues.get(userId) || Promise.resolve();
  const next = previous.then(fn).catch(() => {});
  _userQueues.set(userId, next);
  next.then(() => {
    if (_userQueues.get(userId) === next) _userQueues.delete(userId);
  });
}

// ── Recepción de eventos (POST) ───────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  // Responder 200 inmediatamente para evitar reintentos de Meta
  res.sendStatus(200);

  const body = req.body;

  // Ignorar eventos que no sean de whatsapp_business_account
  if (body?.object !== 'whatsapp_business_account') return;

  const msg = adapter.normalizeIncoming(body);
  if (!msg) return; // status updates, notificaciones, etc.

  // Solo procesamos texto y ubicación; el resto se transforma en una señal
  // técnica para que la IA responda siguiendo el prompt.
  if (msg.type !== 'text' && msg.type !== 'location') {
    const originalType = msg.type;
    log.info(`📎 Tipo de mensaje no soportado [${msg.type}] de ${log.maskPhone(msg.userId)}`);
    msg.type = 'text';
    msg.text = `[SISTEMA: MENSAJE_NO_COMPATIBLE tipo=${originalType || 'desconocido'}]`;
  }

  // Marcar como leído
  markAsRead(msg.messageId).catch(() => {});

  // ── Deduplicación ─────────────────────────────────────────────────────
  if (isDuplicate(msg.channel, msg.userId, msg.messageId)) {
    log.info(`⏭️  Duplicado ignorado [${log.maskPhone(msg.userId)}] msgId:${msg.messageId}`);
    return;
  }

  // ── Rate limiting ──────────────────────────────────────────────────────
  const rl = checkLimit(msg.userId);
  if (!rl.allowed) {
    log.warn(`🚫 Rate limit [${rl.reason}] usuario:${log.maskPhone(msg.userId)}`);
    return;
  }

  const logPreview = msg.type === 'location'
    ? `[ubicación GPS lat=${msg.location?.latitude} lon=${msg.location?.longitude}]`
    : `"${msg.text.slice(0, 60)}${msg.text.length > 60 ? '[…]' : ''}"`;
  log.info(`📥 Recibido de [${log.maskPhone(msg.userId)}]: ${logPreview}`);;

  enqueueForUser(msg.userId, async () => {
    await _acquireSlot();
    try {
      await processMessage(msg.userId, msg);
    } catch (err) {
      log.error('❌ Error procesando mensaje:', err);
    } finally {
      _releaseSlot();
    }
  });
});

// ── Arranque ──────────────────────────────────────────────────────────────

(async () => {
  // Migrar bot_state.xlsx → DynamoDB si existe (primera vez con DynamoDB configurado)
  await conversationManager.init();

  const server = app.listen(PORT, HOST, () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     🤖 WhatsApp Bot Jumar — MODO WHATSAPP IA              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`✅ Bot escuchando en ${HOST}:${PORT}`);
    console.log(`🌐 Health: http://${HOST}:${PORT}/health`);
    console.log(`📱 Phone Number ID: ${process.env.PHONE_NUMBER_ID}`);
    console.log(`🔑 Token configurado: ${Boolean(process.env.USER_ACCESS_TOKEN)}\n`);
    startScheduler();
    resourceMonitor.startMonitoring();
    // Limpieza de logs al arrancar y después cada semana
    cleanOldLogs();
    setInterval(cleanOldLogs, 7 * 24 * 60 * 60 * 1000).unref();
  });

  server.on('error', (err) => log.error('❌ Error del servidor HTTP:', err.message));
})();

function shutdown(signal) {
  console.log(`\n🛑 Señal ${signal} recibida. Cerrando servidor...`);
  server.close(() => { console.log('✅ Servidor cerrado'); process.exit(0); });
  setTimeout(() => { log.error('❌ Cierre forzado'); process.exit(1); }, 5000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
