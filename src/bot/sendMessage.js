const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Debe ser algo como: whatsapp:+15558620102
const fromNumberEnv = process.env.TWILIO_FROM_NUMBER;

if (!accountSid || !authToken) {
  console.error('❌ Falta TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en el entorno');
}

const client = twilio(accountSid, authToken);

/**
 * Normaliza números para WhatsApp en Twilio.
 * Acepta:
 *   - "34681218907"
 *   - "+34681218907"
 *   - "whatsapp:34681218907"
 *   - "whatsapp:+34681218907"
 * Devuelve siempre:
 *   - "whatsapp:+34681218907"
 */
function normalizeWhatsAppNumber(input) {
  if (!input) return input;

  let s = String(input).trim();

  // quitar espacios internos
  s = s.replace(/\s+/g, '');

  // Caso: ya viene con whatsapp:
  if (s.toLowerCase().startsWith('whatsapp:')) {
    let rest = s.slice('whatsapp:'.length);

    // por si venía "whatsapp:346..." => añadir +
    if (!rest.startsWith('+')) rest = `+${rest}`;

    // por seguridad: eliminar dobles "+"
    rest = rest.replace(/^\++/, '+');

    return `whatsapp:${rest}`;
  }

  // Caso: viene sin whatsapp:
  if (!s.startsWith('+')) s = `+${s}`;
  s = s.replace(/^\++/, '+');

  return `whatsapp:${s}`;
}

/**
 * Normaliza el FROM (por si en .env alguien pone solo +1555... sin whatsapp:)
 */
function normalizeFromNumber() {
  if (!fromNumberEnv) return fromNumberEnv;
  return normalizeWhatsAppNumber(fromNumberEnv);
}

async function sendTemplateMessage(toNumber, contentSid, contentVariables = {}) {
  const to = normalizeWhatsAppNumber(toNumber);
  const from = normalizeFromNumber();

  if (!to || !from) {
    console.error('❌ sendTemplateMessage: falta to/from', { toNumber, to, fromNumberEnv, from });
    throw new Error('Missing to/from');
  }

  try {
    console.log('📤 Enviando template:', { to, from, contentSid });

    const message = await client.messages.create({
      to,
      from,
      contentSid,
      contentVariables: JSON.stringify(contentVariables),
    });

    console.log('✅ Template enviado. SID:', message.sid);
    return message;
  } catch (error) {
    console.error('❌ Error enviando template:', {
      to,
      from,
      contentSid,
      code: error.code,
      message: error.message,
      moreInfo: error.moreInfo,
    });
    throw error;
  }
}

async function sendSimpleMessageWithText(toNumber, text) {
  const to = normalizeWhatsAppNumber(toNumber);
  const from = normalizeFromNumber();

  if (!to || !from) {
    console.error('❌ sendSimpleMessageWithText: falta to/from', { toNumber, to, fromNumberEnv, from });
    throw new Error('Missing to/from');
  }

  try {
    console.log('📤 Enviando texto:', { to, from });

    const message = await client.messages.create({
      to,
      from,
      body: text,
    });

    console.log('✅ Texto enviado. SID:', message.sid);
    return message;
  } catch (error) {
    console.error('❌ Error enviando texto:', {
      to,
      from,
      code: error.code,
      message: error.message,
      moreInfo: error.moreInfo,
    });
    throw error;
  }
}

/**
 * Listar Content Templates (si lo usas).
 */
async function listContentTemplates(limit = 50) {
  const results = [];
  let pageToken = null;

  while (results.length < limit) {
    const params = { PageSize: 50 };
    if (pageToken) params.PageToken = pageToken;

    // Content API (dependiendo de cómo lo tengas montado puede variar)
    // Si esto te funciona, perfecto. Si no, lo ajustamos con tu endpoint real.
    const resp = await client.content.v1.contents.page(params);

    const contents = resp.instances || [];
    for (const c of contents) {
      results.push({
        sid: c.sid,
        friendlyName: c.friendly_name,
        language: c.language,
        types: c.types ? Object.keys(c.types) : []
      });
      if (results.length >= limit) break;
    }

    pageToken = resp.nextPageToken;
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
  listContentTemplates,
  normalizeWhatsAppNumber, // útil para depurar si quieres
};
