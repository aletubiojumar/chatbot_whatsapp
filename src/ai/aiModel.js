const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('❌ Falta GEMINI_API_KEY en .env');
}

const genAI = new GoogleGenerativeAI(apiKey);

// Configuración del modelo
const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    mode: process.env.GEMINI_MODE || 'ai',
});

// System prompt que define el comportamiento del bot
const SYSTEM_PROMPT = `Eres un asistente virtual de Jumar Ingeniería y Peritación, especializado en gestión de siniestros de hogar.

CONTEXTO:
- Trabajas para una empresa de peritaje de seguros
- Tu objetivo es recopilar información sobre siniestros de forma eficiente y profesional
- Debes ser cortés, claro y conciso en tus respuestas
- Solo puedes ayudar con temas relacionados con siniestros de hogar

FLUJO DE CONVERSACIÓN:
1. Verificar datos del asegurado (dirección, fecha siniestro, nombre)
2. Confirmar si los datos son correctos
3. Si hay errores, solicitar correcciones
4. Preguntar quién atenderá al perito
5. Solicitar tipo de siniestro
6. Preguntar gravedad estimada de daños
7. Ofrecer opciones de cita (presencial/telemática)
8. Solicitar fecha preferida

REGLAS IMPORTANTES:
- Respuestas cortas (máximo 2-3 frases)
- Si el usuario está fuera de tema, redirigir amablemente al proceso de siniestros
- Si el usuario está confundido, ofrecer hablar con un humano
- Mantener tono profesional pero cercano
- Usar "usted" para dirigirse al usuario
- NO inventar información que no tengas

FORMATO DE RESPUESTA:
- Sé directo y claro
- Usa saltos de línea para mejor legibilidad
- Si necesitas hacer una pregunta, hazla clara y específica`;

/**
 * Genera una respuesta usando Gemini AI
 * @param {string} userMessage - Mensaje del usuario
 * @param {object} conversationContext - Contexto de la conversación
 * @returns {Promise<string>} - Respuesta generada
 */
async function generateResponse(userMessage, conversationContext = {}) {
  try {
    // Construir el historial de conversación
    const history = conversationContext.history || [];
    
    // Construir el contexto actual
    const contextInfo = `
INFORMACIÓN DEL CASO ACTUAL:
- Estado: ${conversationContext.status || 'inicial'}
- Etapa: ${conversationContext.stage || 'verificación de datos'}
- Datos del asegurado: ${JSON.stringify(conversationContext.userData || {})}
- Intentos previos: ${conversationContext.attempts || 0}
`;

    // Construir el prompt completo
    let fullPrompt = `${SYSTEM_PROMPT}\n\n${contextInfo}\n\n`;
    
    // Añadir historial de mensajes previos
    if (history.length > 0) {
      fullPrompt += 'HISTORIAL DE CONVERSACIÓN:\n';
      history.slice(-5).forEach(msg => {
        fullPrompt += `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}\n`;
      });
      fullPrompt += '\n';
    }
    
    fullPrompt += `MENSAJE ACTUAL DEL USUARIO: "${userMessage}"\n\n`;
    fullPrompt += 'INSTRUCCIÓN: Responde de forma natural, profesional y concisa. Tu respuesta será enviada directamente por WhatsApp.';

    console.log('🤖 Consultando Gemini AI...');
    
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = response.text();
    
    console.log('✅ Respuesta generada por IA');
    console.log('   Longitud:', text.length, 'caracteres');
    
    return text.trim();
    
  } catch (error) {
    console.error('❌ Error en Gemini AI:', error.message);
    
    // Fallback: respuesta por defecto
    return 'Disculpe, estoy teniendo problemas técnicos. ¿Podría reformular su mensaje o prefiere hablar con un agente humano?';
  }
}

/**
 * Analiza el sentimiento y la intención del mensaje
 * @param {string} userMessage - Mensaje del usuario
 * @returns {Promise<object>} - Análisis del mensaje
 */
async function analyzeMessage(userMessage) {
  try {
    const prompt = `Analiza el siguiente mensaje de un usuario en un contexto de gestión de siniestros:

MENSAJE: "${userMessage}"

Responde SOLO con un JSON en este formato:
{
  "intent": "confirmar_datos|corregir_datos|solicitar_ayuda|fuera_de_tema|frustrado",
  "sentiment": "positivo|neutral|negativo",
  "needsHumanSupport": true/false,
  "confidence": 0.0-1.0
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Extraer el JSON de la respuesta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return {
      intent: 'unknown',
      sentiment: 'neutral',
      needsHumanSupport: false,
      confidence: 0.5
    };
    
  } catch (error) {
    console.error('❌ Error analizando mensaje:', error.message);
    return {
      intent: 'unknown',
      sentiment: 'neutral',
      needsHumanSupport: false,
      confidence: 0.0
    };
  }
}

/**
 * Valida datos proporcionados por el usuario usando IA
 * @param {string} userInput - Entrada del usuario
 * @param {string} expectedType - Tipo de dato esperado (dirección, fecha, nombre, etc.)
 * @returns {Promise<object>} - Resultado de validación
 */
async function validateUserInput(userInput, expectedType) {
  try {
    const prompt = `Valida la siguiente entrada del usuario:

ENTRADA: "${userInput}"
TIPO ESPERADO: ${expectedType}

Responde SOLO con un JSON:
{
  "isValid": true/false,
  "extractedData": "dato limpio y formateado",
  "issues": ["lista de problemas si los hay"]
}

Ejemplos:
- Si expectedType es "fecha" y entrada es "el 15 de enero", devuelve: {"isValid": true, "extractedData": "15/01/2024", "issues": []}
- Si expectedType es "direccion" y entrada es "calle mayor 5", devuelve: {"isValid": true, "extractedData": "Calle Mayor, 5", "issues": []}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return {
      isValid: true,
      extractedData: userInput,
      issues: []
    };
    
  } catch (error) {
    console.error('❌ Error validando entrada:', error.message);
    return {
      isValid: true,
      extractedData: userInput,
      issues: []
    };
  }
}

module.exports = {
  generateResponse,
  analyzeMessage,
  validateUserInput,
};