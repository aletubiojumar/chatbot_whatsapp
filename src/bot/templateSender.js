// templateSender.js
require('dotenv').config();
const { sendTemplateMessage } = require('./sendMessage');

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const TEMPLATE_1_SID = process.env.TEMPLATE_1_SID; // “Es usted el asegurado…”
const TEMPLATE_2_SID = process.env.TEMPLATE_2_SID; // “¿Podemos continuar…?”
const TEMPLATE_3_SID = process.env.TEMPLATE_3_SID; // “Opciones: Sí/No”
const TEMPLATE_4_SID = process.env.TEMPLATE_4_SID; // “Continuar / Número equivocado”

async function sendInitialTemplate(phoneNumber) {
  if (!TEMPLATE_1_SID) throw new Error('Falta TEMPLATE_1_SID en .env');
  return sendTemplateMessage(phoneNumber, FROM_NUMBER, TEMPLATE_1_SID);
}

async function sendWelcomeTemplate(phoneNumber) {
  if (!TEMPLATE_2_SID) throw new Error('Falta TEMPLATE_2_SID en .env');
  return sendTemplateMessage(phoneNumber, FROM_NUMBER, TEMPLATE_2_SID);
}

async function sendCorrectionTemplate(phoneNumber) {
  if (!TEMPLATE_3_SID) throw new Error('Falta TEMPLATE_3_SID en .env');
  return sendTemplateMessage(phoneNumber, FROM_NUMBER, TEMPLATE_3_SID);
}

async function sendInitialConfirmTemplate(phoneNumber) {
  if (!TEMPLATE_4_SID) throw new Error('Falta TEMPLATE_4_SID en .env');
  return sendTemplateMessage(phoneNumber, FROM_NUMBER, TEMPLATE_4_SID);
}

module.exports = {
  sendInitialTemplate,
  sendWelcomeTemplate,
  sendCorrectionTemplate,
  sendInitialConfirmTemplate
};
