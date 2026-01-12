require('dotenv').config();
const { sendTemplateMessage } = require('../bot/sendMessage');

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;
const TO_NUMBER = 'whatsapp:+34681218907';

console.log('📤 Enviando template mensaje_ausencia...');
console.log('FROM:', FROM_NUMBER);
console.log('TO:', TO_NUMBER);
console.log('SID:', MENSAJE_AUSENCIA_SID);
console.log('');

sendTemplateMessage(TO_NUMBER, FROM_NUMBER, MENSAJE_AUSENCIA_SID)
  .then(() => {
    console.log('\n✅ Template enviado correctamente');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error.message);
    if (error.code) console.error('Código:', error.code);
    if (error.moreInfo) console.error('Más info:', error.moreInfo);
    process.exit(1);
  });