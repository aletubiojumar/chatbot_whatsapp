const responses = require('./responses');
const conversationManager = require('./conversationManager');

/**
 * Procesa el mensaje entrante según el flujo conversacional
 */
function processMessage(incomingMessage, senderNumber) {
  const mensaje = incomingMessage.toLowerCase().trim();
  
  console.log(`Mensaje recibido de ${senderNumber}: ${incomingMessage}`);
  
  // Obtener conversación actual
  let conversation = conversationManager.getConversation(senderNumber);
  
  // Si no existe, crear una nueva
  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending'
    });
  }
  
  // Registrar respuesta del usuario
  conversationManager.recordResponse(senderNumber, incomingMessage, 'user');
  
  let response = '';
  
  // FLUJO CONVERSACIONAL
  switch (conversation.stage) {
    case 'initial':
      response = handleInitialStage(mensaje, senderNumber);
      break;
      
    case 'identity_confirmed':
      response = handleIdentityConfirmedStage(mensaje, senderNumber);
      break;
      
    case 'understands_reason':
      response = handleUnderstandsReasonStage(mensaje, senderNumber);
      break;
      
    default:
      response = responses.default;
  }
  
  // Registrar respuesta del bot
  conversationManager.recordResponse(senderNumber, response, 'bot');
  
  return response;
}

/**
 * Maneja respuestas en etapa inicial (identificación del asegurado)
 */
function handleInitialStage(mensaje, senderNumber) {
  // Opción 1: Sí, soy el asegurado/a
  if (mensaje === '1' || mensaje.includes('sí') || mensaje.includes('si') || 
      mensaje.includes('soy el asegurado')) {
    
    conversationManager.advanceStage(senderNumber, 'identity_confirmed');
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'responded'
    });
    
    return responses.aseguradoConfirmado;
  }
  
  // Opción 2: No soy el asegurado/a
  if (mensaje === '2' || mensaje.includes('no soy') || 
      mensaje.includes('no es el asegurado')) {
    
    conversationManager.advanceStage(senderNumber, 'escalated');
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed'
    });
    
    return responses.noEsAsegurado;
  }
  
  // Opción 3: Ahora no puedo atender
  if (mensaje === '3' || mensaje.includes('no puedo') || 
      mensaje.includes('ahora no')) {
    
    // Mantener en stage inicial pero marcar como respondido temporalmente
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'pending',
      nextReminderAt: Date.now() + (6 * 60 * 60 * 1000) // Recordatorio en 6 horas
    });
    
    return responses.ocupado;
  }
  
  // No entendió la pregunta
  return responses.initialStageHelp;
}

/**
 * Maneja respuestas cuando el asegurado confirmó su identidad
 */
function handleIdentityConfirmedStage(mensaje, senderNumber) {
  // Respuesta Sí - comprende el motivo
  if (mensaje.includes('sí') || mensaje.includes('si') || 
      mensaje.includes('comprendo') || mensaje.includes('entiendo')) {
    
    conversationManager.advanceStage(senderNumber, 'understands_reason');
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed'
    });
    
    return responses.comprendeMotivo;
  }
  
  // Respuesta No - no comprende el motivo
  if (mensaje.includes('no') || mensaje.includes('no comprendo') || 
      mensaje.includes('no entiendo')) {
    
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed'
    });
    
    return responses.noComprendeMotivo;
  }
  
  return responses.identityConfirmedStageHelp;
}

/**
 * Maneja respuestas adicionales (etapa final)
 */
function handleUnderstandsReasonStage(mensaje, senderNumber) {
  return responses.conversacionFinalizada;
}

/**
 * Genera la respuesta TwiML para Twilio
 */
function generateTwiMLResponse(messageText) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${messageText}</Message>
</Response>`;
}

module.exports = {
  processMessage,
  generateTwiMLResponse
};