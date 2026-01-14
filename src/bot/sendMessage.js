const twilio = require('twilio');

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN no configurados en .env');
  }

  return twilio(accountSid, authToken);
}

/**
 * Envía un template de Twilio usando ContentSid
 * @param {string} toNumber - Número destino (formato: whatsapp:+34...)
 * @param {string} fromNumber - Número origen (formato: whatsapp:+14155238886)
 * @param {string} contentSid - SID del template (HX...)
 * @param {object|null} variables - Variables del template (opcional)
 */
async function sendTemplateMessage(toNumber, fromNumber, contentSid, variables = null) {
  const client = getClient();
  const accountSid = process.env.TWILIO_ACCOUNT_SID;

  // ✅ Validación del ContentSid
  if (!contentSid || typeof contentSid !== 'string' || !contentSid.startsWith('HX')) {
    throw new Error(`ContentSid inválido: "${contentSid}". Debe empezar con "HX"`);
  }

  console.log('🧩 Enviando template...');
  console.log('   ContentSid:', contentSid);
  console.log('   To:', toNumber);
  console.log('   From:', fromNumber);
  if (variables) {
    console.log('   Variables:', JSON.stringify(variables));
  }

  try {
    // ✅ MÉTODO 1: Intentar con client.messages.create() primero (más simple)
    const messageParams = {
      from: fromNumber,
      to: toNumber,
      contentSid: contentSid
    };

    if (variables && Object.keys(variables).length > 0) {
      messageParams.contentVariables = JSON.stringify(variables);
    }

    const message = await client.messages.create(messageParams);
    console.log('✅ Template enviado correctamente. SID:', message.sid);
    return message;

  } catch (error) {
    console.error('❌ Error enviando template (SDK):', error.message);
    if (error.code) console.error('   Código de error Twilio:', error.code);

    // ✅ Si falla con 21619 o ERR_INVALID_URL, usar método RAW con URL completa
    if (error.code === 21619 || error.code === 'ERR_INVALID_URL') {
      console.log('🔄 Reintentando con método RAW (URL completa)...');

      try {
        // Construir URL completa manualmente
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        
        const data = {
          From: fromNumber,
          To: toNumber,
          ContentSid: contentSid
        };

        if (variables && Object.keys(variables).length > 0) {
          data.ContentVariables = JSON.stringify(variables);
        }

        console.log('🌐 URL completa:', url);

        // Usar client.request con URL completa
        const response = await client.request({
          method: 'POST',
          url: url,  // ✅ 'url' con URL completa (no 'uri')
          data: data
        });

        const messageSid = response?.body?.sid || response?.sid || 'unknown';
        console.log('✅ Template enviado (RAW). SID:', messageSid);
        return response?.body || response;

      } catch (rawError) {
        console.error('❌ Error en método RAW:', rawError.message);
        throw rawError;
      }
    }

    throw error;
  }
}

/**
 * Envía un mensaje de texto simple (sin template)
 */
async function sendSimpleMessage(toNumber, fromNumber, body) {
  const client = getClient();
  
  if (!body || typeof body !== 'string' || body.trim() === '') {
    throw new Error('El cuerpo del mensaje (body) no puede estar vacío');
  }

  console.log('📤 Enviando mensaje simple...');
  console.log('   To:', toNumber);
  console.log('   Body:', body.substring(0, 50) + (body.length > 50 ? '...' : ''));

  try {
    const message = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body
    });

    console.log('✅ Mensaje simple enviado. SID:', message.sid);
    return message;
  } catch (error) {
    console.error('❌ Error enviando mensaje simple:', error.message);
    throw error;
  }
}

/**
 * Alias para sendSimpleMessage
 */
async function sendSimpleMessageWithText(toNumber, fromNumber, text) {
  return sendSimpleMessage(toNumber, fromNumber, text);
}

module.exports = {
  sendTemplateMessage,
  sendSimpleMessage,
  sendSimpleMessageWithText
};