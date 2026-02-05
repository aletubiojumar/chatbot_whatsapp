// src/bot/reminderScheduler.js
// Sistema de recordatorios automáticos usando Gemini AI
const conversationManager = require('./conversationManager');
const { sendAIGeneratedMessage } = require('./sendMessage');
const { generateResponse } = require('../ai/aiModel');
require('dotenv').config();

// ⭐ Configuración desde .env
const SCHEDULER_CHECK_INTERVAL_HOURS = Number(process.env.SCHEDULER_CHECK_INTERVAL_HOURS || 6);
const MAX_REMINDER_ATTEMPTS = Number(process.env.MAX_REMINDER_ATTEMPTS || 3);

// Convertir a milisegundos
const SCHEDULER_CHECK_INTERVAL_MS = SCHEDULER_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;

/**
 * Procesa recordatorios pendientes
 * Usa Gemini AI para generar recordatorios naturales y contextuales
 */
async function processReminders() {
  console.log('\n🔔 Verificando conversaciones que necesitan recordatorio...');
  console.log(`⚙️  Configuración: ${MAX_REMINDER_ATTEMPTS} intentos máximos`);

  const conversations = conversationManager.getConversationsNeedingReminder();

  if (conversations.length === 0) {
    console.log('✅ No hay recordatorios pendientes');
    return;
  }

  console.log(`📤 Enviando ${conversations.length} recordatorio(s)...`);

  for (const conv of conversations) {
    try {
      const currentAttempt = (conv.attempts || 0) + 1;
      
      console.log(`\n📱 Procesando: ${conv.phoneNumber}`);
      console.log(`   Intento: ${currentAttempt}/${MAX_REMINDER_ATTEMPTS}`);
      console.log(`   Stage: ${conv.stage}`);

      // Construir contexto para Gemini AI
      const context = {
        phoneNumber: conv.phoneNumber,
        status: conv.status,
        stage: conv.stage,
        userData: conv.userData,
        metadata: {
          attempts: conv.attempts || 0,
          isReminder: true,
          reminderNumber: currentAttempt
        }
      };

      // Generar mensaje de recordatorio con Gemini AI
      // El tono varía según el número de intento
      let reminderPrompt;
      
      if (currentAttempt === 1) {
        // Primer recordatorio: amable y suave
        reminderPrompt = `El usuario no ha respondido aún. Envía un recordatorio AMABLE y BREVE preguntando si ha podido revisar los datos.
        
Datos del siniestro:
- Dirección: ${conv.userData?.direccion || 'No disponible'}
- Fecha: ${conv.userData?.fecha || 'No disponible'}
- Nombre: ${conv.userData?.nombre || 'No disponible'}

IMPORTANTE: 
- Máximo 2 líneas
- Tono muy amable y comprensivo
- No presionar`;

      } else if (currentAttempt === 2) {
        // Segundo recordatorio: más directo pero aún cordial
        reminderPrompt = `Este es el segundo recordatorio. El usuario aún no ha respondido. Envía un mensaje DIRECTO pero CORDIAL recordando que necesitamos su confirmación.

IMPORTANTE:
- Máximo 2-3 líneas
- Tono profesional pero cercano
- Mencionar que es importante su respuesta`;

      } else {
        // Último recordatorio: urgente pero respetuoso
        reminderPrompt = `Este es el ÚLTIMO recordatorio antes de escalar. Envía un mensaje URGENTE pero RESPETUOSO indicando que necesitamos su respuesta urgentemente o el perito le llamará directamente.

IMPORTANTE:
- Máximo 3 líneas
- Tono urgente pero profesional
- Mencionar que es la última oportunidad antes de que el perito llame`;
      }

      const reminderMessage = await generateResponse(reminderPrompt, context);
      
      // Enviar mensaje
      await sendAIGeneratedMessage(conv.phoneNumber, reminderMessage);
      
      // Incrementar intentos (esto también programa el siguiente recordatorio)
      conversationManager.incrementAttempts(conv.phoneNumber);
      
      console.log(`✅ Recordatorio ${currentAttempt}/${MAX_REMINDER_ATTEMPTS} enviado`);
      console.log(`   Preview: ${reminderMessage.substring(0, 50)}...`);

    } catch (error) {
      console.error(`❌ Error enviando recordatorio a ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Procesa conversaciones que necesitan escalación
 * Se llama cuando se alcanza MAX_REMINDER_ATTEMPTS sin respuesta
 */
async function processEscalations() {
  console.log('\n⚠️  Verificando conversaciones para escalar...');
  console.log(`⚙️  Configuración: Escalar después de ${MAX_REMINDER_ATTEMPTS} intentos sin respuesta`);

  const conversations = conversationManager.getConversationsNeedingEscalation();

  if (conversations.length === 0) {
    console.log('✅ No hay conversaciones para escalar');
    return;
  }

  console.log(`📞 Escalando ${conversations.length} conversación(es)...`);

  for (const conv of conversations) {
    try {
      console.log(`\n🚨 Escalando: ${conv.phoneNumber}`);
      console.log(`   Intentos realizados: ${conv.attempts}`);
      console.log(`   Última actividad: ${new Date(conv.lastMessageAt).toLocaleString()}`);

      // Construir contexto para Gemini AI
      const context = {
        phoneNumber: conv.phoneNumber,
        status: 'escalated',
        stage: 'escalated',
        userData: conv.userData,
        metadata: {
          attempts: conv.attempts,
          isEscalation: true
        }
      };

      // Generar mensaje de escalación con Gemini AI
      const escalationPrompt = `El usuario no ha respondido después de ${MAX_REMINDER_ATTEMPTS} intentos. 
      
Envía un mensaje PROFESIONAL y DEFINITIVO informando que:
1. Debido a la falta de respuesta
2. El perito procederá a llamarle directamente
3. Agradecer su comprensión

IMPORTANTE:
- Máximo 3 líneas
- Tono profesional pero cordial
- NO usar tono de reproche
- Despedida cortés`;

      const escalationMessage = await generateResponse(escalationPrompt, context);

      // Enviar mensaje
      await sendAIGeneratedMessage(conv.phoneNumber, escalationMessage);
      
      // Marcar como escalada
      conversationManager.markAsEscalated(conv.phoneNumber);

      console.log(`✅ Conversación escalada exitosamente`);
      console.log(`   Preview: ${escalationMessage.substring(0, 50)}...`);

    } catch (error) {
      console.error(`❌ Error escalando conversación ${conv.phoneNumber}:`, error.message);
    }
  }
}

/**
 * Inicia el scheduler de recordatorios
 * Frecuencia configurable desde .env
 */
function startReminderScheduler() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         SCHEDULER DE RECORDATORIOS INICIADO                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚙️  Configuración actual:');
  console.log(`   🔄 Frecuencia de verificación: cada ${SCHEDULER_CHECK_INTERVAL_HOURS} horas`);
  console.log(`   📊 Intentos máximos: ${MAX_REMINDER_ATTEMPTS}`);
  console.log(`   ⏰ Intervalo entre recordatorios: ${conversationManager.REMINDER_INTERVAL_MS / (60 * 60 * 1000)} horas`);
  console.log('');
  console.log('ℹ️  Nota: Los horarios y días se gestionan en AWS, no en el código');
  console.log('');

  // Ejecutar verificación inicial al arrancar
  console.log('🔄 Ejecutando verificación inicial...\n');
  processReminders().catch(error => {
    console.error('❌ Error en verificación inicial de recordatorios:', error);
  });
  processEscalations().catch(error => {
    console.error('❌ Error en verificación inicial de escalaciones:', error);
  });

  // Programar ejecuciones periódicas
  const intervalId = setInterval(async () => {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Ejecutando verificación programada...`);
    
    try {
      await processReminders();
      await processEscalations();
    } catch (error) {
      console.error('❌ Error en scheduler:', error);
    }
  }, SCHEDULER_CHECK_INTERVAL_MS);

  console.log(`✅ Scheduler configurado. Próxima verificación en ${SCHEDULER_CHECK_INTERVAL_HOURS} horas\n`);

  // Retornar ID del intervalo por si se necesita detener
  return intervalId;
}

/**
 * Detiene el scheduler
 */
function stopReminderScheduler(intervalId) {
  if (intervalId) {
    clearInterval(intervalId);
    console.log('🛑 Scheduler de recordatorios detenido');
  }
}

/**
 * Ejecuta una verificación manual (útil para testing)
 */
async function runManualCheck() {
  console.log('\n🔧 Ejecutando verificación MANUAL...\n');
  
  try {
    await processReminders();
    await processEscalations();
    console.log('\n✅ Verificación manual completada\n');
  } catch (error) {
    console.error('\n❌ Error en verificación manual:', error);
    throw error;
  }
}

module.exports = {
  startReminderScheduler,
  stopReminderScheduler,
  processReminders,
  processEscalations,
  runManualCheck
};