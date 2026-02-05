// src/bot/messageHandler.js (VERSIÓN MEJORADA)
const conversationManager = require('./conversationManager');
const { 
  generateResponse, 
  analyzeMessage, 
  validateUserInput,
  determineNextStage,
  CONVERSATION_FLOW 
} = require('../ai/aiModel');
const { normalizeWhatsAppNumber } = require('./utils/phone');

/**
 * Modo de operación del bot
 */
const BOT_MODE = process.env.BOT_MODE || 'ai';

/**
 * Procesa mensajes del usuario con IA mejorada
 */
async function processMessage(incomingMessage, senderNumber) {
  senderNumber = normalizeWhatsAppNumber(senderNumber) || senderNumber;

  let conversation = conversationManager.getConversation(senderNumber);
  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending',
      attempts: 0,
      history: [],
      createdAt: Date.now(),
      userData: {}
    });
  }

  // Registrar mensaje del usuario
  conversationManager.recordUserMessage(senderNumber);

  console.log('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📬 Mensaje recibido:', incomingMessage);
  console.log('📊 Estado actual:', conversation.stage, '/', conversation.status);
  console.log('🤖 Modo operación:', BOT_MODE);
  console.log('👤 Usuario:', senderNumber);
  console.log('🕐 Timestamp:', new Date().toISOString());
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // PASO 1: Analizar el mensaje con IA
    console.log('🔍 PASO 1: Analizando mensaje...');
    const analysis = await analyzeMessage(incomingMessage);
    console.log('   Intent:', analysis.intent);
    console.log('   Sentiment:', analysis.sentiment);
    console.log('   Needs Human:', analysis.needsHumanSupport);
    console.log('   Confidence:', analysis.confidence);

    // PASO 2: Verificar si necesita escalación
    if (shouldEscalate(analysis, conversation)) {
      return handleEscalation(analysis, conversation, senderNumber);
    }

    // PASO 3: Extraer y validar datos si corresponde
    console.log('\n🔍 PASO 2: Extrayendo datos...');
    const extractedData = await extractRelevantData(incomingMessage, conversation, analysis);
    
    if (Object.keys(extractedData).length > 0) {
      console.log('   Datos extraídos:', extractedData);
      conversation.userData = { ...conversation.userData, ...extractedData };
    }

    // PASO 4: Determinar si avanzar de etapa
    console.log('\n➡️  PASO 3: Evaluando transición de stage...');
    const shouldProgress = evaluateStageProgression(analysis, conversation);
    
    let newStage = conversation.stage;
    if (shouldProgress) {
      newStage = determineNextStage(conversation.stage, analysis.intent, conversation.userData);
      console.log(`   ✅ Transición aprobada: ${conversation.stage} → ${newStage}`);
    } else {
      console.log(`   ⏸️  Permanece en: ${conversation.stage}`);
    }

    // PASO 5: Generar respuesta con IA
    console.log('\n🤖 PASO 4: Generando respuesta con Gemini...');
    const context = buildContext(conversation, analysis, extractedData);
    const response = await generateResponse(incomingMessage, context);

    // PASO 6: Actualizar estado de la conversación
    console.log('\n💾 PASO 5: Actualizando estado...');
    updateConversationState(
      senderNumber,
      {
        stage: newStage,
        status: 'responded',
        userData: conversation.userData,
        lastIntent: analysis.intent,
        lastSentiment: analysis.sentiment,
        lastConfidence: analysis.confidence,
        attempts: shouldProgress ? 0 : (conversation.attempts || 0) + 1
      },
      incomingMessage,
      response
    );

    console.log('✅ Procesamiento completado');
    console.log('   New stage:', newStage);
    console.log('   Response length:', response.length);
    console.log('');

    return response;

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    console.error('Stack:', error.stack);
    
    return handleError(error, conversation, senderNumber);
  }
}

/**
 * Construye el contexto completo para la IA
 */
function buildContext(conversation, analysis, extractedData) {
  const stageConfig = CONVERSATION_FLOW[conversation.stage];
  
  return {
    phoneNumber: conversation.phoneNumber,
    status: conversation.status,
    stage: conversation.stage,
    stageName: stageConfig?.name || conversation.stage,
    history: conversation.history || [],
    userData: {
      ...conversation.userData,
      ...extractedData
    },
    metadata: {
      attempts: conversation.attempts || 0,
      offTopicCount: conversation.offTopicCount || 0,
      frustrationDetected: conversation.frustrationDetected || false,
      needsAssistance: conversation.needsAssistance || false,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
      lastIntent: conversation.lastIntent,
      lastSentiment: conversation.lastSentiment
    },
    analysis: analysis
  };
}

/**
 * Extrae datos relevantes según la etapa actual
 */
async function extractRelevantData(message, conversation, analysis) {
  const stage = conversation.stage;
  const extracted = {};

  // Ya vienen algunos datos del análisis de IA
  if (analysis.extractedData) {
    Object.assign(extracted, analysis.extractedData);
  }

  // Extracciones específicas por etapa
  try {
    switch (stage) {
      case 'awaiting_corrections':
        // Validar y extraer correcciones
        if (message.toLowerCase().includes('direccion') || message.toLowerCase().includes('dirección')) {
          const validation = await validateUserInput(message, 'direccion');
          if (validation.isValid) {
            extracted.correctedDireccion = validation.extractedData;
          }
        }
        if (message.toLowerCase().includes('fecha')) {
          const validation = await validateUserInput(message, 'fecha');
          if (validation.isValid) {
            extracted.correctedFecha = validation.extractedData;
          }
        }
        if (message.toLowerCase().includes('nombre')) {
          const validation = await validateUserInput(message, 'nombre');
          if (validation.isValid) {
            extracted.correctedNombre = validation.extractedData;
          }
        }
        break;

      case 'attendee_select':
        const normalized = message.toLowerCase().trim();
        if (normalized.includes('yo') || normalized.includes('mi') || normalized.includes('estaré')) {
          extracted.attendee = 'self';
          extracted.attendeeLabel = 'El asegurado/a';
        } else if (normalized.includes('otra persona') || normalized.includes('alguien')) {
          extracted.attendee = 'other';
          extracted.attendeeLabel = 'Otra persona';
        }
        break;

      case 'other_person_details':
        // Extraer nombre y teléfono
        const nameValidation = await validateUserInput(message, 'nombre');
        const phoneValidation = await validateUserInput(message, 'telefono');
        
        if (nameValidation.isValid) {
          extracted.otherPersonName = nameValidation.extractedData;
        }
        if (phoneValidation.isValid) {
          extracted.otherPersonPhone = phoneValidation.extractedData;
        }
        
        if (extracted.otherPersonName && extracted.otherPersonPhone) {
          extracted.otherPersonDetails = `${extracted.otherPersonName} - ${extracted.otherPersonPhone}`;
        }
        break;

      case 'claim_type':
        // Detectar tipo de siniestro
        const msg = message.toLowerCase();
        if (msg.includes('agua') || msg.includes('inundación') || msg.includes('inundacion')) {
          extracted.claimType = 'water_damage';
          extracted.claimTypeLabel = 'Daños por agua';
        } else if (msg.includes('incendio') || msg.includes('fuego')) {
          extracted.claimType = 'fire';
          extracted.claimTypeLabel = 'Incendio';
        } else if (msg.includes('robo') || msg.includes('hurto')) {
          extracted.claimType = 'theft';
          extracted.claimTypeLabel = 'Robo';
        } else if (msg.includes('cristal') || msg.includes('ventana')) {
          extracted.claimType = 'glass';
          extracted.claimTypeLabel = 'Rotura de cristales';
        } else {
          extracted.claimType = 'other';
          extracted.claimTypeLabel = message.substring(0, 50);
        }
        break;

      case 'severity':
        const severity = message.toLowerCase();
        if (severity.includes('leve') || severity.includes('menor') || severity.includes('pequeño')) {
          extracted.severity = 'leve';
          extracted.severityLabel = 'Leve';
        } else if (severity.includes('moderado') || severity.includes('medio')) {
          extracted.severity = 'moderado';
          extracted.severityLabel = 'Moderado';
        } else if (severity.includes('grave') || severity.includes('serio') || severity.includes('importante')) {
          extracted.severity = 'grave';
          extracted.severityLabel = 'Grave';
        }
        break;

      case 'appointment_mode':
        const mode = message.toLowerCase();
        if (mode.includes('presencial') || mode.includes('persona') || mode.includes('visita')) {
          extracted.appointmentMode = 'presencial';
        } else if (mode.includes('telemática') || mode.includes('telematica') || mode.includes('video') || mode.includes('llamada')) {
          extracted.appointmentMode = 'telematica';
        }
        break;

      case 'preferred_date':
        const dateValidation = await validateUserInput(message, 'fecha_cita');
        if (dateValidation.isValid) {
          extracted.preferredDate = dateValidation.extractedData;
          extracted.preferredDateNormalized = dateValidation.normalizedData;
        }
        break;
    }
  } catch (error) {
    console.error('⚠️  Error extrayendo datos:', error.message);
  }

  return extracted;
}

/**
 * Evalúa si debe progresar a la siguiente etapa
 */
function evaluateStageProgression(analysis, conversation) {
  const stage = conversation.stage;
  const intent = analysis.intent;
  
  // Reglas por etapa
  const progressionRules = {
    initial: () => {
      return intent === 'confirmar_datos' || intent === 'corregir_datos';
    },
    awaiting_corrections: () => {
      return intent === 'proporcionar_informacion' && conversation.userData?.correctedDireccion;
    },
    initial_confirm: () => {
      return intent === 'confirmar_datos';
    },
    attendee_select: () => {
      return conversation.userData?.attendee !== undefined;
    },
    other_person_details: () => {
      return conversation.userData?.otherPersonDetails !== undefined;
    },
    claim_type: () => {
      return conversation.userData?.claimType !== undefined;
    },
    severity: () => {
      return conversation.userData?.severity !== undefined;
    },
    appointment_mode: () => {
      return conversation.userData?.appointmentMode !== undefined;
    },
    preferred_date: () => {
      return conversation.userData?.preferredDate !== undefined;
    },
    final_confirmation: () => {
      return intent === 'confirmar_datos';
    }
  };

  const rule = progressionRules[stage];
  if (!rule) return false;

  const shouldProgress = rule();
  console.log(`   Evaluación progresión (${stage}):`, shouldProgress);
  
  return shouldProgress;
}

/**
 * Determina si debe escalar a humano
 */
function shouldEscalate(analysis, conversation) {
  // Escalación explícita
  if (analysis.needsHumanSupport) {
    console.log('⚠️  Escalación: Usuario solicitó soporte humano');
    return true;
  }

  // Sentimiento muy negativo con alta confianza
  if (analysis.sentiment === 'negativo' && analysis.confidence > 0.8) {
    console.log('⚠️  Escalación: Sentimiento muy negativo');
    return true;
  }

  // Usuario frustrado repetidamente
  if (conversation.frustrationDetected && (conversation.offTopicCount || 0) >= 2) {
    console.log('⚠️  Escalación: Usuario frustrado con múltiples intentos');
    return true;
  }

  // Muchos intentos sin progreso en la misma etapa
  if ((conversation.attempts || 0) >= 4 && conversation.stage === conversation.prevStage) {
    console.log('⚠️  Escalación: 4+ intentos sin progreso');
    return true;
  }

  // Confusión persistente
  if (analysis.intent === 'confundido' && (conversation.attempts || 0) >= 2) {
    console.log('⚠️  Escalación: Usuario confundido persistentemente');
    return true;
  }

  return false;
}

/**
 * Maneja la escalación a humano
 */
function handleEscalation(analysis, conversation, senderNumber) {
  console.log('🚨 Escalando conversación a agente humano...');
  
  const reason = analysis.needsHumanSupport 
    ? 'Usuario solicitó soporte humano'
    : analysis.sentiment === 'negativo'
    ? 'Sentimiento negativo detectado'
    : analysis.intent === 'confundido'
    ? 'Usuario confundido'
    : 'Usuario frustrado o sin progreso';

  conversationManager.createOrUpdateConversation(senderNumber, {
    status: 'escalated',
    stage: 'escalated',
    escalatedAt: Date.now(),
    escalationReason: reason,
    escalationDetails: {
      lastIntent: analysis.intent,
      lastSentiment: analysis.sentiment,
      attempts: conversation.attempts,
      stage: conversation.stage
    }
  });

  // Respuestas personalizadas según el motivo
  if (analysis.sentiment === 'negativo') {
    return 'Lamento mucho las molestias. Voy a transferirle con un supervisor que podrá atenderle personalmente. Un momento por favor.';
  } else if (analysis.intent === 'confundido') {
    return 'Entiendo que puede resultar confuso. Permítame conectarle con un agente que podrá explicarle todo con más detalle. Gracias por su paciencia.';
  } else if (conversation.frustrationDetected) {
    return 'Comprendo su frustración. Le pongo en contacto directo con un miembro de nuestro equipo que podrá ayudarle mejor. Disculpe las molestias.';
  } else {
    return 'Por supuesto, le conecto con un agente de nuestro equipo que le atenderá personalmente en breve. Gracias.';
  }
}

/**
 * Actualiza el estado de la conversación
 */
function updateConversationState(senderNumber, updates, userMessage, botResponse) {
  const history = conversationManager.getConversation(senderNumber)?.history || [];
  
  // Agregar al historial
  history.push(
    { role: 'user', content: userMessage, timestamp: Date.now() },
    { role: 'assistant', content: botResponse, timestamp: Date.now() }
  );

  // Mantener solo últimos 30 mensajes
  const trimmedHistory = history.slice(-30);

  // Actualizar
  conversationManager.createOrUpdateConversation(senderNumber, {
    ...updates,
    history: trimmedHistory,
    lastResponseAt: Date.now(),
    prevStage: conversationManager.getConversation(senderNumber)?.stage
  });

  console.log('💾 Estado actualizado:', {
    stage: updates.stage,
    status: updates.status,
    attempts: updates.attempts,
    historySize: trimmedHistory.length
  });
}

/**
 * Manejo de errores
 */
function handleError(error, conversation, senderNumber) {
  console.error('🔥 Error crítico en processMessage');
  console.error('   Error:', error.message);
  console.error('   Stage:', conversation?.stage);
  console.error('   User:', senderNumber);

  // Registrar el error
  conversationManager.createOrUpdateConversation(senderNumber, {
    lastError: {
      message: error.message,
      stage: conversation?.stage,
      timestamp: Date.now()
    },
    errorCount: (conversation?.errorCount || 0) + 1
  });

  // Si hay muchos errores, escalar
  if ((conversation?.errorCount || 0) >= 3) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'escalated',
      stage: 'escalated',
      escalatedAt: Date.now(),
      escalationReason: 'Múltiples errores técnicos'
    });
    return 'Disculpe, estamos experimentando problemas técnicos. Voy a ponerle en contacto con un agente humano que podrá ayudarle. Gracias por su paciencia.';
  }

  // Respuesta de error genérica
  return 'Disculpe, estoy teniendo un problema técnico momentáneo. ¿Podría reformular su mensaje o intentarlo de nuevo en unos segundos?';
}

module.exports = {
  processMessage,
  handleEscalation,
  updateConversationState,
  handleError
};