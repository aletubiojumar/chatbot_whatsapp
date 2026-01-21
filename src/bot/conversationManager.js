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


module.exports = {
  getConversations,
  getConversation,
  saveConversations,
  createOrUpdateConversation,
  recordUserMessage,
  recordResponse,
  CONVERSATIONS_FILE,
};
