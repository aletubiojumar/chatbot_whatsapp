const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

/**
 * Envía mensaje con botones usando Content Template
 * @param {string} toNumber - Número destino (formato: whatsapp:+34XXXXXXXXX)
 * @param {string} fromNumber - número de WhatsApp (formato: whatsapp:+14155238886)
 * @param {string} contentSid - El SID del Content Template
 */

async function sendTemplateMessage(toNumber, fromNumber, contentSid, variables = null) {
  try {
    const payload = {
      from: fromNumber,
      to: toNumber,
      contentSid: contentSid,
    };

    if (variables) {
      payload.contentVariables = JSON.stringify(variables);
    }

    const message = await client.messages.create(payload);

    console.log('✅ Mensaje con botones enviado:', message.sid);
    console.log('📱 Enviado a:', toNumber);
    console.log('📅 Estado:', message.status);
    return message;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.message);
    if (error.code) console.error('Código de error:', error.code);
    throw error;
  }
}

/**
 * Envía mensaje simple con opciones numeradas (Sandbox - funciona sin aprobación)
 */
async function sendSimpleMessage(toNumber, fromNumber) {
  try {
    const messageBody = `Buenos días, Le contactamos desde el gabinete pericial del seguro del hogar por un siniestro comunicado.

Por favor, responda con el número de la opción:

1️⃣ Sí, soy el asegurado/a
2️⃣ No soy el asegurado/a  
3️⃣ Ahora no puedo atender`;

    const message = await client.messages.create({
      from: fromNumber,
      body: messageBody,
      to: toNumber
    });
    
    console.log('✅ Mensaje simple enviado:', message.sid);
    console.log('📱 Enviado a:', toNumber);
    return message;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.message);
    throw error;
  }
}

/**
 * Lista todos los Content Templates disponibles
 */
async function listContentTemplates() {
  try {
    const contents = await client.content.v1.contents.list({ limit: 20 });
    
    console.log('\n📋 Content Templates disponibles:\n');
    contents.forEach((content) => {
      console.log(`- Nombre: ${content.friendlyName}`);
      console.log(`  SID: ${content.sid}`);
      console.log(`  Tipo: ${content.types ? Object.keys(content.types).join(', ') : 'N/A'}`);
      console.log('---');
    });
    
    return contents;
  } catch (error) {
    console.error('❌ Error listando templates:', error.message);
    throw error;
  }
}

/**
 * Envía mensaje con texto personalizado
 */
async function sendSimpleMessageWithText(toNumber, fromNumber, messageText) {
  try {
    const message = await client.messages.create({
      from: fromNumber,
      body: messageText,
      to: toNumber
    });
    
    console.log('✅ Mensaje enviado:', message.sid);
    return message;
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.message);
    throw error;
  }
}

module.exports = {
  sendTemplateMessage,
  sendSimpleMessage,
  listContentTemplates
};