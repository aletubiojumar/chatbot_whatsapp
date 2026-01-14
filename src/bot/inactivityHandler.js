// inactivityHandler.js
const conversationManager = require('./conversationManager');
const { sendSimpleMessageWithText, sendTemplateMessage } = require('./sendMessage');
const { isWithinSendWindow, nextSendTimeMs } = require('./timeWindow');

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;

// Tiempo de inactividad antes del primer aviso
const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // 1 minuto (pruebas)

// Tiempo de espera después del mensaje de continuación
const CONTINUATION_TIMEOUT = 5 * 60 * 1000; // 5 minutos (pruebas)

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isInactivityEligible(conv) {
  if (!conv) return false;
  if (!conv.lastMessageAt) return false;

  // No aplicar si ya está completada/escalada o esperando confirmación de continuación
  if (conv.status === 'completed' || conv.status === 'escalated') return false;
  if (conv.status === 'awaiting_continuation') return false;

  // Si estamos esperando admin offer, no metemos inactividad
  if (conv.status === 'awaiting_admin_offer') return false;

  return true;
}

/**
 * Obtiene conversaciones que necesitan mensaje de inactividad
 */
function getConversationsNeedingInactivityPrompt() {
  const all = conversationManager.getConversations();
  const now = Date.now();

  return Object.values(all).filter(conv => {
    if (!isInactivityEligible(conv)) return false;

    // ✅ Usar lastMessageAt directamente (se actualiza con CUALQUIER mensaje, bot o usuario)
    if (!conv.lastMessageAt) return false;

    const elapsed = now - conv.lastMessageAt;
    return elapsed >= INACTIVITY_TIMEOUT;
  });
}

/**
 * Guarda el "estado" al que debemos volver cuando el usuario pulse "Sí".
 */
function rememberReturnState(phoneNumber) {
  const conv = conversationManager.getConversation(phoneNumber);
  if (!conv) return;

  conversationManager.createOrUpdateConversation(phoneNumber, {
    continuationReturn: {
      stage: conv.stage,
      status: conv.status,
      lastPromptType: conv.lastPromptType || 'text',
      lastInteractive: conv.lastInteractive || null
    }
  });
}

/**
 * Reenvía el último mensaje interactivo guardado
 */
async function resendLastInteractive(phoneNumber) {
  const conv = conversationManager.getConversation(phoneNumber);

  // Buscar en continuationReturn primero, luego en la conversación actual
  const li = conv?.continuationReturn?.lastInteractive || conv?.lastInteractive;

  console.log('🔍 Debug resendLastInteractive:');
  console.log('   continuationReturn:', conv?.continuationReturn);
  console.log('   lastInteractive directo:', conv?.lastInteractive);
  console.log('   li final:', li);

  if (!li) {
    console.log('⚠️  No hay lastInteractive guardado. Obteniendo último mensaje del bot...');

    // Intentar obtener el último mensaje no vacío del bot del historial
    const lastMsg = conversationManager.getLastNonEmptyBotMessage(phoneNumber);
    if (lastMsg && lastMsg.trim()) {
      console.log(`✅ Reenviando último mensaje del historial: ${lastMsg.substring(0, 50)}...`);
      await sendSimpleMessageWithText(phoneNumber, FROM_NUMBER, lastMsg);
      return;
    }

    console.log('⚠️  No hay mensajes en el historial. Enviando texto genérico.');
    await sendSimpleMessageWithText(phoneNumber, FROM_NUMBER, 'Perfecto, continuemos.');
    return;
  }

  if (li.kind === 'template') {
    console.log(`✅ Reenviando template: ${li.sid}`);

    // OJO: NO pasar ContentVariables si no existen / están vacías
    const vars =
      li.variables &&
        typeof li.variables === 'object' &&
        !Array.isArray(li.variables) &&
        Object.keys(li.variables).length > 0
        ? li.variables
        : null;

    await sendTemplateMessage(phoneNumber, FROM_NUMBER, li.sid, vars);

    // ✅ Cambiar status para evitar reenvío en bucle
    conversationManager.createOrUpdateConversation(phoneNumber, {
      status: 'responded',
      lastMessageAt: Date.now(),
      inactivityCheckAt: null
    });

    return;
  }

  if (li.kind === 'text') {
    console.log(`✅ Reenviando texto: ${li.body}`);
    await sendSimpleMessageWithText(phoneNumber, FROM_NUMBER, li.body);
    return;
  }

  console.log('⚠️  Tipo de lastInteractive desconocido. Enviando texto genérico.');
  await sendSimpleMessageWithText(phoneNumber, FROM_NUMBER, 'Perfecto, continuemos.');
}

/**
 * Procesa conversaciones inactivas y envía mensaje de ausencia
 */
async function processInactiveConversations() {
  console.log('🔍 Verificando conversaciones inactivas...');

  if (!isWithinSendWindow()) {
    const ms = nextSendTimeMs();
    console.log(`⏰ Fuera de horario. Inactividad reprogramada en ${Math.round(ms / 60000)} min.`);
    return;
  }

  const conversations = getConversationsNeedingInactivityPrompt();

  console.log(`📊 Total de conversaciones: ${Object.keys(conversationManager.getConversations()).length}`);
  console.log(`📤 Conversaciones inactivas detectadas: ${conversations.length}`);

  if (conversations.length === 0) {
    console.log('✅ No hay conversaciones inactivas');
    return;
  }

  console.log(`📤 Procesando ${conversations.length} conversación(es) inactiva(s)...`);

  for (const conv of conversations) {
    try {
      console.log(`   📱 Enviando mensaje de continuación a: ${conv.phoneNumber}`);

      // Guardamos estado para poder "volver atrás" al pulsar Sí
      rememberReturnState(conv.phoneNumber);

      // Enviar template "¿Desea continuar la conversación?"
      await sendTemplateMessage(conv.phoneNumber, FROM_NUMBER, MENSAJE_AUSENCIA_SID);

      conversationManager.createOrUpdateConversation(conv.phoneNumber, {
        status: 'awaiting_continuation',
        continuationAskedAt: Date.now(),
        continuationTimeoutAt: Date.now() + CONTINUATION_TIMEOUT,
        inactivityCheckAt: null
      });

      console.log(`✅ Mensaje de continuación enviado a ${conv.phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error enviando mensaje de continuación a ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Procesa continuaciones expiradas
 */
async function processExpiredContinuations() {
  const all = conversationManager.getConversations();
  const now = Date.now();

  const expired = Object.values(all).filter(
    c => c.status === 'awaiting_continuation' && c.continuationTimeoutAt && c.continuationTimeoutAt <= now
  );

  if (expired.length === 0) {
    console.log('✅ No hay continuaciones expiradas');
    return;
  }

  console.log(`⏰ ${expired.length} continuaciones expiradas. Marcando como finalizadas...`);

  for (const conv of expired) {
    conversationManager.createOrUpdateConversation(conv.phoneNumber, {
      status: 'expired_no_continuation',
      stage: 'completed',
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      continuationReturn: null
    });
  }
}

/**
 * Si estamos esperando "continuar", intercepta el mensaje del usuario.
 * ✅ Si dice "Sí" -> reenviar el último mensaje interactivo (lista/botones/texto)
 * ✅ Si dice "No" -> escalar a administración
 * ✅ Si no es claro -> pedir Sí/No
 */
function handleContinuationResponse(mensaje, senderNumber) {
  const conv = conversationManager.getConversation(senderNumber);
  if (!conv || conv.status !== 'awaiting_continuation') return null;

  const t = normalizeText(mensaje);

  const isYes =
    t === 'si' ||
    t === 'sí' ||
    t === 's' ||
    t === 'vale' ||
    t === 'ok' ||
    t.includes('continuar') ||
    t.includes('quiero continuar');

  const isNo = t === 'no' || t.includes('no quiero') || t.includes('no continuar');

  if (isYes) {
    // Restaurar estado previo PRESERVANDO lastInteractive
    const ret = conv.continuationReturn || {};

    console.log('🔍 Restaurando estado previo:');
    console.log('   ret:', ret);
    console.log('   ret.lastInteractive:', ret.lastInteractive);

    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: ret.stage || conv.stage,
      status: 'responded',
      lastPromptType: ret.lastPromptType || conv.lastPromptType,
      lastInteractive: ret.lastInteractive || conv.lastInteractive,  // ✅ PRESERVAR
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null
    });

    console.log(`✅ Usuario ${senderNumber} quiere continuar. Reenviando último mensaje...`);

    // 🔥 CLAVE: reenviar el último mensaje anterior (template/lista)
    // Lo hacemos ASYNC sin devolver texto extra.
    setTimeout(() => {
      resendLastInteractive(senderNumber).catch(err =>
        console.error('❌ Error reenviando último mensaje interactivo:', err.message)
      );
    }, 250);

    // Devolvemos vacío para que no aparezca "Por favor indique..."
    return ' ';
  }

  if (isNo) {
    // ✅ Cerrar conversación para que NO vuelva a entrar en inactividad
    conversationManager.markAsEscalated(senderNumber);

    // Limpieza extra (opcional pero recomendable)
    conversationManager.createOrUpdateConversation(senderNumber, {
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null,
      continuationReturn: null
    });

    console.log(`✅ Usuario ${senderNumber} no quiere continuar (escalado y cerrado)`);
    return 'Administración se pondrá en contacto con usted. Un saludo.';
  }

  return 'Por favor, responda "Sí" o "No" para continuar la conversación.';
}

/**
 * Inicia el scheduler de inactividad
 */
function startInactivityScheduler() {
  console.log('🚀 Iniciando scheduler de inactividad...');
  console.log('⏰ Se ejecutará cada 1 minuto');

  console.log('\n🔄 Ejecutando verificación inicial de inactividad...');
  processInactiveConversations().catch(console.error);
  processExpiredContinuations().catch(console.error);

  setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Ejecutando verificación de inactividad...`);
    try {
      await processInactiveConversations();
      await processExpiredContinuations();
    } catch (error) {
      console.error('❌ Error en scheduler de inactividad:', error);
    }
  }, 1 * 60 * 1000); // 1 minuto
}

module.exports = {
  startInactivityScheduler,
  processInactiveConversations,
  processExpiredContinuations,
  handleContinuationResponse,
  INACTIVITY_TIMEOUT,
  CONTINUATION_TIMEOUT
};