const { sendTemplateMessage, sendSimpleMessage } = require('./bot/sendMessage');
const conversationManager = require('./bot/conversationManager');
require('dotenv').config();

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';
const TO_NUMBER = process.argv[2];

const CONTENT_SID = 'HX4a215fbd890a4cd18b04469a66da9c14';

if (!TO_NUMBER) {
  console.error('❌ Error: Debes proporcionar un número de teléfono');
  console.log('Uso: node src/sendInitialMessage.js whatsapp:+34XXXXXXXXX');
  process.exit(1);
}

async function send() {
  console.log('📤 Enviando mensaje inicial con botones...');
  
  conversationManager.createOrUpdateConversation(TO_NUMBER, {
    status: 'pending',
    stage: 'initial',
    attempts: 0
  });
  
  // Usar template en lugar de mensaje simple
  await sendTemplateMessage(TO_NUMBER, FROM_NUMBER, CONTENT_SID);
  
  console.log('💾 Conversación registrada para seguimiento automático');
}

send()
  .then(() => {
    console.log('✅ Mensaje enviado correctamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  });