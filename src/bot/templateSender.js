const { sendTemplateMessage } = require('./sendMessage');
require('dotenv').config();

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER
const MENSAJE2_SID = process.env.MENSAJE2_SID
const MENSAJE4_SID = process.env.MENSAJE4_SID
const MENSAJE_CITA_SID = process.env.MENSAJE_CITA_SID
const MENSAJE_CORREGIR_SID = process.env.MENSAJE_CORREGIR_SID
const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID

async function sendVerificationTemplate(toNumber) {
  await sendTemplateMessage(toNumber, FROM_NUMBER, MENSAJE2_SID);
  console.log(`✅ Template mensaje2 enviado a ${toNumber}`);
  return true;
}

async function sendAttendeeTemplate(toNumber) {
  await sendTemplateMessage(toNumber, FROM_NUMBER, MENSAJE4_SID);
  console.log(`✅ Template mensaje4 enviado a ${toNumber}`);
  return true;
}

// ✅ aquí pasamos variables
async function sendCorrectionTemplate(toNumber, variables) {
  await sendTemplateMessage(toNumber, FROM_NUMBER, MENSAJE_CORREGIR_SID, variables);
  console.log(`✅ Template mensaje_corregir enviado a ${toNumber}`);
  return true;
}

async function sendAppointmentTemplate(toNumber) {
  await sendTemplateMessage(toNumber, FROM_NUMBER, MENSAJE_CITA_SID);
  console.log(`✅ Template mensaje_cita enviado a ${toNumber}`);
  return true;
}

async function sendContinuationTemplate(toNumber) {
  await sendTemplateMessage(toNumber, FROM_NUMBER, MENSAJE_AUSENCIA_SID);
  console.log(`✅ Template mensaje_ausencia enviado a ${toNumber}`);
  return true;
}

module.exports = {
  sendVerificationTemplate,
  sendAttendeeTemplate,
  sendCorrectionTemplate,
  sendAppointmentTemplate,
  sendContinuationTemplate
};