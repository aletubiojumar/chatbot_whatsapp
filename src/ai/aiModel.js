// src/ai/aiModel.js (VERSIÓN MEJORADA)
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error('❌ Falta GEMINI_API_KEY en .env');
}

const genAI = new GoogleGenerativeAI(apiKey);

// Configuración del modelo
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
  generationConfig: {
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 500,
  },
});

// ============================================================================
// DEFINICIÓN DEL FLUJO DE CONVERSACIÓN
// ============================================================================

const CONVERSATION_FLOW = {
  initial: {
    name: 'Verificación inicial de datos',
    expectedInput: 'confirmación (sí/no) o solicitud de corrección',
    nextStage: {
      confirmed: 'attendee_select',
      correction_needed: 'awaiting_corrections'
    },
    aiPrompt: (context) => `
El usuario está revisando los siguientes datos del siniestro:
- Dirección: ${context.userData?.direccion || 'No proporcionada'}
- Fecha del siniestro: ${context.userData?.fecha || 'No proporcionada'}
- Nombre del asegurado: ${context.userData?.nombre || 'No proporcionado'}

Tu tarea: Pregunta amablemente si los datos son correctos o si necesita corregir algo.
Respuesta esperada: Sí/No o indicación de qué corregir.
Mantén la pregunta corta y clara.`
  },

  awaiting_corrections: {
    name: 'Recibiendo correcciones',
    expectedInput: 'datos corregidos (dirección, fecha, nombre)',
    nextStage: {
      corrections_received: 'initial_confirm'
    },
    aiPrompt: (context) => `
El usuario quiere corregir sus datos. 

Datos actuales:
- Dirección: ${context.userData?.direccion || 'No proporcionada'}
- Fecha: ${context.userData?.fecha || 'No proporcionada'}
- Nombre: ${context.userData?.nombre || 'No proporcionado'}

Tu tarea: 
1. Confirma que has entendido las correcciones
2. Resume los datos corregidos claramente
3. Pregunta si ahora son correctos

Formato recomendado:
"Perfecto, he actualizado los datos:
- [dato 1]
- [dato 2]
¿Son correctos ahora?"
`
  },

  initial_confirm: {
    name: 'Confirmación de datos corregidos',
    expectedInput: 'confirmación final (sí/no)',
    nextStage: {
      confirmed: 'attendee_select'
    },
    aiPrompt: (context) => `
Los datos han sido actualizados:
${context.userData?.correctedDireccion ? `- Dirección: ${context.userData.correctedDireccion}` : ''}
${context.userData?.correctedFecha ? `- Fecha: ${context.userData.correctedFecha}` : ''}
${context.userData?.correctedNombre ? `- Nombre: ${context.userData.correctedNombre}` : ''}

El usuario debe confirmar si ahora están correctos.
Mantén la pregunta simple: "¿Son correctos los datos ahora?"
`
  },

  attendee_select: {
    name: 'Selección de quien atenderá',
    expectedInput: 'quién atenderá al perito (yo/otra persona)',
    nextStage: {
      self: 'claim_type',
      other: 'other_person_details'
    },
    aiPrompt: (context) => `
Ahora necesitas saber quién atenderá al perito cuando visite la propiedad.

Pregunta: "¿Quién estará presente durante la visita del perito? ¿Usted mismo/a u otra persona?"

Mantén la pregunta clara y directa.
`
  },

  other_person_details: {
    name: 'Datos de otra persona',
    expectedInput: 'nombre y teléfono de la persona que atenderá',
    nextStage: {
      details_received: 'claim_type'
    },
    aiPrompt: (context) => `
El usuario indicó que otra persona atenderá al perito.

Tu tarea: Solicita amablemente:
1. Nombre completo de la persona
2. Número de teléfono de contacto

Ejemplo: "Por favor, indíqueme el nombre completo y teléfono de la persona que atenderá al perito."
`
  },

  claim_type: {
    name: 'Tipo de siniestro',
    expectedInput: 'tipo de siniestro (agua, incendio, robo, etc.)',
    nextStage: {
      type_received: 'severity'
    },
    aiPrompt: (context) => `
Ahora necesitas identificar el tipo de siniestro.

Pregunta: "¿Qué tipo de siniestro ha ocurrido?"

Ejemplos de respuestas esperadas:
- Daños por agua / inundación
- Incendio
- Robo
- Rotura de cristales
- Otros daños

Mantén la pregunta abierta pero clara.
`
  },

  severity: {
    name: 'Gravedad del siniestro',
    expectedInput: 'gravedad estimada (leve, moderada, grave)',
    nextStage: {
      severity_received: 'appointment_mode'
    },
    aiPrompt: (context) => `
El usuario ha reportado un siniestro de tipo: ${context.userData?.claimType || 'no especificado'}

Tu tarea: Preguntar sobre la gravedad de los daños.

Ejemplo: "¿Cómo calificaría la gravedad de los daños? (Leve, Moderado o Grave)"

Ayuda al usuario explicando brevemente:
- Leve: daños menores, reparación simple
- Moderado: daños significativos pero no estructurales
- Grave: daños importantes, posible inhabilitación temporal
`
  },

  appointment_mode: {
    name: 'Modo de cita',
    expectedInput: 'preferencia de cita (presencial/telemática)',
    nextStage: {
      presencial: 'preferred_date',
      telematica: 'preferred_date'
    },
    aiPrompt: (context) => `
Gravedad reportada: ${context.userData?.severity || 'no especificada'}
Tipo de siniestro: ${context.userData?.claimType || 'no especificado'}

Tu tarea: Ofrecer las opciones de visita.

Ejemplo:
"Perfecto. ¿Prefiere una visita presencial del perito o una peritación telemática (por videollamada)?"

Explica brevemente:
- Presencial: El perito visita la propiedad
- Telemática: Valoración por videollamada (más rápida)
`
  },

  preferred_date: {
    name: 'Fecha preferida',
    expectedInput: 'fecha/franja horaria preferida',
    nextStage: {
      date_received: 'final_confirmation'
    },
    aiPrompt: (context) => `
Modo de cita seleccionado: ${context.userData?.appointmentMode || 'no especificado'}

Tu tarea: Solicitar fecha y horario preferidos.

Ejemplo:
"¿Qué día y horario le vendría mejor para ${context.userData?.appointmentMode === 'presencial' ? 'la visita' : 'la videollamada'}?"

Nota: Acepta respuestas flexibles como "mañana por la tarde", "esta semana", "lo antes posible", etc.
`
  },

  final_confirmation: {
    name: 'Confirmación final',
    expectedInput: 'confirmación de toda la información',
    nextStage: {
      confirmed: 'completed'
    },
    aiPrompt: (context) => `
TODOS LOS DATOS RECOPILADOS:
- Dirección: ${context.userData?.direccion || context.userData?.correctedDireccion}
- Fecha siniestro: ${context.userData?.fecha || context.userData?.correctedFecha}
- Asegurado: ${context.userData?.nombre || context.userData?.correctedNombre}
- Atenderá: ${context.userData?.attendee || 'No especificado'}
- Tipo: ${context.userData?.claimType || 'No especificado'}
- Gravedad: ${context.userData?.severity || 'No especificado'}
- Modo cita: ${context.userData?.appointmentMode || 'No especificado'}
- Fecha preferida: ${context.userData?.preferredDate || 'No especificado'}

Tu tarea: 
1. Resume toda la información recopilada
2. Pregunta si todo está correcto
3. Informa que el perito se pondrá en contacto pronto

Ejemplo:
"Perfecto, he registrado su caso:
[resumen claro de todos los datos]

¿Confirma que toda la información es correcta? 
Si es así, nuestro perito se pondrá en contacto en las próximas 24-48 horas."
`
  },

  completed: {
    name: 'Caso completado',
    expectedInput: 'ninguno (conversación finalizada)',
    nextStage: {},
    aiPrompt: (context) => `
El caso ha sido registrado exitosamente.

Tu tarea: Despedida profesional y cordial.

Ejemplo:
"Gracias por su tiempo. Su caso ha sido registrado correctamente. 
Nuestro equipo se pondrá en contacto con usted pronto.
¿Hay algo más en lo que pueda ayudarle?"
`
  }
};

// ============================================================================
// SYSTEM PROMPT BASE
// ============================================================================

const BASE_SYSTEM_PROMPT = `Eres un asistente virtual profesional de Jumar Ingeniería y Peritación, especializado en gestión de siniestros de seguros de hogar.

IDENTIDAD Y TONO:
- Nombre: Asistente Virtual de Jumar
- Tono: Profesional, empático, cercano pero formal
- Tratamiento: Siempre usar "usted"
- Estilo: Claro, conciso, sin jerga técnica innecesaria

REGLAS FUNDAMENTALES:
1. ⚠️ NUNCA inventes información que no tengas
2. ⚠️ NUNCA prometas compensaciones económicas o plazos específicos
3. ⚠️ NUNCA avances a la siguiente etapa sin confirmación del usuario
4. ✅ SÉ empático en situaciones de estrés del usuario
5. ✅ Mantén respuestas cortas (máximo 3-4 líneas)
6. ✅ Si el usuario está confundido, ofrece hablar con un humano
7. ✅ Usa saltos de línea para mejorar legibilidad

MANEJO DE SITUACIONES ESPECIALES:
- Usuario fuera de tema → Redirigir amablemente: "Entiendo, pero ahora necesito que nos centremos en..."
- Usuario frustrado → Ofrecer escalación: "Disculpe las molestias, ¿prefiere que le ponga con un agente?"
- Usuario confuso → Simplificar: "Permítame explicarlo de otra forma..."
- Datos incompletos → Solicitar claramente: "Necesito que me proporcione [dato específico]"

PROHIBIDO:
- Usar emojis excesivamente (máximo 1-2 por mensaje)
- Hacer múltiples preguntas a la vez
- Dar información legal o médica
- Discutir sobre pólizas o coberturas específicas`;

// ============================================================================
// FUNCIÓN PRINCIPAL: GENERAR RESPUESTA
// ============================================================================

async function generateResponse(userMessage, conversationContext = {}) {
  try {
    const stage = conversationContext.stage || 'initial';
    const stageConfig = CONVERSATION_FLOW[stage];

    if (!stageConfig) {
      console.warn(`⚠️ Stage desconocido: ${stage}, usando 'initial'`);
      return generateFallbackResponse(userMessage, conversationContext);
    }

    console.log(`🎯 Generando respuesta para stage: ${stage} (${stageConfig.name})`);

    // Construir el historial de conversación
    const history = conversationContext.history || [];
    let conversationHistory = '';
    
    if (history.length > 0) {
      conversationHistory = '\n\nHISTORIAL RECIENTE:\n';
      history.slice(-5).forEach(msg => {
        conversationHistory += `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}\n`;
      });
    }

    // Construir metadata del caso
    const caseMetadata = `
INFORMACIÓN DEL CASO:
- ID Conversación: ${conversationContext.phoneNumber || 'N/A'}
- Etapa actual: ${stageConfig.name}
- Intentos en esta etapa: ${conversationContext.attempts || 0}
- Tiempo desde inicio: ${conversationContext.createdAt ? Math.floor((Date.now() - conversationContext.createdAt) / 60000) + ' minutos' : 'N/A'}
`;

    // Obtener el prompt específico de la etapa
    const stagePrompt = stageConfig.aiPrompt(conversationContext);

    // Construir prompt completo
    const fullPrompt = `${BASE_SYSTEM_PROMPT}

${caseMetadata}

${stagePrompt}

${conversationHistory}

MENSAJE ACTUAL DEL USUARIO: "${userMessage}"

INSTRUCCIONES FINALES:
1. Responde SOLO a lo que el usuario ha dicho
2. Mantente en la etapa actual: ${stageConfig.name}
3. NO avances a la siguiente etapa por tu cuenta
4. Respuesta máxima: 150 palabras
5. Tu respuesta será enviada por WhatsApp, asegúrate de que sea clara y directa

RESPUESTA:`;

    console.log('🤖 Consultando Gemini AI...');
    console.log('   Stage:', stage);
    console.log('   Longitud prompt:', fullPrompt.length, 'caracteres');

    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    let text = response.text().trim();

    // Limpieza de respuesta
    text = cleanResponse(text);

    console.log('✅ Respuesta generada por IA');
    console.log('   Longitud:', text.length, 'caracteres');
    console.log('   Preview:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

    return text;

  } catch (error) {
    console.error('❌ Error en Gemini AI:', error.message);
    return generateFallbackResponse(userMessage, conversationContext);
  }
}

// ============================================================================
// ANÁLISIS DE INTENCIÓN Y SENTIMIENTO
// ============================================================================

async function analyzeMessage(userMessage) {
  try {
    const prompt = `Analiza el siguiente mensaje de un usuario en contexto de gestión de siniestros de seguros:

MENSAJE: "${userMessage}"

Responde SOLO con un JSON válido (sin markdown, sin explicaciones) en este formato exacto:
{
  "intent": "<una de estas opciones: confirmar_datos, corregir_datos, proporcionar_informacion, solicitar_ayuda, fuera_de_tema, frustrado, confundido>",
  "sentiment": "<positivo, neutral o negativo>",
  "needsHumanSupport": <true o false>,
  "confidence": <número entre 0.0 y 1.0>,
  "extractedData": {
    "direccion": "<si menciona dirección>",
    "fecha": "<si menciona fecha>",
    "nombre": "<si menciona nombre>",
    "telefono": "<si menciona teléfono>"
  }
}

IMPORTANTE: Responde SOLO con el JSON, sin ningún texto adicional.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Extraer JSON de la respuesta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      console.log('🔍 Análisis completado:', {
        intent: analysis.intent,
        sentiment: analysis.sentiment,
        confidence: analysis.confidence
      });
      return analysis;
    }

    throw new Error('No se pudo extraer JSON de la respuesta');

  } catch (error) {
    console.error('❌ Error analizando mensaje:', error.message);
    return {
      intent: 'proporcionar_informacion',
      sentiment: 'neutral',
      needsHumanSupport: false,
      confidence: 0.5,
      extractedData: {}
    };
  }
}

// ============================================================================
// VALIDACIÓN DE DATOS
// ============================================================================

async function validateUserInput(userInput, expectedType) {
  try {
    const validationRules = {
      direccion: 'Una dirección completa con calle, número, ciudad/población',
      fecha: 'Una fecha en formato día/mes/año o descripción temporal (ej: "ayer", "hace 3 días")',
      nombre: 'Nombre y apellidos completos de una persona',
      telefono: 'Número de teléfono válido (móvil o fijo, con o sin prefijo)',
      email: 'Dirección de correo electrónico válida',
      fecha_cita: 'Fecha y/o franja horaria (ej: "mañana", "miércoles por la tarde", "15 de marzo")'
    };

    const rule = validationRules[expectedType] || expectedType;

    const prompt = `Valida y extrae información del siguiente texto del usuario:

ENTRADA: "${userInput}"
TIPO ESPERADO: ${rule}

Responde SOLO con un JSON válido (sin markdown) en este formato:
{
  "isValid": <true o false>,
  "extractedData": "<dato limpio y formateado, o null si no es válido>",
  "normalizedData": "<versión normalizada del dato para sistema>",
  "issues": ["<lista de problemas si los hay>"],
  "confidence": <0.0 a 1.0>
}

Ejemplos:
- Entrada: "vivo en la calle mayor numero 5 de madrid"
  Esperado: direccion
  Respuesta: {"isValid": true, "extractedData": "Calle Mayor, 5, Madrid", "normalizedData": "Calle Mayor|5|Madrid", "issues": [], "confidence": 0.95}

- Entrada: "el 15 de enero"
  Esperado: fecha
  Respuesta: {"isValid": true, "extractedData": "15 de enero de 2024", "normalizedData": "2024-01-15", "issues": [], "confidence": 0.9}

IMPORTANTE: Responde SOLO con el JSON.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const validation = JSON.parse(jsonMatch[0]);
      console.log('✅ Validación completada:', {
        tipo: expectedType,
        válido: validation.isValid,
        confianza: validation.confidence
      });
      return validation;
    }

    throw new Error('No se pudo extraer JSON de validación');

  } catch (error) {
    console.error('❌ Error validando entrada:', error.message);
    // Fallback: aceptar la entrada como válida
    return {
      isValid: true,
      extractedData: userInput,
      normalizedData: userInput,
      issues: [],
      confidence: 0.5
    };
  }
}

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

function cleanResponse(text) {
  // Eliminar asteriscos de markdown
  text = text.replace(/\*\*/g, '');
  text = text.replace(/\*/g, '');
  
  // Eliminar saltos de línea excesivos
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Trim
  text = text.trim();
  
  return text;
}

function generateFallbackResponse(userMessage, context) {
  const stage = context.stage || 'initial';
  
  const fallbackResponses = {
    initial: 'Disculpe, estoy teniendo problemas técnicos. ¿Podría confirmar si los datos que le mostré son correctos?',
    awaiting_corrections: 'Perdone, ¿podría indicarme de nuevo qué datos necesita corregir?',
    attendee_select: '¿Quién atenderá al perito durante la visita?',
    claim_type: '¿Qué tipo de siniestro ha ocurrido?',
    severity: '¿Cómo calificaría la gravedad de los daños?',
    appointment_mode: '¿Prefiere una visita presencial o telemática?',
    preferred_date: '¿Qué fecha le vendría mejor para la cita?'
  };
  
  return fallbackResponses[stage] || 'Disculpe, estoy teniendo problemas técnicos. ¿Podría reformular su mensaje?';
}

// ============================================================================
// DETERMINAR SIGUIENTE ETAPA
// ============================================================================

function determineNextStage(currentStage, userIntent, userData = {}) {
  const stageConfig = CONVERSATION_FLOW[currentStage];

  if (!stageConfig) return currentStage;

  // Mapeo de intenciones a siguiente stage
  const intentMapping = {
    initial: {
      confirmar_datos: 'attendee_select',
      corregir_datos: 'awaiting_corrections'
    },
    awaiting_corrections: {
      proporcionar_informacion: 'initial_confirm'
    },
    initial_confirm: {
      confirmar_datos: 'attendee_select'
    },
    attendee_select: {
      proporcionar_informacion: userData.attendee === 'other' ? 'other_person_details' : 'claim_type'
    },
    other_person_details: {
      proporcionar_informacion: 'claim_type'
    },
    claim_type: {
      proporcionar_informacion: 'severity'
    },
    severity: {
      proporcionar_informacion: 'appointment_mode'
    },
    appointment_mode: {
      proporcionar_informacion: 'preferred_date'
    },
    preferred_date: {
      proporcionar_informacion: 'final_confirmation'
    },
    final_confirmation: {
      confirmar_datos: 'completed'
    }
  };
  
  const nextStage = intentMapping[currentStage]?.[userIntent];
  
  if (nextStage) {
    console.log(`➡️  Transición: ${currentStage} → ${nextStage} (intent: ${userIntent})`);
    return nextStage;
  }
  
  console.log(`🔄 Permanece en: ${currentStage}`);
  return currentStage;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  generateResponse,
  analyzeMessage,
  validateUserInput,
  determineNextStage,
  CONVERSATION_FLOW
};