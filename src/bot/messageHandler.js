// src/bot/messageHandler.js
const conversationManager = require('./conversationManager');
const { generateResponse, analyzeMessage, validateUserInput } = require('../ai/aiModel');
const { normalizeWhatsAppNumber } = require('./utils/phone');

/**
 * Modo de operación del bot
 * - 'ai': Usa Gemini para todas las respuestas
 * - 'hybrid': Usa IA + lógica estructurada (futuro)
 * - 'manual': Sin IA (deshabilitado)
 */
const BOT_MODE = process.env.BOT_MODE || 'ai';

/**
 * Procesa mensajes del usuario
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
      createdAt: Date.now()
    });
  }

  // Registrar mensaje del usuario
  conversationManager.recordUserMessage(senderNumber);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💬 Mensaje recibido:', incomingMessage);
  console.log('📊 Estado actual:', conversation.stage, '/', conversation.status);
  console.log('🤖 Modo operación:', BOT_MODE);
  console.log('👤 Usuario:', senderNumber);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    let response;

    if (BOT_MODE === 'ai') {
      // ✅ MODO IA: Todo gestionado por Gemini
      response = await handleWithAI(incomingMessage, conversation, senderNumber);
    } else if (BOT_MODE === 'hybrid') {
      // ✅ MODO HÍBRIDO: Combina IA con lógica estructurada
      response = await handleHybrid(incomingMessage, conversation, senderNumber);
    } else {
      // Si BOT_MODE es 'manual' o cualquier otro, usar IA por defecto
      console.log('⚠️  BOT_MODE no reconocido, usando IA');
      response = await handleWithAI(incomingMessage, conversation, senderNumber);
    }

    // Actualizar historial de conversación
    const history = conversation.history || [];
    history.push(
      { role: 'user', content: incomingMessage, timestamp: Date.now() },
      { role: 'assistant', content: response, timestamp: Date.now() }
    );
    
    conversationManager.createOrUpdateConversation(senderNumber, {
      history: history.slice(-20), // Mantener últimos 20 mensajes
      lastResponseAt: Date.now()
    });

    console.log('✅ Respuesta enviada:', response.substring(0, 80) + (response.length > 80 ? '...' : ''));
    console.log('');

    return response;

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    console.error('Stack:', error.stack);
    
    // Respuesta de error amigable
    return 'Disculpe, estoy teniendo problemas técnicos en este momento. Por favor, intente de nuevo en unos momentos o contacte directamente con administración.';
  }
}

/**
 * Manejo con IA pura
 */
async function handleWithAI(message, conversation, senderNumber) {
  console.log('🧠 Procesando con IA pura...');

  // Analizar el mensaje primero
  const analysis = await analyzeMessage(message);
  console.log('🔍 Análisis IA:', JSON.stringify(analysis, null, 2));

  // Verificar si necesita escalación inmediata
  if (shouldEscalate(analysis, conversation)) {
    return handleEscalation(analysis, conversation, senderNumber);
  }

  // Construir contexto detallado para la IA
  const context = buildContext(conversation, analysis);

  // Generar respuesta con IA
  console.log('🤖 Consultando Gemini AI...');
  const response = await generateResponse(message, context);
  
  console.log('✅ Respuesta IA generada');
  console.log('   Longitud:', response.length, 'caracteres');

  // Actualizar estado basado en la intención
  updateConversationState(analysis, conversation, senderNumber);

  return response;
}

/**
 * Manejo híbrido: IA + lógica estructurada
 */
async function handleHybrid(message, conversation, senderNumber) {
  console.log('🔀 Procesando en modo híbrido...');

  const normalizedMsg = message.toLowerCase().trim();
  
  // Detectar comandos específicos que no necesitan IA
  if (isSimpleCommand(normalizedMsg)) {
    return handleSimpleCommand(normalizedMsg, conversation, senderNumber);
  }

  // Para todo lo demás, usar IA
  return handleWithAI(message, conversation, senderNumber);
}

/**
 * Verifica si es un comando simple
 */
function isSimpleCommand(msg) {
  const simpleCommands = [
    'ayuda', 'help', 'menu', 'opciones',
    'cancelar', 'salir', 'terminar'
  ];
  
  return simpleCommands.some(cmd => msg.includes(cmd));
}

/**
 * Maneja comandos simples sin IA
 */
function handleSimpleCommand(msg, conversation, senderNumber) {
  if (msg.includes('ayuda') || msg.includes('help')) {
    return 'Estoy aquí para ayudarle con su siniestro de hogar. ¿En qué puedo asistirle?';
  }
  
  if (msg.includes('cancelar') || msg.includes('salir')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'cancelled',
      stage: 'cancelled',
      cancelledAt: Date.now()
    });
    return 'Entendido. Si necesita ayuda más adelante, no dude en contactarnos. Un saludo.';
  }
  
  return null; // Usar IA si no coincide
}

/**
 * Construye el contexto para la IA
 */
function buildContext(conversation, analysis) {
  return {
    status: conversation.status,
    stage: conversation.stage,
    history: conversation.history || [],
    userData: {
      direccion: conversation.correctedDireccion || conversation.direccion,
      fecha: conversation.correctedFecha || conversation.fecha,
      nombre: conversation.correctedNombre || conversation.nombre,
      claimType: conversation.claimTypeLabel,
      severity: conversation.severityLabel,
      appointmentMode: conversation.appointmentMode,
      preferredDate: conversation.preferredDate,
      otherPersonDetails: conversation.otherPersonDetails
    },
    metadata: {
      attempts: conversation.attempts || 0,
      offTopicCount: conversation.offTopicCount || 0,
      frustrationDetected: conversation.frustrationDetected || false,
      needsAssistance: conversation.needsAssistance || false,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt
    },
    analysis: analysis
  };
}

/**
 * Determina si debe escalar a humano
 */
function shouldEscalate(analysis, conversation) {
  // Escalación explícita
  if (analysis.needsHumanSupport) {
    console.log('⚠️  Escalación: Usuario necesita soporte humano');
    return true;
  }

  // Sentimiento muy negativo
  if (analysis.sentiment === 'negativo' && analysis.confidence > 0.8) {
    console.log('⚠️  Escalación: Sentimiento muy negativo');
    return true;
  }

  // Usuario frustrado repetidamente
  if (conversation.frustrationDetected && conversation.offTopicCount >= 2) {
    console.log('⚠️  Escalación: Usuario frustrado');
    return true;
  }

  // Múltiples intentos sin progreso
  if (conversation.attempts >= 3 && conversation.stage === conversation.prevStage) {
    console.log('⚠️  Escalación: Sin progreso después de 3 intentos');
    return true;
  }

  return false;
}

/**
 * Maneja la escalación a humano
 */
function handleEscalation(analysis, conversation, senderNumber) {
  console.log('🚨 Escalando conversación a humano...');
  
  const reason = analysis.needsHumanSupport 
    ? 'Usuario solicitó soporte humano'
    : analysis.sentiment === 'negativo'
    ? 'Sentimiento negativo detectado'
    : 'Usuario frustrado o sin progreso';

  conversationManager.createOrUpdateConversation(senderNumber, {
    status: 'escalated',
    stage: 'escalated',
    escalatedAt: Date.now(),
    escalationReason: reason
  });

  // Respuestas personalizadas según el motivo
  if (analysis.sentiment === 'negativo') {
    return 'Lamento mucho las molestias. Permítame transferirle con un supervisor que podrá atenderle personalmente. Un momento por favor.';
  } else if (conversation.frustrationDetected) {
    return 'Entiendo su frustración. Voy a conectarle directamente con un agente humano que podrá ayudarle mejor. Gracias por su paciencia.';
  } else {
    return 'Por supuesto, le pongo en contacto con un agente de nuestro equipo que le atenderá personalmente en breve. Gracias.';
  }
}

/**
 * Actualiza el estado de la conversación basado en el análisis de IA
 */
function updateConversationState(analysis, conversation, senderNumber) {
  const updates = {
    prevStage: conversation.stage // Guardar stage anterior para detectar progreso
  };

  // Actualizar stage/status según la intención
  switch (analysis.intent) {
    case 'confirmar_datos':
      if (conversation.stage === 'initial' || conversation.stage === 'initial_confirm') {
        updates.stage = 'attendee_select';
        updates.status = 'awaiting_attendee';
        console.log('📝 Estado actualizado: datos confirmados');
      }
      break;
      
    case 'corregir_datos':
      if (conversation.stage === 'initial' || conversation.stage === 'initial_confirm') {
        updates.stage = 'awaiting_corrections';
        updates.status = 'responded';
        console.log('📝 Estado actualizado: esperando correcciones');
      }
      break;
      
    case 'solicitar_ayuda':
      updates.needsAssistance = true;
      updates.assistanceRequestedAt = Date.now();
      console.log('📝 Usuario solicitó ayuda');
      break;
      
    case 'fuera_de_tema':
      updates.offTopicCount = (conversation.offTopicCount || 0) + 1;
      console.log('📝 Mensaje fuera de tema detectado:', updates.offTopicCount);
      
      // Si está muy fuera de tema, marcar para posible escalación
      if (updates.offTopicCount >= 3) {
        updates.status = 'needs_review';
        console.log('⚠️  Usuario fuera de tema 3+ veces');
      }
      break;
      
    case 'frustrado':
      updates.frustrationDetected = true;
      updates.frustrationAt = Date.now();
      console.log('📝 Frustración detectada');
      break;
  }

  // Actualizar sentimiento general
  if (analysis.sentiment) {
    updates.lastSentiment = analysis.sentiment;
    updates.lastSentimentConfidence = analysis.confidence;
  }

  // Solo actualizar si hay cambios
  if (Object.keys(updates).length > 1) { // > 1 porque siempre hay prevStage
    console.log('📝 Actualizando estado de conversación:', updates);
    conversationManager.createOrUpdateConversation(senderNumber, updates);
  }
}

/**
 * Valida y extrae datos del usuario usando IA
 * (Función auxiliar para uso futuro)
 */
async function extractAndValidateData(message, expectedType, senderNumber) {
  console.log(`🔍 Validando entrada: "${message}" como tipo "${expectedType}"`);
  
  try {
    const validation = await validateUserInput(message, expectedType);
    
    if (validation.isValid) {
      console.log('✅ Dato válido:', validation.extractedData);
      return validation.extractedData;
    } else {
      console.log('⚠️  Dato inválido:', validation.issues);
      return null;
    }
  } catch (error) {
    console.error('❌ Error validando dato:', error);
    return message; // Devolver original si falla la validación
  }
}

module.exports = {
  processMessage,
  extractAndValidateData
};