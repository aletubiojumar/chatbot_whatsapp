require('dotenv').config();
const twilio = require('twilio');

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN no configurados en .env');
  }
  return twilio(accountSid, authToken);
}

function assertHX(sid) {
  if (!sid || typeof sid !== 'string' || !sid.startsWith('HX')) {
    throw new Error(`ContentSid inválido: "${sid}". Debe empezar con "HX"`);
  }
  return sid;
}

function toContentVariablesString(variables) {
  const v = (variables && typeof variables === 'object') ? variables : {};
  return JSON.stringify(v);
}

async function sendTemplateMessage(toNumber, fromNumber, contentSid, variables = null) {
  const client = getClient();

  const sid = assertHX(contentSid);
  const contentVars = toContentVariablesString(variables);

  console.log('🧩 Enviando template...');
  console.log('   ContentSid:', sid);
  console.log('   To:', toNumber);
  console.log('   From:', fromNumber);
  console.log('   ContentVariables:', contentVars);

  const message = await client.messages.create({
    from: fromNumber,
    to: toNumber,
    contentSid: sid,
    contentVariables: contentVars
  });

  console.log('✅ Template enviado correctamente. SID:', message.sid);
  return message;
}

/**
 * ✅ FUNCIÓN NUEVA: Enviar mensaje de texto simple (sin template)
 */
async function sendSimpleMessageWithText(toNumber, fromNumber, body) {
  const client = getClient();

  console.log('💬 Enviando mensaje de texto simple...');
  console.log('   To:', toNumber);
  console.log('   From:', fromNumber);
  console.log('   Body:', body.substring(0, 50) + '...');

  const message = await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: body
  });

  console.log('✅ Mensaje enviado correctamente. SID:', message.sid);
  return message;
}

/**
 * ✅ CORREGIDO: Lista Content Templates usando el SDK de Twilio correctamente
 */
async function listContentTemplates({ pageSize = 50, limit = 200 } = {}) {
  const client = getClient();

  try {
    console.log('🔍 Obteniendo templates de Twilio Content API...\n');
    
    const contents = await client.content.v1.contents.list({ 
      pageSize, 
      limit 
    });
    
    const results = contents.map(c => ({
      sid: c.sid,
      friendlyName: c.friendlyName,
      language: c.language,
      types: c.types ? Object.keys(c.types) : [],
      // Agregar estado de aprobación si está disponible
      approvalRequests: c.approvalRequests || 'N/A'
    }));

    console.log(`📦 Templates encontrados: ${results.length}\n`);
    console.log('─'.repeat(80));
    
    results.forEach(t => {
      console.log(`📋 ${t.friendlyName}`);
      console.log(`   SID: ${t.sid}`);
      console.log(`   Idioma: ${t.language}`);
      console.log(`   Tipos: ${t.types.join(', ')}`);
      console.log('─'.repeat(80));
    });

    return results;
  } catch (error) {
    console.error('\n❌ Error listando templates:', error.message);
    if (error.code) console.error('   Código Twilio:', error.code);
    if (error.moreInfo) console.error('   Más info:', error.moreInfo);
    throw error;
  }
}

module.exports = {
  sendTemplateMessage,
  sendSimpleMessageWithText,
  listContentTemplates
};