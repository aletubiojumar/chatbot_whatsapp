const fs = require('fs');
const path = require('path');

const CONVERSATIONS_FILE = path.join(__dirname, '../../data/conversations.json');

// Inicializar archivo si no existe
function initConversationsFile() {
  const dir = path.dirname(CONVERSATIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(CONVERSATIONS_FILE)) {
    fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

function getConversations() {
  initConversationsFile();
  try {
    const raw = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function saveConversations(conversations) {
  initConversationsFile();
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2), 'utf8');
}

function createOrUpdateConversation(phoneNumber, data) {
  const conversations = getConversations();

  if (!conversations[phoneNumber]) {
    conversations[phoneNumber] = {
      phoneNumber,
      status: 'pending',
      stage: 'initial',
      attempts: 0,
      // OJO: lastMessageAt puede actualizarse con mensajes del bot si se usa recordResponse
      // Para inactividad real usamos lastUserMessageAt.
      lastMessageAt: Date.now(),
      lastUserMessageAt: null,
      nextReminderAt: null,
      snoozedUntil: null,
      history: [],
      lastPromptType: null,
      continuationSentAt: null
    };
  }

  conversations[phoneNumber] = {
    ...conversations[phoneNumber],
    ...data
  };

  saveConversations(conversations);
  return conversations[phoneNumber];
}

function getConversation(phoneNumber) {
  const conversations = getConversations();
  return conversations[phoneNumber] || null;
}

function recordResponse(phoneNumber, message, who = 'bot') {
  const conv = getConversation(phoneNumber) || createOrUpdateConversation(phoneNumber, {});
  const now = Date.now();

  const entry = {
    who,
    message,
    at: now
  };

  const history = Array.isArray(conv.history) ? conv.history : [];
  history.push(entry);

  const update = {
    history,
    lastMessageAt: now
  };

  // ✅ IMPORTANT: trackear el último mensaje del usuario para inactividad real
  if (who === 'user') {
    update.lastUserMessageAt = now;
  }

  return createOrUpdateConversation(phoneNumber, update);
}

function getLastNonEmptyBotMessage(phoneNumber) {
  const conv = getConversation(phoneNumber);
  if (!conv || !Array.isArray(conv.history)) return null;

  for (let i = conv.history.length - 1; i >= 0; i--) {
    const h = conv.history[i];
    if (h && h.who === 'bot') {
      const m = (h.message || '').toString();
      if (m.trim()) return m;
    }
  }
  return null;
}

function getInactiveConversations(timeoutMs) {
  const conversations = getConversations();
  const now = Date.now();

  return Object.values(conversations).filter(conv => {
    if (!conv) return false;
    if (conv.status !== 'pending') return false;
    if (conv.snoozedUntil && now < conv.snoozedUntil) return false;

    const last = conv.lastUserMessageAt || conv.lastMessageAt;
    if (!last) return false;

    return (now - last) >= timeoutMs;
  });
}

function snoozeConversation(phoneNumber, ms) {
  const until = Date.now() + ms;
  return createOrUpdateConversation(phoneNumber, {
    status: 'snoozed',
    snoozedUntil: until
  });
}

function clearSnoozed(phoneNumber) {
  // Al salir del modo "snoozed", reactivamos el flujo y programamos un recordatorio
  // cercano para no quedarnos sin siguiente envío.
  return createOrUpdateConversation(phoneNumber, {
    status: 'pending',
    nextReminderAt: Date.now() + (1 * 60 * 1000), // reintenta en 1 minuto (ajusta si quieres)
    attempts: 0
  });
}

function getConversationsNeedingReminder() {
  const conversations = getConversations();
  const now = Date.now();

  return Object.values(conversations).filter(conv => {
    if (!conv) return false;
    if (conv.status !== 'pending') return false;
    if (!conv.nextReminderAt) return false;
    if (conv.snoozedUntil && now < conv.snoozedUntil) return false;
    return now >= conv.nextReminderAt;
  });
}

// Devuelve conversaciones que deben escalar (>=3 intentos y aún pendientes)
function getConversationsNeedingEscalation() {
  const conversations = getConversations();
  const now = Date.now();

  return Object.values(conversations).filter(conv => {
    if (!conv) return false;

    // Solo escalamos conversaciones activas/pending
    if (conv.status !== 'pending') return false;

    // Respeta snooze
    if (conv.snoozedUntil && now < conv.snoozedUntil) return false;

    // Ya escalada -> fuera
    if (conv.escalatedAt) return false;

    const attempts = Number(conv.attempts || 0);
    return attempts >= 3;
  });
}

// Incrementa intentos y programa próximo recordatorio (6h)
function incrementAttempts(phoneNumber, hours = 6) {
  const conv = getConversation(phoneNumber) || createOrUpdateConversation(phoneNumber, {});
  const attempts = Number(conv.attempts || 0) + 1;

  return createOrUpdateConversation(phoneNumber, {
    attempts,
    // Reprograma siguiente recordatorio a 6h (coincide con tu scheduler)
    nextReminderAt: Date.now() + hours * 60 * 60 * 1000
  });
}

// Marca una conversación como escalada y limpia recordatorios
function markAsEscalated(phoneNumber) {
  return createOrUpdateConversation(phoneNumber, {
    status: 'escalated',
    stage: 'escalated',
    escalatedAt: Date.now(),
    nextReminderAt: null
  });
}


module.exports = {
  getConversations,
  saveConversations,
  createOrUpdateConversation,
  getConversation,
  recordResponse,
  getLastNonEmptyBotMessage,
  getInactiveConversations,
  snoozeConversation,
  clearSnoozed,
  getConversationsNeedingReminder,
  getConversationsNeedingEscalation,
  incrementAttempts,
  markAsEscalated
};
