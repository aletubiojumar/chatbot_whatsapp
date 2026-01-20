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
 * Lista Content Templates (Content API)
 * OJO: Twilio helper espera `uri`, no `url`.
 */
async function listContentTemplates({ pageSize = 50, limit = 200 } = {}) {
  const client = getClient();

  const results = [];
  let pageToken = null;

  while (results.length < limit) {
    const qs = new URLSearchParams();
    qs.set('PageSize', String(pageSize));
    if (pageToken) qs.set('PageToken', pageToken);

    // ✅ Content API está en content.twilio.com (no en api.twilio.com)
    const uri = `https://content.twilio.com/v1/Content?${qs.toString()}`;

    const resp = await client.request({
      method: 'GET',
      uri
    });

    const body = resp?.body || {};
    const contents = body.contents || [];
    const meta = body.meta || {};
    const nextPageUrl = meta.next_page_url || null;

    for (const c of contents) {
      results.push({
        sid: c.sid,
        friendlyName: c.friendly_name,
        language: c.language,
        types: c.types ? Object.keys(c.types) : []
      });
      if (results.length >= limit) break;
    }

    if (!nextPageUrl) break;
    pageToken = new URL(nextPageUrl).searchParams.get('PageToken');
    if (!pageToken) break;
  }

  console.log(`\n📦 Templates encontrados: ${results.length}\n`);
  results.forEach(t => {
    console.log(`- ${t.friendlyName} | ${t.sid} | ${t.language} | ${t.types.join(', ')}`);
  });

  return results;
}

module.exports = {
  sendTemplateMessage,
  sendSimpleMessageWithText,
  listContentTemplates
};