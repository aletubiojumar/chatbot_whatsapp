const { sendTemplateMessage } = require('./bot/sendMessage');
const conversationManager = require('./bot/conversationManager');
require('dotenv').config();

// 📌 CONFIGURACIÓN
const TO_NUMBER = process.argv[2];
const CONTENT_SID = process.env.CONTENT_SID; // mensaje1_v2 de Twilio

const msg = await sendTemplateMessage(TO_NUMBER, CONTENT_SID, {});
console.log('✅ Twilio Message SID:', msg.sid);
console.log('✅ Twilio Message Status:', msg.status);

// ✅ VALIDACIONES
if (!TO_NUMBER) {
  console.error('❌ Error: Debes proporcionar un número de teléfono');
  console.log('Uso: node src/sendInitialMessage.js whatsapp:+34XXXXXXXXX');
  process.exit(1);
}

if (!CONTENT_SID) {
  console.error('❌ Error: CONTENT_SID no está configurado en .env');
  console.error('Agrega esta línea a tu .env:');
  console.error('CONTENT_SID=HXb324a1ef0402c9cc7c0368bdb3e007f3');
  process.exit(1);
}

// 📤 FUNCIÓN PRINCIPAL
async function send() {
  console.log('📤 Enviando mensaje inicial con botones...');
  console.log('   To:', TO_NUMBER);
  console.log('   ContentSid:', CONTENT_SID);
  console.log('');

  // ✅ CORREGIDO: sendTemplateMessage(toNumber, contentSid, contentVariables)
  // Ya NO pasamos FROM_NUMBER porque la función lo obtiene internamente
  await sendTemplateMessage(TO_NUMBER, CONTENT_SID, {});

  // ✅ Crear/actualizar conversación en el sistema CON lastInteractive
  conversationManager.createOrUpdateConversation(TO_NUMBER, {
    status: 'pending',
    stage: 'initial',
    attempts: 0,
    lastPromptType: 'buttons',
    lastMessageAt: Date.now(),
    lastUserMessageAt: Date.now(), // ✅ Importante para que no se marque como inactiva inmediatamente
    lastInteractive: {
      kind: 'template',
      sid: CONTENT_SID,
      variables: {}
    }
  });

  console.log('');
  console.log('💾 Conversación registrada para seguimiento automático');
}

// 🚀 EJECUCIÓN
send()
  .then(() => {
    console.log('✅ Mensaje enviado correctamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    if (error.code) {
      console.error('   Código Twilio:', error.code);
    }
    if (error.moreInfo) {
      console.error('   Más info:', error.moreInfo);
    }
    process.exit(1);
  });