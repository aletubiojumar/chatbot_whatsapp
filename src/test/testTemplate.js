const { sendContinuationTemplate } = require('../bot/templateSender');

sendContinuationTemplate('whatsapp:+34681218907')
  .then(() => console.log('✅ Enviado'))
  .catch(err => console.error('❌ Error:', err.message));