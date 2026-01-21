// src/bot/messageHandler.js
const conversationManager = require('./conversationManager');
const { generateResponse, analyzeMessage } = require('./geminiAI');
const { normalizeWhatsAppNumber } = require('./utils/phone');

/**
 * Modo de operación del bot
 * - 'ai': Usa Gemini para todas las respuestas (más flexible)
 * - 'hybrid': Usa IA solo para texto libre, templates para botones (recomendado)
 * - 'manual': Usa solo las respuestas predefinidas (original)
 */
const BOT_MODE = process.env.BOT_MODE || 'hybrid';

/**
 * Procesa mensajes usando IA de forma inteligente
 */
async function processMessage(incomingMessage, senderNumber) {
  senderNumber = normalizeWhatsAppNumber(senderNumber) || senderNumber;

  let conversation = conversationManager.getConversation(senderNumber);
  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending',
      attempts: 0,
      history: []
    });
  }

  // Registrar el mensaje del usuario
  conversationManager.recordUserMessage(senderNumber);

  console.log('💬 Mensaje recibido:', incomingMessage);
  console.log('📊 Estado actual:', conversation.stage, '/', conversation.status);

  try {
    let response;

    if (BOT_MODE === 'ai') {
      // ✅ MODO IA PURO: Todo gestionado por Gemini
      response = await handleWithAI(incomingMessage, conversation, senderNumber);
      
    } else if (BOT_MODE === 'hybrid') {
      // ✅ MODO HÍBRIDO: Combina IA con flujo estructurado (RECOMENDADO)
      response = await handleHybrid(incomingMessage, conversation, senderNumber);
      
    } else {
      // ✅ MODO MANUAL: Usa el flujo original (sin IA)
      response = await handleManual(incomingMessage, conversation, senderNumber);
    }

    // Actualizar historial de conversación
    const history = conversation.history || [];
    history.push(
      { role: 'user', content: incomingMessage, timestamp: Date.now() },
      { role: 'assistant', content: response, timestamp: Date.now() }
    );
    
    conversationManager.createOrUpdateConversation(senderNumber, {
      history: history.slice(-20) // Mantener solo últimos 20 mensajes
    });

    return response;

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    return 'Disculpe, hubo un error procesando su mensaje. Por favor, intente de nuevo o contacte con administración.';
  }
}

/**
 * Manejo con IA pura
 */
async function handleWithAI(message, conversation, senderNumber) {
  // Analizar el mensaje primero
  const analysis = await analyzeMessage(message);
  
  console.log('🧠 Análisis IA:', analysis);

  // Si el usuario necesita soporte humano, escalar
  if (analysis.needsHumanSupport || analysis.sentiment === 'negativo') {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'escalated',
      stage: 'escalated',
      escalatedAt: Date.now(),
      escalationReason: 'Usuario necesita soporte humano (detectado por IA)'
    });
    
    return 'Entiendo su situación. Voy a transferir su caso a un agente humano que le contactará en breve. Gracias por su paciencia.';
  }

  // Construir contexto para la IA
  const context = {
    status: conversation.status,
    stage: conversation.stage,
    history: conversation.history || [],
    userData: {
      direccion: conversation.correctedDireccion || conversation.direccion,
      fecha: conversation.correctedFecha || conversation.fecha,
      nombre: conversation.correctedNombre || conversation.nombre,
      claimType: conversation.claimTypeLabel,
      appointmentMode: conversation.appointmentMode
    },
    attempts: conversation.attempts || 0
  };

  // Generar respuesta con IA
  const response = await generateResponse(message, context);
  
  // Actualizar estado según la intención detectada
  if (analysis.intent === 'confirmar_datos') {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
  } else if (analysis.intent === 'corregir_datos') {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded'
    });
  }

  return response;
}

/**
 * Manejo híbrido: IA para texto libre, templates para botones
 */
async function handleHybrid(message, conversation, senderNumber) {
  const normalizedMsg = message.toLowerCase().trim();

  // ========================================
  // ETAPA 1: VERIFICACIÓN INICIAL DE DATOS
  // ========================================
  if (conversation.stage === 'initial' || conversation.stage === 'initial_confirm') {
    
    // Detectar respuestas con botones
    if (normalizedMsg.includes('son correct') || normalizedMsg.includes('sí')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        stage: 'attendee_select',
        status: 'awaiting_attendee'
      });
      
      return 'Perfecto. ¿Quién atenderá al perito?\n\n- Yo mismo/a\n- Otra persona';
    }
    
    if (normalizedMsg.includes('error') || normalizedMsg.includes('no')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        stage: 'awaiting_corrections',
        status: 'responded'
      });
      
      // ✅ USAR IA para solicitar correcciones de forma natural
      return await generateResponse(message, {
        stage: 'solicitar_correcciones',
        history: conversation.history || []
      });
    }
    
    if (normalizedMsg.includes('equivocado') || normalizedMsg.includes('no soy')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'completed',
        stage: 'completed'
      });
      return 'Disculpe las molestias. Un saludo.';
    }
  }

  // ========================================
  // ETAPA 2: CORRECCIONES (TEXTO LIBRE CON IA)
  // ========================================
  if (conversation.stage === 'awaiting_corrections') {
    // ✅ USAR IA para extraer y validar datos corregidos
    const response = await generateResponse(message, {
      stage: 'procesar_correcciones',
      history: conversation.history || [],
      instruction: 'El usuario está proporcionando datos corregidos. Extrae dirección, fecha y nombre si los menciona, y confirma que los recibiste correctamente.'
    });
    
    // Guardar las correcciones (la IA ya las habrá mencionado)
    conversationManager.createOrUpdateConversation(senderNumber, {
      corrections: message,
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
    
    return response + '\n\n¿Quién atenderá al perito?\n- Yo mismo/a\n- Otra persona';
  }

  // ========================================
  // ETAPA 3: SELECCIÓN DE QUIEN ATIENDE
  // ========================================
  if (conversation.stage === 'attendee_select') {
    if (normalizedMsg.includes('yo') || normalizedMsg.includes('mismo')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        stage: 'awaiting_claim_type',
        status: 'responded'
      });
      
      return 'Entendido. Por favor, indique el tipo de siniestro:\n\n1. Rotura de cristales\n2. Incendio\n3. Daños por agua\n4. Robo\n5. Otro';
    }
    
    if (normalizedMsg.includes('otra')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        stage: 'awaiting_other_person_details',
        status: 'responded'
      });
      
      // ✅ USAR IA para solicitar datos de forma natural
      return await generateResponse(message, {
        stage: 'solicitar_datos_tercero',
        history: conversation.history || []
      });
    }
  }

  // ========================================
  // PARA CUALQUIER OTRO CASO: USAR IA
  // ========================================
  const context = {
    status: conversation.status,
    stage: conversation.stage,
    history: conversation.history || [],
    userData: {
      direccion: conversation.correctedDireccion,
      fecha: conversation.correctedFecha,
      nombre: conversation.correctedNombre
    }
  };

  return await generateResponse(message, context);
}

/**
 * Manejo manual (flujo original sin IA)
 */
async function handleManual(message, conversation, senderNumber) {
  // Aquí iría tu lógica original de messageHandler
  // (la que ya tienes implementada)
  return 'Modo manual no implementado en este ejemplo. Use BOT_MODE=hybrid o BOT_MODE=ai';
}

module.exports = {
  processMessage
};