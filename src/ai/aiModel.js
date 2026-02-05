// src/ai/aiModel.js - VERSIÓN CON DOCUMENTOS WORD (usando carpeta docs/)
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mammoth = require('mammoth');
const fs = require('fs').promises;
const path = require('path');

// Lazy initialization - se inicializa cuando se necesita
let genAI = null;
let model = null;

function getModel() {
  if (!model) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('❌ Falta GEMINI_API_KEY en .env');
    }

    genAI = new GoogleGenerativeAI(apiKey);

    // Configuración del modelo
    model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
      generationConfig: {
        temperature: Number(process.env.GEMINI_TEMPERATURE) || 0.7,
        topP: Number(process.env.GEMINI_TOP_P) || 0.95,
        topK: Number(process.env.GEMINI_TOP_K) || 40,
        maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 500,
      },
    });
  }

  return model;
}

// ============================================================================
// CARGA DE BASE DE CONOCIMIENTO DESDE DOCUMENTOS WORD
// ============================================================================

let KNOWLEDGE_BASE = '';
let IS_INITIALIZED = false;

/**
 * Extrae texto de un archivo .docx
 */
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error(`❌ Error extrayendo ${filePath}:`, error.message);
    return '';
  }
}

/**
 * Analiza una transcripción y extrae patrones de conversación
 */
function parseTranscript(text, filename) {
  const lines = text.split('\n').filter(line => line.trim());
  const dialogue = [];
  
  for (const line of lines) {
    // Filtrar timestamps
    if (line.match(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/)) {
      continue;
    }
    
    if (line.includes('[Jumar]')) {
      const text = line.replace(/\[Jumar\]/g, '').trim();
      if (text) dialogue.push({ speaker: 'agente', text });
    } else if (line.includes('[Asegurado]')) {
      const text = line.replace(/\[Asegurado\]/g, '').trim();
      if (text) dialogue.push({ speaker: 'cliente', text });
    }
  }
  
  // Identificar tipo de escenario
  let scenarioType = 'contacto_basico';
  if (filename.includes('conversión_a_digital') || filename.includes('conversion_a_digital')) {
    scenarioType = 'conversion_digital';
  } else if (filename.includes('encargo_digital')) {
    scenarioType = 'encargo_digital';
  } else if (filename.includes('sin_exito')) {
    scenarioType = 'rechazo_digital';
  } else if (filename.includes('perito_presencial_por_la_zona')) {
    scenarioType = 'perito_en_zona';
  }
  
  return { scenarioType, dialogue };
}

/**
 * Carga documentos Word y construye base de conocimiento
 * ACTUALIZADO: Busca en carpeta 'docs/' en lugar de 'documents/'
 */
async function loadKnowledgeBase() {
  if (IS_INITIALIZED) {
    console.log('✅ Base de conocimiento ya cargada');
    return KNOWLEDGE_BASE;
  }
  
  // ⭐ CAMBIO: Usar carpeta 'docs' en lugar de 'documents'
  const documentsPath = path.join(__dirname, '..', '..', 'docs');
  
  try {
    console.log('📚 Cargando base de conocimiento desde documentos Word...');
    console.log('📁 Ruta:', documentsPath);
    
    // Verificar si existe el directorio
    try {
      await fs.access(documentsPath);
    } catch {
      console.warn('⚠️  Directorio docs/ no encontrado, creando conocimiento por defecto');
      KNOWLEDGE_BASE = buildDefaultKnowledge();
      IS_INITIALIZED = true;
      return KNOWLEDGE_BASE;
    }
    
    const files = await fs.readdir(documentsPath);
    const docxFiles = files.filter(file => file.endsWith('.docx'));
    
    if (docxFiles.length === 0) {
      console.warn('⚠️  No se encontraron archivos .docx');
      KNOWLEDGE_BASE = buildDefaultKnowledge();
      IS_INITIALIZED = true;
      return KNOWLEDGE_BASE;
    }
    
    let knowledge = `# BASE DE CONOCIMIENTO - GABINETE PERICIAL ALLIANZ

## INFORMACIÓN DE LA EMPRESA
Somos el Gabinete Pericial de Allianz Seguros, especializado en la gestión de siniestros de hogar.

## IDENTIDAD Y TONO
- Nos identificamos como: "Gabinete Pericial de Allianz"
- Tono: Profesional pero cercano y amable
- Tratamiento: "Usted" de forma respetuosa
- Saludos: Buenos días / Buenas tardes según la hora

## ESCENARIOS DE CONVERSACIÓN REALES

`;
    
    // Procesar cada documento
    for (const file of docxFiles) {
      const filePath = path.join(documentsPath, file);
      console.log(`📄 Procesando: ${file}`);
      
      const text = await extractTextFromDocx(filePath);
      if (!text) continue;
      
      const { scenarioType, dialogue } = parseTranscript(text, file);
      
      knowledge += `### ESCENARIO: ${scenarioType.toUpperCase()}\n`;
      knowledge += `**Archivo**: ${file}\n\n`;
      
      // Agregar ejemplo de diálogo (primeros 8 intercambios)
      knowledge += `**Ejemplo de conversación**:\n`;
      dialogue.slice(0, 8).forEach(msg => {
        const speaker = msg.speaker === 'agente' ? 'AGENTE' : 'CLIENTE';
        knowledge += `${speaker}: ${msg.text}\n`;
      });
      knowledge += `\n---\n\n`;
    }
    
    // Agregar guías específicas extraídas de las transcripciones
    knowledge += `## PATRONES CLAVE OBSERVADOS

### 1. CONFIRMACIÓN DE DATOS
- Siempre confirmar: dirección, fecha del siniestro, nombre del asegurado
- Ejemplo: "Es por un parte que tenemos abierto, eh, con fecha 27/11"

### 2. OFRECER VIDEOPERITACIÓN
- Primera opción: Siempre ofrecer videoperitación (más rápida)
- Ejemplo: "Le ofrecería la posibilidad de poder hacer una videoperitación"
- Beneficio: "Esto sí se puede hacer ahora" / "Más rápido"
- Si acepta: "Le va a llamar en unos minutos a ver si podemos dejarlo gestionado"

### 3. DIFERENCIA PERITO/ASISTENCIA
- Perito: Valora los daños
- Asistencia: Repara/arregla
- Ejemplo: "Nosotros somos el gabinete pericial, nosotros no somos la empresa de reparaciones"

### 4. MANEJO DE URGENCIAS
- Reconocer: "sin agua", "sin calefacción", "urgente"
- Respuesta: "Vamos a intentar agilizarlo lo máximo posible"
- Ofrecer solución rápida: videoperitación inmediata

### 5. PERITO EN ZONA
- Si el perito está cerca: "El perito está por la zona, seguramente le va a llamar"
- Ejemplo: "En esta mañana estará por la zona, ¿vale? Le llamarán antes"

### 6. SIN ÉXITO EN CONVERSIÓN DIGITAL
- Si no puede videoperitación: No hay problema
- Ejemplo: "No pasa nada, se lo pasamos a un compañero que pase por la zona"
- Asegurar: "Le llamará con antelación"

### 7. CIERRE PROFESIONAL
- Despedidas: "Que tenga un buen día", "Muchas gracias", "Hasta luego"
- Informar próximos pasos siempre

## FRASES TÍPICAS DEL AGENTE

**Identificación:**
- "Le llamamos del gabinete pericial de Allianz"
- "Es por un parte que tenemos abierto"

**Confirmación de datos:**
- "Simplemente por confirmar estos datos y el teléfono de contacto"
- "Esto es en calle [dirección], ¿verdad?"

**Videoperitación:**
- "Como si fuera una videollamada"
- "A través de su teléfono móvil"
- "El perito le va a llamar en unos minutos"

**Coordinación:**
- "Le vamos a facilitar su teléfono de contacto al perito"
- "Para que este se pueda poner en contacto con usted"

**Flexibilidad:**
- "Lo que usted diga"
- "Lo antes posible"
- "Vamos a intentarlo"

`;
    
    KNOWLEDGE_BASE = knowledge;
    IS_INITIALIZED = true;
    
    console.log(`✅ ${docxFiles.length} documentos cargados`);
    console.log(`📊 Base de conocimiento: ${KNOWLEDGE_BASE.length} caracteres`);
    
    return KNOWLEDGE_BASE;
    
  } catch (error) {
    console.error('❌ Error cargando base de conocimiento:', error);
    KNOWLEDGE_BASE = buildDefaultKnowledge();
    IS_INITIALIZED = true;
    return KNOWLEDGE_BASE;
  }
}

/**
 * Construye conocimiento por defecto si no hay documentos
 */
function buildDefaultKnowledge() {
  return `# BASE DE CONOCIMIENTO - GABINETE PERICIAL ALLIANZ

## INFORMACIÓN GENERAL
Somos el Gabinete Pericial de Allianz Seguros, especializado en siniestros de hogar.

## PROCESO ESTÁNDAR
1. Confirmación de datos del siniestro
2. Validación de contacto del asegurado
3. Ofrecimiento de videoperitación (opción preferida)
4. Si no es posible digital, coordinación de visita presencial
5. El perito contactará directamente para coordinar

## PUNTOS CLAVE
- Siempre identificarse como Gabinete Pericial de Allianz
- Ofrecer videoperitación como primera opción
- Explicar diferencia entre perito (valora) y asistencia (repara)
- Priorizar casos urgentes (sin agua, sin calefacción)
- Ser flexible y comprensivo con las necesidades del cliente
- Despedida profesional: "Que tenga un buen día", "Muchas gracias"
`;
}

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

IMPORTANTE: Actúa como el Gabinete Pericial de Allianz basándote en los ejemplos de conversación.
Tu tarea: Pregunta amablemente si los datos son correctos o si necesita corregir algo.
Mantén la pregunta corta y clara, como en los ejemplos reales.`
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

IMPORTANTE: Basándote en los ejemplos de conversación, SIEMPRE ofrece videoperitación primero.

Tu tarea: Ofrecer las opciones de visita, priorizando la videoperitación.

Ejemplo basado en las transcripciones:
"Le ofrecería la posibilidad de poder hacer una videoperitación, eh, ahora mismo, sobre la marcha si quiere. Esto es, que en lugar de que vaya el perito, pues se hace como una especie de videollamada."

Explica beneficio: "Esto sí se puede hacer ahora" o "Es más rápido"

Luego pregunta: "¿Prefiere hacerlo así o prefiere que vaya el perito presencialmente?"
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

Si es videoperitación: "¿Está usted ahora mismo por la vivienda?" o "El perito le va a llamar en unos minutos"
Si es presencial: "Le llamará con antelación para concertar la visita"

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

Basándote en el tono de las transcripciones:
"Perfecto, he registrado su caso:
[resumen claro de todos los datos]

¿Confirma que toda la información es correcta? 
Nuestro perito se pondrá en contacto con usted pronto."
`
  },

  completed: {
    name: 'Caso completado',
    expectedInput: 'ninguno (conversación finalizada)',
    nextStage: {},
    aiPrompt: (context) => `
El caso ha sido registrado exitosamente.

Tu tarea: Despedida profesional y cordial, basada en los ejemplos reales.

Ejemplos de las transcripciones:
- "Que tenga un buen día"
- "Muchas gracias"
- "Hasta luego"

Respuesta completa ejemplo:
"Gracias por su tiempo. Su caso ha sido registrado correctamente. 
El perito se pondrá en contacto con usted pronto.
Que tenga un buen día."
`
  }
};

// ============================================================================
// GENERACIÓN DE RESPUESTAS CON IA
// ============================================================================

async function generateResponse(userMessage, conversationContext) {
  try {
    // Asegurar que la base de conocimiento esté cargada
    await loadKnowledgeBase();
    
    const stage = conversationContext.stage || 'initial';
    const stageConfig = CONVERSATION_FLOW[stage];

    if (!stageConfig) {
      console.error('❌ Stage no encontrado:', stage);
      return generateFallbackResponse(userMessage, conversationContext);
    }

    // Construir historial de conversación
    const history = (conversationContext.history || [])
      .slice(-6) // Últimos 6 mensajes
      .map(msg => `${msg.role === 'user' ? 'USUARIO' : 'ASISTENTE'}: ${msg.content}`)
      .join('\n');

    // Construir prompt completo con base de conocimiento
    const currentHour = new Date().getHours();
    const greeting = currentHour < 12 ? 'Buenos días' :
                    currentHour < 20 ? 'Buenas tardes' : 'Buenas tardes';

    const fullPrompt = `${KNOWLEDGE_BASE}

## CONTEXTO DE LA CONVERSACIÓN

**Saludo apropiado**: ${greeting}

**Etapa actual**: ${stageConfig.name}
**Entrada esperada**: ${stageConfig.expectedInput}

**Historial reciente**:
${history || 'Primera interacción'}

**Mensaje del usuario**: "${userMessage}"

## INSTRUCCIONES ESPECÍFICAS PARA ESTA ETAPA

${stageConfig.aiPrompt(conversationContext)}

## REGLAS CRÍTICAS

1. **LONGITUD**: Máximo ${process.env.GEMINI_MAX_OUTPUT_TOKENS || 500} caracteres
2. **FORMATO**: Texto plano, sin asteriscos, sin negritas, sin markdown
3. **TONO**: Exactamente como en las transcripciones - profesional pero cercano
4. **IDENTIFICACIÓN**: Eres del Gabinete Pericial de Allianz
5. **EJEMPLOS**: Usa frases similares a las de las transcripciones reales
6. **VIDEOPERITACIÓN**: Siempre ofrécela como primera opción si aplica
7. **URGENCIAS**: Si el usuario menciona "urgente", "sin agua", "sin calefacción", reconócelo

## VALIDACIÓN ANTES DE RESPONDER

- ✅ ¿La respuesta tiene menos de 500 caracteres?
- ✅ ¿Usé frases naturales como en las transcripciones?
- ✅ ¿No usé asteriscos ni markdown?
- ✅ ¿La respuesta avanza la conversación?
- ✅ ¿Es profesional pero cercana?

RESPUESTA:`;

    console.log('🤖 Consultando Gemini AI...');
    console.log('   Stage:', stage);
    console.log('   Longitud prompt:', fullPrompt.length, 'caracteres');

    const result = await getModel().generateContent(fullPrompt);
    const response = result.response;
    let text = response.text().trim();

    // ⚠️ VALIDACIÓN CRÍTICA: Verificar que no esté vacío
    if (!text || text.trim() === '') {
      console.error('⚠️  Gemini devolvió respuesta vacía, usando fallback');
      return generateFallbackResponse(userMessage, conversationContext);
    }

    // Limpieza de respuesta
    text = cleanResponse(text);

    // Validar longitud máxima
    const maxLength = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 500;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength - 3) + '...';
    }

    console.log('✅ Respuesta generada por IA');
    console.log('   Longitud:', text.length, 'caracteres');
    console.log('   Preview:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

    return text;

  } catch (error) {
    console.error('❌ Error en Gemini AI:', error.message);
    console.error('   Stack:', error.stack);
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

    const result = await getModel().generateContent(prompt);
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

    const result = await getModel().generateContent(prompt);
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
  // Eliminar markdown
  text = text.replace(/\*\*/g, '');
  text = text.replace(/\*/g, '');
  text = text.replace(/#{1,6}\s/g, '');
  text = text.replace(/`/g, '');
  
  // Eliminar saltos de línea excesivos
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Trim
  text = text.trim();
  
  return text;
}

function generateFallbackResponse(userMessage, context) {
  const stage = context.stage || 'initial';
  
  const fallbackResponses = {
    initial: 'Disculpe, ¿podría confirmar si los datos que le mostré son correctos?',
    awaiting_corrections: 'Perdone, ¿podría indicarme de nuevo qué datos necesita corregir?',
    attendee_select: '¿Quién atenderá al perito durante la visita?',
    claim_type: '¿Qué tipo de siniestro ha ocurrido?',
    severity: '¿Cómo calificaría la gravedad de los daños?',
    appointment_mode: 'Le ofrecería la posibilidad de hacer una videoperitación. ¿Le vendría bien?',
    preferred_date: '¿Qué fecha le vendría mejor para la cita?',
    final_confirmation: '¿Confirma que todos los datos son correctos?',
    completed: 'Gracias por su tiempo. Que tenga un buen día.'
  };
  
  return fallbackResponses[stage] || 'Disculpe, ¿podría reformular su mensaje?';
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
// INICIALIZACIÓN
// ============================================================================

// Cargar base de conocimiento al inicio
loadKnowledgeBase().then(() => {
  console.log('✅ Base de conocimiento lista');
}).catch(err => {
  console.error('❌ Error en carga inicial:', err);
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  generateResponse,
  analyzeMessage,
  validateUserInput,
  determineNextStage,
  loadKnowledgeBase,
  CONVERSATION_FLOW
};