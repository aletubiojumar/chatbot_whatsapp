// testAdminOffer.js
require('dotenv').config();
const conversationManager = require('../bot/conversationManager');
const { processMessage } = require('../bot/messageHandler');

const phoneNumber = 'whatsapp:+34681218907';

console.log('\n🧪 TEST: Oferta de Administración');
console.log('='.repeat(70));

// 1) Caso: venimos de botones y el usuario escribe algo que no toca
conversationManager.createOrUpdateConversation(phoneNumber, {
  stage: 'identity_confirmed',
  status: 'responded',
  lastPromptType: 'buttons',
  responses: []
});

console.log('\n1) Caso BOTONES + texto raro (debe ofrecer administración)');
const r1 = processMessage('Hola, necesito hablar', phoneNumber);
const c1 = conversationManager.getConversation(phoneNumber);

console.log('Respuesta:', r1);
console.log('Estado:', c1.status, '| Etapa:', c1.stage);

const ok1 =
  typeof r1 === 'string' &&
  r1.toLowerCase().includes('administracion') &&
  c1.status === 'awaiting_admin_offer';

console.log(ok1 ? '✅ PASA' : '❌ FALLA');

// 2) Caso: el bot pidió escribir (texto libre) => NO debe ofrecer administración
conversationManager.createOrUpdateConversation(phoneNumber, {
  stage: 'awaiting_corrections',
  status: 'responded',
  lastPromptType: 'text',
  responses: []
});

console.log('\n2) Caso TEXTO LIBRE pedido (NO debe ofrecer administración)');
const r2 = processMessage('Dirección: Calle X, 12', phoneNumber);
const c2 = conversationManager.getConversation(phoneNumber);

console.log('Respuesta:', r2);
console.log('Estado:', c2.status, '| Etapa:', c2.stage);

const ok2 =
  typeof r2 === 'string' &&
  !r2.toLowerCase().includes('administracion') &&
  (c2.stage === 'confirming_corrections' || c2.stage === 'awaiting_corrections');

console.log(ok2 ? '✅ PASA' : '❌ FALLA');

console.log('\n' + '='.repeat(70) + '\n');
process.exit(ok1 && ok2 ? 0 : 1);
