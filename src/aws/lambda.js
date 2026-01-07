const { processMessage, generateTwiMLResponse } = require('./bot/messageHandler');

/**
 * Handler de AWS Lambda
 * Este código se ejecutará en AWS sin cambios
 */
exports.handler = async (event) => {
  console.log('Event recibido:', JSON.stringify(event, null, 2));
  
  try {
    // API Gateway pasa el body como string, necesitamos parsearlo
    const body = event.body ? 
      (typeof event.body === 'string' ? parseFormData(event.body) : event.body) 
      : {};
    
    const incomingMessage = body.Body || '';
    const senderNumber = body.From || '';
    
    // Procesar el mensaje (misma lógica que en local)
    const responseText = processMessage(incomingMessage, senderNumber);
    
    // Generar respuesta TwiML
    const twimlResponse = generateTwiMLResponse(responseText);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml'
      },
      body: twimlResponse
    };
    
  } catch (error) {
    console.error('Error en Lambda:', error);
    
    const errorResponse = generateTwiMLResponse('Error interno. Por favor intenta más tarde.');
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml'
      },
      body: errorResponse
    };
  }
};

/**
 * Helper para parsear datos de formulario URL-encoded
 */
function parseFormData(body) {
  const params = new URLSearchParams(body);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}