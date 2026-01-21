// src/bot/templateSender.js
const { sendTemplateMessage } = require('./sendMessage');
const { normalizeWhatsAppNumber } = require('./utils/phone');

// Ajusta estos env a lo que uses realmente
const CONTINUATION_TEMPLATE_SID = process.env.TWILIO_CONTINUATION_TEMPLATE_SID;
const INITIAL_TEMPLATE_SID = process.env.TWILIO_INITIAL_TEMPLATE_SID;

async function sendContinuationTemplate(toNumber, variables = {}) {
  if (!CONTINUATION_TEMPLATE_SID) {
    throw new Error('Falta TWILIO_CONTINUATION_TEMPLATE_SID en .env');
  }

  const to = normalizeWhatsAppNumber(toNumber);

  console.log('🧩 Enviando template...');
  console.log('   ContentSid:', CONTINUATION_TEMPLATE_SID);
  console.log('   To:', to);
  console.log('   ContentVariables:', variables);

  return sendTemplateMessage(to, CONTINUATION_TEMPLATE_SID, variables);
}

async function sendInitialTemplate(toNumber, variables = {}) {
  if (!INITIAL_TEMPLATE_SID) {
    throw new Error('Falta TWILIO_INITIAL_TEMPLATE_SID en .env');
  }

  const to = normalizeWhatsAppNumber(toNumber);

  console.log('🧩 Enviando template inicial...');
  console.log('   ContentSid:', INITIAL_TEMPLATE_SID);
  console.log('   To:', to);
  console.log('   ContentVariables:', variables);

  return sendTemplateMessage(to, INITIAL_TEMPLATE_SID, variables);
}

module.exports = {
  sendContinuationTemplate,
  sendInitialTemplate,
};
