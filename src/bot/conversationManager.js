// src/bot/conversationManager.js
const fs = require('fs');
const path = require('path');
const { normalizeWhatsAppNumber } = require('./utils/phone');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const CONVERSATIONS_FILE =
  process.env.CONVERSATIONS_FILE || path.join(DATA_DIR, 'conversations.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONVERSATIONS_FILE)) fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify({}), 'utf8');
}

function readJsonSafe() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('❌ Error leyendo conversations.json, creando uno nuevo:', e.message);
    return {};
  }
}

function writeJsonSafe(data) {
  ensureStorage();
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Repara claves y conv.phoneNumber
function normalizeConversationsObject(conversations) {
  const fixed = {};

  for (const [k, conv] of Object.entries(conversations || {})) {
    const keyNorm = normalizeWhatsAppNumber(k) || k;
    const phoneNorm = normalizeWhatsAppNumber(conv?.phoneNumber) || keyNorm;

    fixed[keyNorm] = {
      ...conv,
      phoneNumber: phoneNorm,
    };
  }

  return fixed;
}

function getConversations() {
  const data = readJsonSafe();
  const normalized = normalizeConversationsObject(data);

  // Si hubo cambios, persistimos
  const changed = JSON.stringify(data) !== JSON.stringify(normalized);
  if (changed) writeJsonSafe(normalized);

  return normalized;
}

function saveConversations(conversations) {
  const normalized = normalizeConversationsObject(conversations);
  writeJsonSafe(normalized);
}

function createOrUpdateConversation(phoneNumber, data = {}) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  const conversations = getConversations();

  if (!conversations[key]) {
    conversations[key] = {
      phoneNumber: key,
      status: 'pending',
      stage: 'initial',
      attempts: 0,
      lastMessageAt: Date.now(),
      lastUserMessageAt: null,
      nextReminderAt: null,
      snoozedUntil: null,
      history: [],
      escalatedAt: null,
      ...data,
    };
  } else {
    conversations[key] = {
      ...conversations[key],
      ...data,
      phoneNumber: key,
    };
  }

  saveConversations(conversations);
  return conversations[key];
}

function recordUserMessage(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  return createOrUpdateConversation(key, {
    lastMessageAt: Date.now(),
    lastUserMessageAt: Date.now(),
  });
}

function recordResponse(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  // OJO: esto NO debe contar como actividad del usuario
  return createOrUpdateConversation(key, {
    lastMessageAt: Date.now(),
  });
}

function getConversation(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  const conversations = getConversations();
  return conversations[key] || null;
}

// ✅ MÉTODO AÑADIDO: getAllConversations
function getAllConversations() {
  const conversations = getConversations();
  return Object.values(conversations);
}

// ✅ Métodos adicionales para reminderScheduler
function getConversationsNeedingReminder() {
  const conversations = getAllConversations();
  const now = Date.now();
  
  return conversations.filter(conv => {
    if (conv.status !== 'pending') return false;
    if (!conv.nextReminderAt) return false;
    if (conv.attempts >= 3) return false;
    return conv.nextReminderAt <= now;
  });
}

function getConversationsNeedingEscalation() {
  const conversations = getAllConversations();
  
  return conversations.filter(conv => {
    return conv.attempts >= 3 && 
           conv.status === 'pending' && 
           !conv.escalatedAt;
  });
}

function incrementAttempts(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  const conv = getConversation(key);
  
  if (!conv) return null;
  
  const newAttempts = (conv.attempts || 0) + 1;
  const nextReminder = Date.now() + (6 * 60 * 60 * 1000); // 6 horas
  
  return createOrUpdateConversation(key, {
    attempts: newAttempts,
    nextReminderAt: nextReminder,
    lastReminderAt: Date.now()
  });
}

function markAsEscalated(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  return createOrUpdateConversation(key, {
    status: 'escalated',
    stage: 'escalated',
    escalatedAt: Date.now()
  });
}

function clearSnoozed(phoneNumber) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  return createOrUpdateConversation(key, {
    status: 'pending',
    snoozedUntil: null
  });
}

// ✅ MÉTODO AÑADIDO: getInactiveConversations (para inactivityHandler)
function getInactiveConversations(inactivityTimeoutMs) {
  const conversations = getAllConversations();
  const now = Date.now();
  
  return conversations.filter(conv => {
    // Solo conversaciones pendientes
    if (conv.status !== 'pending') return false;
    
    // Si está "snoozed", ignorar hasta que expire
    if (conv.snoozedUntil && conv.snoozedUntil > now) return false;
    
    // Si no tiene lastUserMessageAt, no es inactiva
    if (!conv.lastUserMessageAt) return false;
    
    // Verificar si ha pasado el timeout
    const timeSinceLastMessage = now - conv.lastUserMessageAt;
    return timeSinceLastMessage >= inactivityTimeoutMs;
  });
}

// ✅ MÉTODO AÑADIDO: snoozeConversation (para inactivityHandler)
function snoozeConversation(phoneNumber, snoozeMs) {
  const key = normalizeWhatsAppNumber(phoneNumber) || phoneNumber;
  const snoozedUntil = Date.now() + snoozeMs;
  
  return createOrUpdateConversation(key, {
    snoozedUntil,
    lastSnoozedAt: Date.now()
  });
}


module.exports = {
  getConversations,
  getConversation,
  getAllConversations,
  getConversationsNeedingReminder,
  getConversationsNeedingEscalation,
  getInactiveConversations,
  incrementAttempts,
  markAsEscalated,
  clearSnoozed,
  snoozeConversation,
  saveConversations,
  createOrUpdateConversation,
  recordUserMessage,
  recordResponse,
  CONVERSATIONS_FILE,
};