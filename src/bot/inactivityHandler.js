// src/bot/inactivityHandler.js
const conversationManager = require('./conversationManager');
const { sendAIGeneratedMessage } = require('./sendMessage');
const { generateResponse } = require('../ai/aiModel');
require('dotenv').config();

// ⭐ Configuración desde .env (en horas, convertido a ms)
const INACTIVITY_TIMEOUT_HOURS = Number(process.env.INACTIVITY_TIMEOUT_HOURS || 1);
const INACTIVITY_SNOOZE_HOURS = Number(process.env.INACTIVITY_SNOOZE_HOURS || 6);

const INACTIVITY_TIMEOUT_MS = INACTIVITY_TIMEOUT_HOURS * 60 * 60 * 1000;
const SNOOZE_AFTER_SEND_MS = INACTIVITY_SNOOZE_HOURS * 60 * 60 * 1000;

let _timer = null;

/**
 * Inicia el scheduler de inactividad
 * Verifica cada minuto si hay conversaciones inactivas
 */
function startInactivityScheduler() {
  if (_timer) {
    console.log('⚠️  Scheduler de inactividad ya está corriendo');
    return;
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║      SCHEDULER DE INACTIVIDAD INICIADO                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚙️  Configuración actual:');
  console.log(`   ⏱️  Timeout de inactividad: ${INACTIVITY_TIMEOUT_HOURS} horas`);
  console.log(`   😴 Snooze después de mensaje: ${INACTIVITY_SNOOZE_HOURS} horas`);
  console.log(`   🔄 Frecuencia de verificación: cada 1 minuto`);
  console.log('');
  console.log('ℹ️  Nota: Los horarios y días se gestionan en AWS, no en el código');
  console.log('');

  // Ejecutar verificación inicial
  console.log('🔄 Ejecutando verificación inicial de inactividad...\n');
  checkInactiveConversations().catch((e) =>
    console.error('❌ Error en verificación inicial de inactividad:', e?.message || e)
  );

  // Programar verificaciones cada minuto
  _timer = setInterval(() => {
    checkInactiveConversations().catch((e) =>
      console.error('❌ Error en verificación de inactividad:', e?.message || e)
    );
  }, 60 * 1000);

  console.log('✅ Scheduler de inactividad configurado\n');
}

/**
 * Verifica conversaciones inactivas y envía mensajes de continuación
 */
async function checkInactiveConversations() {
  console.log('🔍 Verificando conversaciones inactivas...');

  const inactive = conversationManager.getInactiveConversations(INACTIVITY_TIMEOUT_MS);

  console.log(`📊 Total de conversaciones inactivas: ${inactive.length}`);

  if (!inactive.length) {
    console.log('✅ No hay conversaciones inactivas');
    return;
  }

  for (const conv of inactive) {
    const phone = conv.phoneNumber || conv.phone || conv.from || conv.id;
    if (!phone) {
      console.log('⚠️  Conversación sin número de teléfono, saltando...');
      continue;
    }

    console.log(`\n📱 Procesando inactividad: ${phone}`);
    console.log(`   Última actividad: ${new Date(conv.lastUserMessageAt).toLocaleString()}`);
    console.log(`   Stage actual: ${conv.stage}`);

    try {
      // Construir contexto para Gemini AI
      const context = {
        phoneNumber: phone,
        status: conv.status,
        stage: conv.stage,
        userData: conv.userData,
        metadata: {
          attempts: conv.attempts || 0,
          isInactivityMessage: true,
          lastActivity: new Date(conv.lastUserMessageAt).toLocaleString()
        }
      };

      // Generar mensaje de continuación con Gemini AI
      const continuationPrompt = `El usuario ha estado inactivo durante ${INACTIVITY_TIMEOUT_HOURS} hora(s) en medio de una conversación.

Última etapa de la conversación: ${conv.stage}

Envía un mensaje BREVE y AMABLE preguntando si:
1. Sigue disponible para continuar
2. O prefiere que le contacte administración

IMPORTANTE:
- Máximo 2 líneas
- Tono muy amable y comprensivo
- Ofrecer opción de hablar con humano
- NO repetir preguntas anteriores aún`;

      const continuationMessage = await generateResponse(continuationPrompt, context);

      // Enviar mensaje
      await sendAIGeneratedMessage(phone, continuationMessage);

      // "Dormir" la conversación para evitar spam
      conversationManager.snoozeConversation(phone, SNOOZE_AFTER_SEND_MS);

      console.log(`✅ Mensaje de continuación enviado`);
      console.log(`   Preview: ${continuationMessage.substring(0, 50)}...`);
      console.log(`   Snoozed por: ${INACTIVITY_SNOOZE_HOURS} horas`);

    } catch (err) {
      console.error(`❌ Error enviando mensaje de continuación a ${phone}:`, err?.message || err);
      
      // Si el número es inválido, marcarlo para no insistir
      if (/not a valid phone number/i.test(err?.message || '')) {
        conversationManager.createOrUpdateConversation(phone, { 
          status: 'invalid_number',
          error: 'Número de teléfono inválido'
        });
        console.log(`⚠️  Número marcado como inválido: ${phone}`);
      }
    }
  }
}

/**
 * Maneja la respuesta del usuario a la pregunta de continuación
 * @param {string} incomingMessage - Mensaje del usuario
 * @param {string} senderNumber - Número del usuario
 * @returns {string|null} - Respuesta a enviar o null si no aplica
 */
function handleContinuationResponse(incomingMessage, senderNumber) {
  const conversation = conversationManager.getConversation(senderNumber);
  
  // Solo procesar si la conversación está en estado de espera de continuación
  if (!conversation || conversation.status !== 'awaiting_continuation') {
    return null; // No estamos esperando continuación, seguir flujo normal
  }

  const msg = incomingMessage.toLowerCase().trim();

  // Usuario quiere continuar
  if (msg.includes('si') || msg.includes('sí') || msg.includes('continuar') || msg.includes('claro')) {
    console.log('✅ Usuario acepta continuar');
    
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'pending',
      lastUserMessageAt: Date.now(),
      snoozedUntil: null
    });
    
    return 'Perfecto, continuemos. Por favor, responda a la última pregunta que le hicimos.';
  }

  // Usuario quiere hablar con administración o no puede continuar
  if (msg.includes('no') || msg.includes('administr') || msg.includes('humano') || msg.includes('persona')) {
    console.log('🚨 Usuario solicita contacto humano');
    
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'escalated',
      stage: 'escalated',
      escalatedAt: Date.now(),
      escalationReason: 'Usuario solicitó contacto con administración por inactividad'
    });
    
    return 'Entendido. Un miembro de nuestro equipo se pondrá en contacto con usted pronto. Gracias por su paciencia.';
  }

  // Respuesta no clara
  console.log('⚠️  Respuesta ambigua del usuario');
  return 'Por favor, responda "Sí" para continuar o "No" si prefiere que le contacte administración.';
}

/**
 * Detiene el scheduler de inactividad
 */
function stopInactivityScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('🛑 Scheduler de inactividad detenido');
  }
}

/**
 * Ejecuta verificación manual (útil para testing)
 */
async function runManualInactivityCheck() {
  console.log('\n🔧 Ejecutando verificación MANUAL de inactividad...\n');
  
  try {
    await checkInactiveConversations();
    console.log('\n✅ Verificación manual de inactividad completada\n');
  } catch (error) {
    console.error('\n❌ Error en verificación manual:', error);
    throw error;
  }
}

module.exports = {
  startInactivityScheduler,
  stopInactivityScheduler,
  checkInactiveConversations,
  handleContinuationResponse,
  runManualInactivityCheck
};