require('dotenv').config();
const { handleContinuationResponse } = require('../bot/inactivityHandler');
const conversationManager = require('../bot/conversationManager');

const phoneNumber = 'whatsapp:+34681218907';

console.log('\n🧪 TEST: Respuesta de Continuación\n');
console.log('='.repeat(60));

// Establecer estado awaiting_continuation
conversationManager.createOrUpdateConversation(phoneNumber, {
  status: 'awaiting_continuation',
  stage: 'identity_confirmed',
  responses: [
    { timestamp: Date.now() - 60000, message: 'Sí, soy el asegurado', type: 'user' },
    { timestamp: Date.now() - 59000, message: '[Template: verificación]', type: 'bot' }
  ]
});

console.log('\n📊 Estado ANTES de responder:');
const before = conversationManager.getConversation(phoneNumber);
console.log('   status:', before.status);
console.log('   stage:', before.stage);

console.log('\n👤 Usuario responde: "Sí"\n');

// Probar con "Sí"
const response = handleContinuationResponse('Sí', phoneNumber);

console.log('📝 Respuesta del bot:', response);
console.log('   (debería ser un mensaje de ayuda)\n');

console.log('📊 Estado DESPUÉS de responder:');
const after = conversationManager.getConversation(phoneNumber);
console.log('   status:', after.status);
console.log('   stage:', after.stage);

console.log('\n='.repeat(60));

if (response && after.status === 'responded') {
  console.log('✅ TEST PASADO: La función funciona correctamente');
} else {
  console.log('❌ TEST FALLIDO:');
  if (!response) console.log('   - No devolvió respuesta');
  if (after.status !== 'responded') console.log('   - Status no cambió a "responded"');
}

console.log('\n');