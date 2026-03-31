// src/bot/conversationManager.js
// Estado técnico en DynamoDB (multi-instancia); datos de negocio en Excel.

const fs   = require('fs');
const path = require('path');

const {
  normalizePhone,
  readConversationByWaId,
  extractTechnicalStateFromExcel,
  removeTechnicalColumns,
  migrateStateSheetToFile,
  readAllStatesFromExcel,
  upsertStateInExcel,
  updateConversationExcel,
} = require('../utils/excelManager');

const dynamoStateStore = require('../utils/dynamoStateStore');

const INACTIVITY_MS = Number(
  process.env.INACTIVITY_INTERVAL_MINUTES ||
  (process.env.INACTIVITY_INTERVAL_HOURS || 2) * 60
) * 60000;

// normalizeWaId es la misma lógica que normalizePhone
const normalizeWaId = normalizePhone;

const TECH_FIELDS = new Set([
  'status',
  'stage',
  'lastBotResponseType',
  'locationRequestCount',
  'attempts',
  'inactivityAttempts',
  'nextReminderAt',
  'lastUserMessageAt',
  'lastReminderAt',
  'lastMessageAt',
  'mensajes',
  'locationStandbyUntil',
]);
const EXCEL_FIELDS = new Set([
  'contacto',
  'relacion',
  'attPerito',
  'danos',
  'digital',
  'horario',
  'coordenadas',
]);

// ── Migraciones síncronas de formato legado (se ejecutan al importar el módulo) ──

function migrateLegacyTechnicalState() {
  const legacy = extractTechnicalStateFromExcel();
  for (const [waId, state] of Object.entries(legacy)) {
    upsertStateInExcel(waId, state);
  }
  const removed = removeTechnicalColumns();
  if (Object.keys(legacy).length || removed.length) {
    console.log(`🧹 Migración de estado técnico completada | convs: ${Object.keys(legacy).length} | columnas eliminadas: ${removed.join(', ') || 'ninguna'}`);
  }
}

migrateLegacyTechnicalState();
// Si el Excel de negocio aún contiene __bot_state (instalación anterior),
// lo migra al archivo independiente bot_state.xlsx y lo elimina del Excel.
migrateStateSheetToFile();

// ── Migración asíncrona bot_state.xlsx → DynamoDB ────────────────────────────
// Llamar desde index.js con `await conversationManager.init()` antes de arrancar
// el servidor. Solo hace algo si bot_state.xlsx existe (primera vez con DynamoDB).

async function init() {
  const stateFilePath = process.env.CONV_STATE_FILE ||
    path.join(path.dirname(process.env.EXCEL_PATH || path.join(__dirname, '..', '..', 'data', 'allianz_latest.xlsx')), 'bot_state.xlsx');

  if (!fs.existsSync(stateFilePath)) return;

  const states = readAllStatesFromExcel();
  if (!states.length) return;

  console.log(`🔀 Migrando ${states.length} estado(s) de bot_state.xlsx → DynamoDB...`);
  for (const state of states) {
    if (!state.waId) continue;
    await dynamoStateStore.upsertState(state.waId, state);
  }

  fs.renameSync(stateFilePath, `${stateFilePath}.migrated`);
  console.log(`✅ Migración bot_state.xlsx → DynamoDB completada (archivo renombrado a .migrated)`);
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function mergeConversation(baseExcel, state) {
  if (!baseExcel) return null;
  const safeState = state || {};

  return {
    ...baseExcel,
    status: safeState.status || (safeState.stage === 'escalated' ? 'escalated' : 'pending'),
    stage: safeState.stage || 'consent',
    lastBotResponseType: safeState.lastBotResponseType || '',
    locationRequestCount: Number(safeState.locationRequestCount || 0),
    attempts: Number(safeState.attempts || 0),
    inactivityAttempts: Number(safeState.inactivityAttempts || 0),
    nextReminderAt: safeState.nextReminderAt ?? null,
    lastUserMessageAt: safeState.lastUserMessageAt ?? null,
    lastReminderAt: safeState.lastReminderAt ?? null,
    lastMessageAt: safeState.lastMessageAt ?? null,
    mensajes: Array.isArray(safeState.mensajes) ? safeState.mensajes : [],
    locationStandbyUntil: safeState.locationStandbyUntil ?? null,
  };
}

// ── API pública (todas las funciones son async) ───────────────────────────────

async function getConversation(waId) {
  const key = normalizeWaId(waId) || String(waId);
  const baseExcel = readConversationByWaId(key);
  if (!baseExcel) return null;
  return mergeConversation(baseExcel, await dynamoStateStore.readStateByWaId(key));
}

async function getAllConversations() {
  const states = await dynamoStateStore.readAllStates();
  const out = [];
  for (const state of states) {
    const key = normalizeWaId(state.waId) || String(state.waId || '');
    if (!key) continue;
    const baseExcel = readConversationByWaId(key);
    if (!baseExcel) continue;
    out.push(mergeConversation(baseExcel, state));
  }
  return out;
}

async function createOrUpdateConversation(waId, data = {}) {
  const key = normalizeWaId(waId) || String(waId);
  const techPatch  = {};
  const excelPatch = {};

  for (const [k, v] of Object.entries(data || {})) {
    if (TECH_FIELDS.has(k))  techPatch[k]  = v;
    if (EXCEL_FIELDS.has(k)) excelPatch[k] = v;
  }

  if (Object.keys(techPatch).length)  await dynamoStateStore.upsertState(key, techPatch);
  if (Object.keys(excelPatch).length) updateConversationExcel(key, excelPatch);

  return getConversation(key);
}

async function recordUserMessage(waId) {
  return createOrUpdateConversation(waId, {
    lastMessageAt:      Date.now(),
    lastUserMessageAt:  Date.now(),
    inactivityAttempts: 0,
    nextReminderAt:     Date.now() + INACTIVITY_MS,
  });
}

async function getMensajes(waId) {
  const conv = await getConversation(waId);
  return conv?.mensajes || [];
}

async function saveMensajes(waId, mensajes) {
  return createOrUpdateConversation(waId, { mensajes });
}

async function recordResponse(waId) {
  return createOrUpdateConversation(waId, { lastMessageAt: Date.now() });
}

async function markAsEscalated(waId) {
  return createOrUpdateConversation(waId, { stage: 'escalated' });
}

async function getNexpByWaId(waId) {
  const conv = await getConversation(waId);
  return conv?.nexp || null;
}

module.exports = {
  normalizeWaId,
  init,
  getConversation,
  getAllConversations,
  createOrUpdateConversation,
  recordUserMessage,
  recordResponse,
  getMensajes,
  saveMensajes,
  markAsEscalated,
  getNexpByWaId,
  // Alias compatibilidad
  getNexpByChatId: getNexpByWaId,
};
