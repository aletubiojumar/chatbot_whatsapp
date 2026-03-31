// src/utils/dynamoStateStore.js
// Estado técnico de conversaciones en DynamoDB — permite múltiples instancias detrás
// de un load balancer sin conflictos de estado local.
//
// Tabla DynamoDB requerida:
//   - Nombre:           valor de DYNAMODB_STATE_TABLE (p.ej. "bot_state")
//   - Partition key:    waId  (String)
//   - Billing mode:     PAY_PER_REQUEST (on-demand)

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.DYNAMODB_STATE_TABLE;

if (!TABLE_NAME) {
  throw new Error(
    '❌  DYNAMODB_STATE_TABLE no está configurado.\n' +
    '    Crea una tabla DynamoDB con partition key "waId" (String) y establece la variable de entorno.'
  );
}

// Campos numéricos que deben ser coercionados al leer desde DynamoDB
const NUMERIC_FIELDS = [
  'locationRequestCount',
  'attempts',
  'inactivityAttempts',
  'nextReminderAt',
  'lastUserMessageAt',
  'lastReminderAt',
  'lastMessageAt',
  'locationStandbyUntil',
];

let _ddb = null;
function ddb() {
  if (!_ddb) {
    const raw = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-south-2' });
    _ddb = DynamoDBDocumentClient.from(raw);
  }
  return _ddb;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

async function readStateByWaId(waId) {
  try {
    const { Item } = await ddb().send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { waId: String(waId) },
    }));
    return Item ? deserialize(Item) : null;
  } catch (err) {
    console.error('❌ DynamoDB readStateByWaId:', err.message);
    return null;
  }
}

async function readAllStates() {
  try {
    const { Items = [] } = await ddb().send(new ScanCommand({ TableName: TABLE_NAME }));
    return Items.map(deserialize);
  } catch (err) {
    console.error('❌ DynamoDB readAllStates:', err.message);
    return [];
  }
}

// ── Escritura atómica por campos (UpdateExpression) ──────────────────────────
// Usa UpdateItem en lugar de PutItem para evitar sobrescribir campos que otra
// instancia haya actualizado concurrentemente.

async function upsertState(waId, patch = {}) {
  if (!Object.keys(patch).length) return;

  const key = String(waId);
  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = {};
  const sets = [];

  // Derivar status desde stage cuando stage cambia
  const enriched = { ...patch };
  if ('stage' in patch) {
    enriched.status = patch.stage === 'escalated' ? 'escalated' : 'pending';
  }

  for (const [field, value] of Object.entries(enriched)) {
    const nameKey  = `#f_${field}`;
    const valueKey = `:v_${field}`;
    ExpressionAttributeNames[nameKey] = field;

    if (field === 'mensajes') {
      ExpressionAttributeValues[valueKey] = JSON.stringify(Array.isArray(value) ? value : []);
    } else {
      ExpressionAttributeValues[valueKey] = value ?? null;
    }
    sets.push(`${nameKey} = ${valueKey}`);
  }

  try {
    await ddb().send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { waId: key },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    }));
  } catch (err) {
    console.error('❌ DynamoDB upsertState:', err.message);
    throw err;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deserialize(item) {
  const s = { ...item };

  // mensajes se guarda como JSON string
  if (typeof s.mensajes === 'string') {
    try { s.mensajes = JSON.parse(s.mensajes); } catch { s.mensajes = []; }
  } else if (!Array.isArray(s.mensajes)) {
    s.mensajes = [];
  }

  // Coercionar campos numéricos (DynamoDB puede devolver Decimal o string)
  for (const f of NUMERIC_FIELDS) {
    if (s[f] !== undefined && s[f] !== null && s[f] !== '') {
      s[f] = Number(s[f]);
    } else if (s[f] === '' || s[f] === undefined) {
      s[f] = null;
    }
  }

  return s;
}

module.exports = { readStateByWaId, readAllStates, upsertState };
