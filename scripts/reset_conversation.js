#!/usr/bin/env node
require('dotenv').config({ override: true });

const conversationManager = require('../src/bot/conversationManager');
const {
  readConversationByWaId,
  readConversationByNexp,
} = require('../src/utils/excelManager');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--waId' || arg === '--phone') out.waId = argv[++i];
    else if (arg === '--nexp') out.nexp = argv[++i];
  }
  return out;
}

function usageAndExit() {
  console.log('Uso: node scripts/reset_conversation.js --waId 346XXXXXXXX');
  console.log('   o: node scripts/reset_conversation.js --nexp 659627194');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.waId && !args.nexp) usageAndExit();

  const conv = args.waId
    ? readConversationByWaId(args.waId)
    : readConversationByNexp(args.nexp);

  if (!conv?.waId) {
    console.error('❌ No se encontró conversación para los parámetros indicados.');
    process.exit(1);
  }

  const waId = conv.waId;
  const nexp = conv.nexp;

  await conversationManager.createOrUpdateConversation(waId, {
    stage: 'consent',
    status: 'pending',
    lastBotResponseType: '',
    locationRequestCount: 0,
    attempts: 0,
    inactivityAttempts: 0,
    nextReminderAt: null,
    lastUserMessageAt: null,
    lastReminderAt: null,
    lastMessageAt: null,
    mensajes: [],
    locationStandbyUntil: null,
    contacto: '',
    relacion: '',
    attPerito: '',
    danos: '',
    digital: '',
    horario: '',
    coordenadas: '',
  });

  console.log(`✅ Conversación reseteada | nexp=${nexp} | waId=${waId}`);
  console.log('   stage=consent, contacto="", mensajes=[], campos extraídos vacíos');
}

main().catch(err => {
  console.error('❌ Error reseteando conversación:', err.message);
  process.exit(1);
});
