// src/bot/sendMessage.js
require('dotenv').config();
const twilio = require('twilio');
const { normalizeWhatsAppNumber, isValidTwilioWhatsAppTo } = require('./utils/phone');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  throw new Error('Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en .env');
}

const client = twilio(accountSid, authToken);

function getFromWhatsApp() {
  // Debe ser algo tipo: whatsapp:+15558620102
  const from = process.env.TWILIO_FROM_NUMBER;
  const normalized = normalizeWhatsAppNumber(from);
  if (!normalized || !isValidTwilioWhatsAppTo(normalized)) {
    throw new Error(
      `TWILIO_FROM_NUMBER inválido. Debe ser tipo "whatsapp:+15558620102". Valor actual: ${from}`
    );
  }
  return normalized;
}

async function sendSimpleMessageWithText(toNumber, body) {
  const to = normalizeWhatsAppNumber(toNumber);
  const from = getFromWhatsApp();

  if (!isValidTwilioWhatsAppTo(to)) {
    throw new Error(`Número 'To' inválido: ${toNumber} => ${to}`);
  }

  return client.messages.create({
    from,
    to,
    body,
  });
}

async function sendTemplateMessage(toNumber, contentSid, contentVariables = {}) {
  const to = normalizeWhatsAppNumber(toNumber);
  const from = getFromWhatsApp();

  if (!isValidTwilioWhatsAppTo(to)) {
    throw new Error(`Número 'To' inválido: ${toNumber} => ${to}`);
  }

  return client.messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify(contentVariables),
  });
}

module.exports = {
  sendSimpleMessageWithText,
  sendTemplateMessage,
};
