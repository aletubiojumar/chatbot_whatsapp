const {
  readStateByWaId: readStateByWaIdFromExcel,
  readAllStatesFromExcel,
  upsertStateInExcel,
  deleteStateByWaId: deleteStateByWaIdFromExcel,
} = require('./excelManager');
const { CONV_STATE_FILE } = require('./pathConfig');

const requestedBackend = String(process.env.STATE_BACKEND || 'excel').trim().toLowerCase();

let backend = requestedBackend;
let dynamoStateStore = null;

if (requestedBackend === 'dynamodb') {
  try {
    dynamoStateStore = require('./dynamoStateStore');
  } catch (err) {
    backend = 'excel';
    console.warn(`⚠️  STATE_BACKEND=dynamodb no disponible (${err.message}). Se usará Excel: ${CONV_STATE_FILE}`);
  }
}

if (backend === 'excel') {
  console.log(`🗂️  Estado técnico local activo: Excel (${CONV_STATE_FILE})`);
} else {
  console.log('🗂️  Estado técnico activo: DynamoDB');
}

async function readStateByWaId(waId) {
  if (backend === 'dynamodb') return dynamoStateStore.readStateByWaId(waId);
  return readStateByWaIdFromExcel(waId);
}

async function readAllStates() {
  if (backend === 'dynamodb') return dynamoStateStore.readAllStates();
  return readAllStatesFromExcel();
}

async function upsertState(waId, patch = {}) {
  if (backend === 'dynamodb') return dynamoStateStore.upsertState(waId, patch);
  return upsertStateInExcel(waId, patch);
}

async function deleteState(waId) {
  if (backend === 'dynamodb') return dynamoStateStore.deleteState(waId);
  return deleteStateByWaIdFromExcel(waId);
}

module.exports = {
  backend,
  readStateByWaId,
  readAllStates,
  upsertState,
  deleteState,
};
