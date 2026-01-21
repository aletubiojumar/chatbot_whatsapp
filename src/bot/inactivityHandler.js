// src/bot/inactivityHandler.js
const conversationManager = require('./conversationManager');
const { sendTemplateMessage } = require('./sendMessage');
const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');

const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;

// Inactividad antes de mandar “ausencia/continuación”
const INACTIVITY_TIMEOUT = Number(process.env.INACTIVITY_TIMEOUT_MS || 1 * 60 * 1000); // 1 min pruebas
// Después de mandar el mensaje de ausencia, cuánto tiempo “snooze” para no spamear
const SNOOZE_AFTER_SEND = Number(process.env.INACTIVITY_SNOOZE_MS || 60 * 60 * 1000); // 1h

let _timer = null;

function startInactivityScheduler() {
  if (_timer) return;

  console.log('🚀 Iniciando scheduler de inactividad...');
  console.log('⏰ Se ejecutará cada 1 minuto');

  // Ejecuta una vez al arrancar
  console.log('\n🔄 Ejecutando verificación inicial de inactividad...');
  checkInactiveConversations().catch((e) =>
    console.error('❌ Error en verificación inicial de inactividad:', e?.message || e)
  );

  _timer = setInterval(() => {
    checkInactiveConversations().catch((e) =>
      console.error('❌ Error en verificación de inactividad:', e?.message || e)
    );
  }, 60 * 1000);
}

async function checkInactiveConversations() {
  console.log('🔍 Verificando conversaciones inactivas...');

  // ✅ ESTA FUNCIÓN EXISTE en tu conversationManager.js
  const inactive = conversationManager.getInactiveConversations(INACTIVITY_TIMEOUT);

  console.log(`📊 Total de conversaciones inactivas: ${inactive.length}`);

  if (!inactive.length) {
    console.log('✅ No hay conversaciones inactivas');
    return;
  }

  // Si estás fuera de horario, no mandes (y no reintentes cada minuto)
  if (!isWithinSendWindow()) {
    const next = new Date(nextSendTimeMs()).toISOString();
    console.log(`🕐 Fuera de ventana de envío. Próximo envío permitido: ${next}`);
    return;
  }

  for (const conv of inactive) {
    const phone = conv.phoneNumber || conv.phone || conv.from || conv.id;
    if (!phone) continue;

    console.log(`   📱 Enviando mensaje de continuación a: ${phone}`);
    try {
      if (!MENSAJE_AUSENCIA_SID) {
        console.error('❌ Falta MENSAJE_AUSENCIA_SID en .env');
        return;
      }

      await sendTemplateMessage({
        to: phone, // puede venir como whatsapp:+..., o +..., o 34...; sendMessage lo normaliza
        contentSid: MENSAJE_AUSENCIA_SID,
        contentVariables: {} // vacío
      });

      // Evita que te lo dispare cada minuto: “duerme” la conversación
      conversationManager.snoozeConversation(phone, SNOOZE_AFTER_SEND);

      console.log(`✅ Mensaje de continuación enviado a ${phone}`);
    } catch (err) {
      console.error(`❌ Error enviando continuación a ${phone}: ${err?.message || err}`);
      // Si el número es inválido, marca para no insistir infinitamente
      if (/not a valid phone number/i.test(err?.message || '')) {
        conversationManager.createOrUpdateConversation(phone, { status: 'invalid_number' });
      }
    }
  }
}

function stopInactivityScheduler() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  startInactivityScheduler,
  stopInactivityScheduler,
  checkInactiveConversations
};
