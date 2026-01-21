// src/bot/inactivityHandler.js
const conversationManager = require('./conversationManager');
const { sendTemplateMessage } = require('./sendMessage');
const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');

const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;

// Inactividad antes de mandar "ausencia/continuación"
const INACTIVITY_TIMEOUT = Number(process.env.INACTIVITY_TIMEOUT_MS || 1 * 60 * 1000); // 1 min pruebas
// Después de mandar el mensaje de ausencia, cuánto tiempo "snooze" para no spamear
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

      // ✅ CORREGIDO: sendTemplateMessage(toNumber, contentSid, contentVariables)
      await sendTemplateMessage(phone, MENSAJE_AUSENCIA_SID, {});

      // Evita que te lo dispare cada minuto: "duerme" la conversación
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

// ✅ FUNCIÓN PARA MANEJAR LA RESPUESTA A LA PREGUNTA DE CONTINUACIÓN
function handleContinuationResponse(incomingMessage, senderNumber) {
  const conversation = conversationManager.getConversation(senderNumber);
  
  if (!conversation || conversation.status !== 'awaiting_continuation') {
    return null; // No estamos esperando continuación, seguir flujo normal
  }

  const msg = incomingMessage.toLowerCase().trim();

  // Si dice que SÍ quiere continuar
  if (msg.includes('si') || msg.includes('sí') || msg.includes('continuar')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'pending',
      lastUserMessageAt: Date.now()
    });
    return 'Perfecto, continuemos. Por favor, responda a la última pregunta que le hicimos.';
  }

  // Si dice que NO o quiere hablar con administración
  if (msg.includes('no') || msg.includes('administr')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'escalated',
      stage: 'escalated',
      escalatedAt: Date.now()
    });
    return 'Entendido. Un miembro de nuestro equipo se pondrá en contacto con usted. Gracias.';
  }

  // Respuesta no clara
  return 'Por favor, responda "Sí" para continuar o "No" si prefiere que le contacte administración.';
}

module.exports = {
  startInactivityScheduler,
  stopInactivityScheduler,
  checkInactiveConversations,
  handleContinuationResponse
};