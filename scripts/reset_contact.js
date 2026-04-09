// scripts/reset_contact.js
// Resetea el estado técnico y el campo Contacto de un waId para permitir reenvío.
// Uso: node scripts/reset_contact.js 674742564
// o:   node scripts/reset_contact.js 34674742564

require('dotenv').config({ override: true });

const { updateConversationExcel, deleteStateByWaId, normalizePhone } = require('../src/utils/excelManager');

const rawPhone = process.argv[2];
if (!rawPhone) {
  console.error('❌ Indica el teléfono: node scripts/reset_contact.js 674742564');
  process.exit(1);
}

const waId = normalizePhone(rawPhone);
if (!waId) {
  console.error(`❌ Teléfono inválido: ${rawPhone}`);
  process.exit(1);
}

console.log(`\n🔄 Reseteando conversación para waId: ${waId}\n`);

// 1. Borrar estado técnico del bot_state.xlsx
const deleted = deleteStateByWaId(waId);
if (!deleted) {
  console.warn('⚠️  No había estado técnico que borrar (o ya estaba limpio)');
}

// 2. Limpiar campo Contacto en el Excel principal
updateConversationExcel(waId, { contacto: '' });
console.log('✅ Campo Contacto limpiado en Excel principal');

console.log('\n✅ Reset completado. Ahora puedes ejecutar:');
console.log(`   node src/sendInitialMessage.js --tel ${rawPhone}\n`);
