#!/usr/bin/env node
require('dotenv').config({ override: true });

const conversationManager = require('../src/bot/conversationManager');
const {
  readConversationByWaId,
  readConversationByNexp,
  deleteStateByWaId,
  updateConversationExcel,
} = require('../src/utils/excelManager');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--waId' || arg === '--phone') out.waId = argv[++i];
    else if (arg === '--nexp') out.nexp = argv[++i];
    else if (arg === '--delete') out.delete = true;
  }
  return out;
}

function usageAndExit() {
  console.log('Uso: node scripts/reset_conversation.js --waId 346XXXXXXXX');
  console.log('   o: node scripts/reset_conversation.js --nexp 659627194');
  console.log('');
  console.log('Opciones:');
  console.log('   --delete    Elimina completamente el estado (para reenviar mensaje inicial)');
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

  if (args.delete) {
    // Opción 1: Deletear completamente
    const deleted = deleteStateByWaId(waId);
    if (!deleted) {
      console.error('❌ No se pudo eliminar la conversación');
      process.exit(1);
    }
    
    // También limpiar el campo Contacto en Excel para permitir reenvío
    updateConversationExcel(waId, {
      contacto: '',
    });
    
    console.log(`✅ Conversación completamente eliminada | nexp=${nexp} | waId=${waId}`);
    console.log('   - Estado técnico: eliminado del backend');
    console.log('   - Campo "Contacto": limpiado en Excel');
    console.log('   - Ahora puedes enviar el mensaje inicial nuevamente');
  } else {
    // Opción 2: Solo resetear (mantener waId en el estado)
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
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
