// src/bot/inactivityHandler.js
'use strict';

const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');
const { sendTemplateMessage, sendSimpleMessageWithText } = require('./sendMessage');

const CHECK_EVERY_MS = Number(process.env.INACTIVITY_CHECK_EVERY_MS || 60_000);

// Consideramos inactiva una conversación si no hay actividad en X ms
const INACTIVITY_AFTER_MS = Number(process.env.INACTIVITY_AFTER_MS || 2 * 60_000); // 2 min

// Reintento/backoff si falla enviar (para no spamear Twilio cada minuto)
const FAIL_RETRY_AFTER_MS = Number(process.env.INACTIVITY_FAIL_RETRY_AFTER_MS || 10 * 60_000); // 10 min
const MAX_FAILS = Number(process.env.INACTIVITY_MAX_FAILS || 6);

// Continuaciones máximas (para no insistir infinito)
const MAX_CONTINUATIONS = Number(process.env.INACTIVITY_MAX_CONTINUATIONS || 3);

// Template SID para “continuación” (WhatsApp template aprobado)
const CONTINUATION_TEMPLATE_SID = process.env.CONTINUATION_TEMPLATE_SID || process.env.TWILIO_CONTINUATION_TEMPLATE_SID;

// Fallback si no hay template (texto normal)
const CONTINUATION_FALLBACK_TEXT =
  process.env.INACTIVITY_FALLBACK_TEXT ||
  '¿Sigues ahí? Si deseas continuar, responde *Continuar*. Si no, responde *Número equivocado*.';

// Si el usuario ya recibió algo hace poco, no reenviar
const MIN_GAP_BETWEEN_CONTINUATIONS_MS = Number(
  process.env.INACTIVITY_MIN_GAP_MS || 5 * 60_000 // 5 min
);

/**
 * Normaliza cualquier cosa tipo:
 *  - "whatsapp:+34681218907"
 *  - "whatsapp: 34681218907"
 *  - "34681218907"
 *  - "+34681218907"
 *  - "whatsapp:34681218907"
 * a "whatsapp:+34681218907"
 */
function normalizeWhatsAppTo(toRaw) {
  if (!toRaw) return null;

  const s = String(toRaw).trim();

  // Si viene como "whatsapp:...."
  const withoutPrefix = s.toLowerCase().startsWith('whatsapp:')
    ? s.slice('whatsapp:'.length).trim()
    : s;

  // Quitar espacios, guiones, paréntesis… y conservar dígitos y '+'
  let cleaned = withoutPrefix.replace(/[^\d+]/g, '');

  // Si no empieza por '+', asumimos que es número nacional ya con prefijo país incluido (en tu caso ES)
  // IMPORTANTE: aquí NO inventamos prefijos. Si llega sin '+', lo convertimos a "+<digits>" tal cual.
  // (Si te llegan números sin prefijo país, ahí sí habría que decidir país por defecto).
  if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

  // Al final: "whatsapp:+E164"
  return `whatsapp:${cleaned}`;
}

function nowMs() {
  return Date.now();
}

function getLastActivityMs(conv) {
  // Soportamos varios nombres típicos por compatibilidad
  const t =
    conv?.lastActivityAt ||
    conv?.lastActivityMs ||
    conv?.updatedAt ||
    conv?.lastUpdatedAt ||
    conv?.timestamp;

  if (!t) return 0;
  if (typeof t === 'number') return t;
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getConversationId(conv) {
  // “from” suele ser el id de conversación (whatsapp:+...)
  return conv?.from || conv?.From || conv?.phone || conv?.to || conv?.id || conv?.key;
}

/**
 * Decide si una conversación debe recibir continuación.
 */
function shouldSendContinuation(conv) {
  const last = getLastActivityMs(conv);
  if (!last) return false;

  const inactiveFor = nowMs() - last;
  if (inactiveFor < INACTIVITY_AFTER_MS) return false;

  // No más de N continuaciones
  const sentCount = Number(conv?.continuationCount || 0);
  if (sentCount >= MAX_CONTINUATIONS) return false;

  // Gap mínimo entre continuaciones
  const lastSent = Number(conv?.lastContinuationSentAt || 0);
  if (lastSent && nowMs() - lastSent < MIN_GAP_BETWEEN_CONTINUATIONS_MS) return false;

  // Backoff si está fallando
  const fails = Number(conv?.continuationFailCount || 0);
  if (fails >= MAX_FAILS) return false;

  const nextTryAt = Number(conv?.nextContinuationTryAt || 0);
  if (nextTryAt && nowMs() < nextTryAt) return false;

  // Opcional: sólo si status/stage está pendiente
  // Si en tu modelo “closed/resolved” existe, evitamos tocarlo.
  const status = (conv?.status || '').toLowerCase();
  if (status && ['closed', 'resolved', 'done', 'finished'].includes(status)) return false;

  return true;
}

async function sendContinuation(conversationManager, conv) {
  const rawTo = getConversationId(conv);
  const to = normalizeWhatsAppTo(rawTo);

  if (!to) {
    console.error('❌ [inactivity] No pude determinar "to" de conversación:', conv);
    return;
  }

  // Si estamos fuera de horario, reprogramamos el siguiente intento para la próxima ventana
  if (!isWithinSendWindow(new Date())) {
    const next = nextSendTimeMs(new Date());
    console.log(`🌙 [inactivity] Fuera de horario. Reprogramo continuación de ${to} a ${new Date(next).toISOString()}`);

    await safeUpdate(conversationManager, rawTo, {
      nextContinuationTryAt: next,
    });
    return;
  }

  try {
    if (CONTINUATION_TEMPLATE_SID) {
      await sendTemplateMessage(to, CONTINUATION_TEMPLATE_SID, {});
    } else {
      await sendSimpleMessageWithText(to, CONTINUATION_FALLBACK_TEXT);
    }

    console.log(`✅ [inactivity] Continuación enviada a ${to}`);

    const sentCount = Number(conv?.continuationCount || 0);

    await safeUpdate(conversationManager, rawTo, {
      lastContinuationSentAt: nowMs(),
      continuationCount: sentCount + 1,
      continuationFailCount: 0,
      nextContinuationTryAt: 0,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`❌ [inactivity] Error enviando continuación a ${to}: ${msg}`);

    const fails = Number(conv?.continuationFailCount || 0);
    const nextTry = nowMs() + FAIL_RETRY_AFTER_MS;

    await safeUpdate(conversationManager, rawTo, {
      continuationFailCount: fails + 1,
      nextContinuationTryAt: nextTry,
    });
  }
}

async function safeUpdate(conversationManager, fromKey, patch) {
  try {
    // Intento 1: updateConversation(from, patch)
    if (typeof conversationManager?.updateConversation === 'function') {
      await conversationManager.updateConversation(fromKey, patch);
      return;
    }
    // Intento 2: setConversation(from, newObj)
    if (typeof conversationManager?.setConversation === 'function') {
      const prev = (await conversationManager.getConversation?.(fromKey)) || {};
      await conversationManager.setConversation(fromKey, { ...prev, ...patch });
      return;
    }
    // Intento 3: update(from, patch)
    if (typeof conversationManager?.update === 'function') {
      await conversationManager.update(fromKey, patch);
      return;
    }

    console.warn('⚠️ [inactivity] conversationManager no tiene método de update conocido. Patch no aplicado.', patch);
  } catch (e) {
    console.error('❌ [inactivity] Error aplicando patch en conversationManager:', e?.message || e);
  }
}

async function runInactivityCheckOnce(conversationManager) {
  console.log('⏰ [inactivity] Ejecutando verificación de inactividad...');

  let conversations = [];
  try {
    if (typeof conversationManager?.getAllConversations === 'function') {
      conversations = await conversationManager.getAllConversations();
    } else if (typeof conversationManager?.getConversations === 'function') {
      conversations = await conversationManager.getConversations();
    } else if (typeof conversationManager?.listConversations === 'function') {
      conversations = await conversationManager.listConversations();
    } else {
      console.warn('⚠️ [inactivity] conversationManager no expone getAllConversations/getConversations/listConversations');
      return;
    }
  } catch (e) {
    console.error('❌ [inactivity] No pude obtener conversaciones:', e?.message || e);
    return;
  }

  const total = Array.isArray(conversations) ? conversations.length : 0;
  console.log(`📊 [inactivity] Total de conversaciones: ${total}`);

  if (!Array.isArray(conversations) || total === 0) {
    console.log('✅ [inactivity] No hay conversaciones inactivas');
    return;
  }

  const inactive = conversations.filter(shouldSendContinuation);
  console.log(`📤 [inactivity] Conversaciones inactivas detectadas: ${inactive.length}`);

  for (const conv of inactive) {
    const rawTo = getConversationId(conv);
    const to = normalizeWhatsAppTo(rawTo);
    console.log(`   📱 [inactivity] Enviando continuación a: ${to || rawTo}`);
    // eslint-disable-next-line no-await-in-loop
    await sendContinuation(conversationManager, conv);
  }
}

let intervalHandle = null;

function startInactivityHandler(conversationManager) {
  if (intervalHandle) return intervalHandle;

  // Primera ejecución rápida
  runInactivityCheckOnce(conversationManager).catch(() => {});

  intervalHandle = setInterval(() => {
    runInactivityCheckOnce(conversationManager).catch(() => {});
  }, CHECK_EVERY_MS);

  console.log(`✅ [inactivity] Handler iniciado. Intervalo: ${CHECK_EVERY_MS}ms`);
  return intervalHandle;
}

function stopInactivityHandler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  console.log('🛑 [inactivity] Handler detenido');
}

module.exports = {
  startInactivityHandler,
  stopInactivityHandler,
  runInactivityCheckOnce,
  normalizeWhatsAppTo,
};
