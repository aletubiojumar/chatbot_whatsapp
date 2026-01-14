const { sendTemplateMessage } = require('./sendMessage');

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

function assertEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} en .env`);
  return v;
}

async function sendInitialTemplate(toNumber, variables = null) {
  const sid = assertEnv('CONTENT_SID');
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid, variables);
}

async function sendAttendeeTemplate(toNumber, variables = null) {
  const sid = assertEnv('MENSAJE4_SID');
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid, variables);
}

async function sendCorrectionTemplate(toNumber, variables) {
  const sid = assertEnv('MENSAJE_CORREGIR_SID');
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid, variables);
}

async function sendAppointmentTemplate(toNumber, variables = null) {
  const sid = assertEnv('MENSAJE_CITA_SID');
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid, variables);
}

async function sendContinuationTemplate(toNumber, variables = null) {
  const sid = assertEnv('MENSAJE_AUSENCIA_SID');
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid, variables);
}

// ✅ Gravedad
async function sendSeverityTemplate(toNumber) {
  const sid = assertEnv('MENSAJE_GRAVEDAD_SID');
  console.log('🧩 MENSAJE_GRAVEDAD_SID =', sid);
  return sendTemplateMessage(toNumber, FROM_NUMBER, sid);
}

module.exports = {
  sendInitialTemplate,
  sendAttendeeTemplate,
  sendCorrectionTemplate,
  sendAppointmentTemplate,
  sendContinuationTemplate,
  sendSeverityTemplate
};
