// src/bot/templateSender.js
const { sendTemplateMessage } = require('./sendMessage');
const { normalizeWhatsAppNumber } = require('./utils/phone');

const TEMPLATE_NAME = process.env.WA_TPL_SALUDO;

async function sendInitialTemplate(toNumber, templateName, userData = {}) {
  const template = templateName || TEMPLATE_NAME;
  
  if (!template) {
    throw new Error('Falta nombre del template (WA_TPL_SALUDO en .env)');
  }

  const to = normalizeWhatsAppNumber(toNumber);

  console.log('🧩 Enviando template inicial...');
  console.log('   Template:', template);
  console.log('   To:', to);

  // ✅ Template "saludo" NO tiene variables, enviar sin componentes
  const components = [];

  console.log('   Components:', JSON.stringify(components, null, 2));

  // ✅ CORRECTO: template sin variables = array vacío de componentes
  return sendTemplateMessage(to, template, 'es', components);
}

module.exports = {
  sendInitialTemplate,
};