// inactivityHandler.js
const conversationManager = require('./conversationManager');
const { sendSimpleMessageWithText, sendTemplateMessage } = require('./sendMessage');
const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;

// Tiempo de inactividad antes del primer aviso
const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // ⚡ 1 MINUTO PARA PRUEBAS

// Tiempo de espera después del mensaje de continuación
const CONTINUATION_TIMEOUT = 5 * 60 * 1000; // ⚡ 5 MINUTO PARA PRUEBAS

/**
 * Obtiene el último mensaje enviado por el bot a un usuario
 */
function getLastBotMessage(phoneNumber) {
  const conversation = conversationManager.getConversation(phoneNumber);
  if (!conversation || !conversation.responses) return null;

  // Buscar el último mensaje del bot (tipo 'bot')
  const botMessages = conversation.responses.filter(r => r.type === 'bot');
  if (botMessages.length === 0) return null;

  return botMessages[botMessages.length - 1].message;
}

/**
 * Procesa conversaciones inactivas (usuario respondió pero luego dejó de responder)
 * - Detecta conversaciones que llevan 2h sin respuesta del usuario
 * - Envía mensaje: "¿Desea continuar la conversación?"
 */
async function processInactiveConversations() {
  console.log('\n🔍 Verificando conversaciones inactivas...');

  const conversations = conversationManager.getInactiveConversations(INACTIVITY_TIMEOUT);

  if (conversations.length === 0) {
    console.log('✅ No hay conversaciones inactivas');
    return;
  }

  // Si estamos fuera de horario, reprogramar para el próximo horario válido
  if (!isWithinSendWindow()) {
    const sendAt = nextSendTimeMs(new Date());
    for (const conv of conversations) {
      conversationManager.createOrUpdateConversation(conv.phoneNumber, {
        inactivityCheckAt: sendAt
      });
    }
    console.log(`🕘 Fuera de horario. Verificación de inactividad reprogramada para ${new Date(sendAt).toLocaleString()}`);
    return;
  }

  console.log(`📤 Procesando ${conversations.length} conversación(es) inactiva(s)...`);

  for (const conv of conversations) {
    try {
      // Usar template con botones "¿Desea continuar la conversación?"
      await sendTemplateMessage(conv.phoneNumber, FROM_NUMBER, MENSAJE_AUSENCIA_SID);
      
      conversationManager.createOrUpdateConversation(conv.phoneNumber, {
        status: 'awaiting_continuation',
        inactivityCheckAt: null,
        continuationAskedAt: Date.now(),
        continuationTimeoutAt: Date.now() + CONTINUATION_TIMEOUT
      });

      console.log(`✅ Mensaje de continuación enviado a ${conv.phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error enviando mensaje de continuación a ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Procesa conversaciones que necesitan finalización
 * - Usuario no respondió al mensaje de continuación después de 2h
 * - O respondió "no"
 */
async function processExpiredContinuations() {
  console.log('\n⏰ Verificando conversaciones con tiempo de continuación expirado...');

  const conversations = conversationManager.getExpiredContinuations();

  if (conversations.length === 0) {
    console.log('✅ No hay continuaciones expiradas');
    return;
  }

  // Si estamos fuera de horario, reprogramar
  if (!isWithinSendWindow()) {
    const sendAt = nextSendTimeMs(new Date());
    for (const conv of conversations) {
      conversationManager.createOrUpdateConversation(conv.phoneNumber, {
        continuationTimeoutAt: sendAt
      });
    }
    console.log(`🕘 Fuera de horario. Finalizaciones reprogramadas para ${new Date(sendAt).toLocaleString()}`);
    return;
  }

  console.log(`📞 Finalizando ${conversations.length} conversación(es)...`);

  for (const conv of conversations) {
    try {
      const mensaje = 'Administración se pondrá en contacto con usted. Un saludo.';
      
      await sendSimpleMessageWithText(conv.phoneNumber, FROM_NUMBER, mensaje);
      
      conversationManager.createOrUpdateConversation(conv.phoneNumber, {
        status: 'expired_no_continuation',
        stage: 'completed',
        continuationTimeoutAt: null
      });

      console.log(`✅ Conversación finalizada por inactividad: ${conv.phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error finalizando conversación ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Maneja la respuesta del usuario al mensaje de continuación
 * @param {string} mensaje - Mensaje del usuario
 * @param {string} senderNumber - Número del usuario
 * @returns {string|null} - Respuesta a enviar o null si no aplica
 */
function handleContinuationResponse(mensaje, senderNumber) {
  const conversation = conversationManager.getConversation(senderNumber);
  
  if (!conversation || conversation.status !== 'awaiting_continuation') {
    return null; // No estamos esperando respuesta de continuación
  }

  const mensajeLower = mensaje.toLowerCase().trim();

  // Usuario quiere continuar
  if (
    mensajeLower.includes('sí') ||
    mensajeLower.includes('si') ||
    mensajeLower === 's' ||
    mensajeLower === 'vale' ||
    mensajeLower === 'ok' ||
    mensajeLower === 'continuar' ||
    mensajeLower.includes('quiero continuar')
  ) {
    // Obtener el último mensaje del bot antes de la inactividad
    const lastBotMessage = getLastBotMessage(senderNumber);
    
    // Restaurar el estado anterior (antes de awaiting_continuation)
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'responded',
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null,
      lastMessageAt: Date.now()
    });

    console.log(`✅ Usuario ${senderNumber} quiere continuar la conversación`);
    
    // En lugar de reenviar el último mensaje (que puede ser un template),
    // enviamos un mensaje de texto apropiado según la etapa
    return getHelpMessageForStage(conversation.stage);
  }

  // Usuario NO quiere continuar
  if (
    mensajeLower.includes('no') ||
    mensajeLower === 'n' ||
    mensajeLower.includes('no quiero') ||
    mensajeLower.includes('no deseo') ||
    mensajeLower.includes('cancelar')
  ) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'user_declined_continuation',
      stage: 'completed',
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null
    });

    console.log(`✅ Usuario ${senderNumber} no quiere continuar la conversación`);
    
    return 'Administración se pondrá en contacto con usted. Un saludo.';
  }

  // Si la respuesta no es clara, pedir clarificación
  return 'Por favor, responda "Sí" o "No" para continuar la conversación.';
}

/**
 * Obtiene un mensaje de ayuda según la etapa de la conversación
 */
function getHelpMessageForStage(stage) {
  const responses = require('./responses');
  
  const helpMessages = {
    'initial': responses.initialStageHelp,
    'identity_confirmed': 'Por favor, responda a la pregunta de verificación de datos.',
    'awaiting_corrections': responses.pedirDatosCorregidos,
    'confirming_corrections': 'Por favor, responda: "Sí, son correctos" o "No, hay algún error".',
    'attendee_select': 'Por favor, indique quién atenderá al perito.',
    'awaiting_claim_type': 'Por favor, indique la tipología del siniestro (número del 1 al 18).',
    'appointment_select': 'Por favor, seleccione el tipo de cita: "Presencial" o "Telemática".',
    'awaiting_severity': 'Por favor, indique el tramo de gravedad (número del 1 al 5).',
    'awaiting_date': 'Por favor, indique la fecha que mejor le convenga.'
  };

  return helpMessages[stage] || 'Por favor, continúe respondiendo según las opciones indicadas.';
}

/**
 * Inicia el scheduler de verificación de inactividad
 * Se ejecuta cada 30 minutos
 */
function startInactivityScheduler() {
  console.log('🚀 Iniciando scheduler de inactividad...');
  console.log('⏰ Se ejecutará cada 30 minutos');

  console.log('\n🔄 Ejecutando verificación inicial de inactividad...');
  processInactiveConversations().catch(console.error);
  processExpiredContinuations().catch(console.error);

  // Ejecutar cada 30 minutos
  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Ejecutando verificación de inactividad...`);
    try {
      await processInactiveConversations();
      await processExpiredContinuations();
    } catch (error) {
      console.error('❌ Error en scheduler de inactividad:', error);
    }
  }, 30 * 60 * 1000); // 30 minutos
}

module.exports = {
  startInactivityScheduler,
  processInactiveConversations,
  processExpiredContinuations,
  handleContinuationResponse,
  INACTIVITY_TIMEOUT,
  CONTINUATION_TIMEOUT
};