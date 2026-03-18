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
const { startScheduler } = require('./reminderScheduler');
const { cleanOldLogs } = require('../utils/fileLogger');

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

  // Solo procesamos texto y ubicación; el resto → respuesta informativa
  if (msg.type !== 'text' && msg.type !== 'location') {
    log.info(`📎 Tipo de mensaje no soportado [${msg.type}] de ${log.maskPhone(msg.userId)}`);
    await adapter.sendText(
      msg.userId,
      'Lo siento, por ahora solo puedo procesar mensajes de texto. Por favor, escríbame su respuesta.'
    ).catch(() => {});
    return;
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
    try {
      await processMessage(msg.userId, msg);
    } catch (err) {
      log.error('❌ Error procesando mensaje:', err);
    }
  });
});

// ── Arranque ──────────────────────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     🤖 WhatsApp Bot Jumar — MODO WHATSAPP IA              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Bot escuchando en ${HOST}:${PORT}`);
  console.log(`🌐 Health: http://${HOST}:${PORT}/health`);
  console.log(`📱 Phone Number ID: ${process.env.PHONE_NUMBER_ID}`);
  console.log(`🔑 Token configurado: ${Boolean(process.env.USER_ACCESS_TOKEN)}\n`);
  startScheduler();
  // Limpieza de logs al arrancar y después cada semana
  cleanOldLogs();
  setInterval(cleanOldLogs, 7 * 24 * 60 * 60 * 1000).unref();
});

server.on('error', (err) => log.error('❌ Error del servidor HTTP:', err.message));

function shutdown(signal) {
  console.log(`\n🛑 Señal ${signal} recibida. Cerrando servidor...`);
  server.close(() => { console.log('✅ Servidor cerrado'); process.exit(0); });
  setTimeout(() => { log.error('❌ Cierre forzado'); process.exit(1); }, 5000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;