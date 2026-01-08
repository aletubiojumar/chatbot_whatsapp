const conversationManager = require('./conversationManager');
const { sendTemplateMessage, sendSimpleMessageWithText } = require('./sendMessage');
require('dotenv').config();

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const CONTENT_SID = process.env.CONTENT_SID;

const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');

/**
 * Procesa recordatorios pendientes
 * - Si está fuera de horario (08-21), NO envía y reprograma al próximo 08:00
 */
async function processReminders() {
  console.log('\n🔔 Verificando conversaciones que necesitan recordatorio...');

  const conversations = conversationManager.getConversationsNeedingReminder();

  if (conversations.length === 0) {
    console.log('✅ No hay recordatorios pendientes');
    return;
  }

  // Si fuera de horario, reprogramar y salir
  if (!isWithinSendWindow()) {
    const sendAt = nextSendTimeMs(new Date());
    for (const conv of conversations) {
      conversationManager.createOrUpdateConversation(conv.phoneNumber, { nextReminderAt: sendAt });
    }
    console.log(`🕘 Fuera de horario. Recordatorios reprogramados para ${new Date(sendAt).toLocaleString()}`);
    return;
  }

  console.log(`📤 Enviando ${conversations.length} recordatorio(s)...`);

  for (const conv of conversations) {
    try {
      await sendTemplateMessage(conv.phoneNumber, FROM_NUMBER, CONTENT_SID);
      conversationManager.incrementAttempts(conv.phoneNumber);
      console.log(`✅ Recordatorio enviado a ${conv.phoneNumber} (Intento ${conv.attempts + 1}/3)`);
    } catch (error) {
      console.error(`❌ Error enviando recordatorio a ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Procesa conversaciones que necesitan escalación (3 intentos sin respuesta)
 * - También respeta horario (si fuera, reprograma la "escalación" al próximo 08:00)
 */
async function processEscalations() {
  console.log('\n⚠️  Verificando conversaciones para escalar...');

  const conversations = conversationManager.getConversationsNeedingEscalation();

  if (conversations.length === 0) {
    console.log('✅ No hay conversaciones para escalar');
    return;
  }

  if (!isWithinSendWindow()) {
    const sendAt = nextSendTimeMs(new Date());
    // No tienes un campo específico para "escalateAt", así que usamos nextReminderAt
    for (const conv of conversations) {
      conversationManager.createOrUpdateConversation(conv.phoneNumber, { nextReminderAt: sendAt });
    }
    console.log(`🕘 Fuera de horario. Escalaciones reprogramadas para ${new Date(sendAt).toLocaleString()}`);
    return;
  }

  console.log(`📞 Escalando ${conversations.length} conversación(es)...`);

  for (const conv of conversations) {
    try {
      const mensajeEscalacion =
        'Debido a que no ha habido respuesta se procederá a la llamada al asegurado/a por parte del perito.\nUn saludo.';

      await sendSimpleMessageWithText(conv.phoneNumber, FROM_NUMBER, mensajeEscalacion);
      conversationManager.markAsEscalated(conv.phoneNumber);

      console.log(`✅ Conversación escalada: ${conv.phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error escalando conversación ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Inicia el scheduler de recordatorios
 * Ejecuta cada 6 horas
 */
function startReminderScheduler() {
  console.log('🚀 Iniciando scheduler de recordatorios...');
  console.log('⏰ Se ejecutará cada 6 horas');

  console.log('\n🔄 Ejecutando verificación inicial...');
  processReminders().catch(console.error);
  processEscalations().catch(console.error);

  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Ejecutando verificación de recordatorios...`);
    try {
      await processReminders();
      await processEscalations();
    } catch (error) {
      console.error('❌ Error en scheduler:', error);
    }
  }, 21600000); // 6 horas
}

module.exports = {
  startReminderScheduler,
  processReminders,
  processEscalations
};
