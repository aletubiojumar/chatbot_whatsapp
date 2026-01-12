// messageHandler.js
const responses = require('./responses');
const conversationManager = require('./conversationManager');

/**
 * Menú de tipología del siniestro
 */
const CLAIM_TYPE_MENU = `Indique la tipología del siniestro (marque una opción):

1️⃣Actos vandálicos sin sustracción
2️⃣Avería eléctrica de equipo
3️⃣Caída de rayo
4️⃣Cristales o rotura de vitrocerámica
5️⃣Daños por agua
6️⃣Impacto
7️⃣Incendio
8️⃣Viento
9️⃣Precipitaciones
🔟Responsabilidad Civil (RC)
1️⃣1️⃣Robo sin sustracción (intento de robo, daños...)
1️⃣2️⃣Rotura sanitario
1️⃣3️⃣Sobretensión suministro público -> presencial
1️⃣4️⃣arbitraje
1️⃣5️⃣Lesiones
1️⃣6️⃣Robo con sustracción
1️⃣7️⃣Varias opciones
1️⃣8️⃣Otros`;

const CLAIM_TYPE_KEYWORDS = [
  { n: 1, keys: ['actos vandalicos', 'actos vandálicos', 'vandalico', 'vandálico', 'vandalismo'] },
  { n: 2, keys: ['averia electrica', 'avería eléctrica', 'equipo electrico', 'equipo eléctrico'] },
  { n: 3, keys: ['caida de rayo', 'caída de rayo', 'rayo'] },
  { n: 4, keys: ['cristales', 'rotura de vitroceramica', 'rotura de vitrocerámica', 'vitroceramica', 'vitrocerámica'] },
  { n: 5, keys: ['danos por agua', 'daños por agua', 'agua', 'fuga', 'humedad', 'inundacion', 'inundación'] },
  { n: 6, keys: ['impacto', 'golpe'] },
  { n: 7, keys: ['incendio', 'fuego'] },
  { n: 8, keys: ['viento', 'temporal'] },
  { n: 9, keys: ['precipitaciones', 'lluvia', 'granizo', 'nieve'] },
  { n: 10, keys: ['responsabilidad civil', 'rc', 'responsabilidad'] },
  { n: 11, keys: ['robo sin sustraccion', 'robo sin sustracción', 'intento de robo', 'intento robo'] },
  { n: 12, keys: ['rotura sanitario', 'sanitario', 'wc', 'inodoro', 'lavabo'] },
  { n: 13, keys: ['sobretension', 'sobretensión', 'suministro publico', 'suministro público'] },
  { n: 14, keys: ['arbitraje'] },
  { n: 15, keys: ['lesiones'] },
  { n: 16, keys: ['robo con sustraccion', 'robo con sustracción'] },
  { n: 17, keys: ['varias opciones', 'varias', 'multiple', 'múltiple'] },
  { n: 18, keys: ['otros', 'otro'] },
];

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/\s+/g, ' ')
    .trim();
}

function extractClaimType(rawMessage) {
  const t = normalizeText(rawMessage);

  // 1) Número explícito 1..18
  const numMatch = t.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 18) return n;
  }

  // 2) Texto por keywords
  for (const item of CLAIM_TYPE_KEYWORDS) {
    for (const k of item.keys) {
      if (t.includes(normalizeText(k))) return item.n;
    }
  }

  return null;
}

function processMessage(incomingMessage, senderNumber) {
  const mensaje = (incomingMessage || '').toLowerCase().trim();

  let conversation = conversationManager.getConversation(senderNumber);

  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending'
    });
  }

  // Si estaba en "no puedo atender" (snoozed) y el usuario vuelve a escribir, cancelamos el snooze
  if (conversation.status === 'snoozed') {
    conversation = conversationManager.clearSnoozed(senderNumber);
  }

  console.log('🔍 DEBUG: conversation.status =', conversation.status);
  console.log('🔍 DEBUG: ¿Es awaiting_continuation?', conversation.status === 'awaiting_continuation');

  // ✅ CRÍTICO: Si está esperando respuesta de continuación, manejar PRIMERO y salir
  if (conversation.status === 'awaiting_continuation') {
    const { handleContinuationResponse } = require('./inactivityHandler');
    const continuationResponse = handleContinuationResponse(incomingMessage, senderNumber);

    if (continuationResponse) {
      // Registrar mensaje del usuario
      conversationManager.recordResponse(senderNumber, incomingMessage, 'user');
      // Registrar respuesta del bot
      conversationManager.recordResponse(senderNumber, continuationResponse, 'bot');

      console.log('📝 Respuesta de continuación manejada');

      // IMPORTANTE: Retornar inmediatamente sin procesar más
      return continuationResponse;
    }
  }

  // Registrar mensaje del usuario
  conversationManager.recordResponse(senderNumber, incomingMessage, 'user');

  // ✅ NUEVO: Limpiar campos de inactividad cuando el usuario responde
  // Esto permite que la conversación pueda volver a detectarse como inactiva si deja de responder
  if (conversation.continuationAskedAt || conversation.continuationTimeoutAt || conversation.inactivityCheckAt) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null
    });
    console.log('🔄 Campos de inactividad limpiados - conversación reactivada');
  }

  let response;

  switch (conversation.stage) {
    case 'initial':
      response = handleInitialStage(mensaje, senderNumber);
      break;

    case 'identity_confirmed':
      response = handleIdentityConfirmedStage(mensaje, senderNumber);
      break;

    case 'awaiting_corrections':
      response = handleAwaitingCorrectionsStage(incomingMessage, senderNumber);
      break;

    case 'confirming_corrections':
      response = handleConfirmingCorrectionsStage(mensaje, senderNumber);
      break;

    case 'attendee_select':
      response = handleAttendeeSelectStage(mensaje, senderNumber);
      break;

    case 'awaiting_claim_type':
      response = handleClaimTypeStage(incomingMessage, senderNumber);
      break;

    case 'appointment_select':
      response = handleAppointmentSelectStage(incomingMessage, senderNumber);
      break;

    case 'awaiting_severity':
      response = handleSeverityStage(incomingMessage, senderNumber);
      break;

    case 'awaiting_date':
      response = handleDateStage(incomingMessage, senderNumber);
      break;

    default:
      response = responses.default;
  }

  // Registrar respuesta del bot SOLO si hay texto no-vacío
  if (response && response.trim() !== '') {
    conversationManager.recordResponse(senderNumber, response, 'bot');
  }

  // Twilio/WhatsApp: nunca devolver undefined
  return response || ' ';
}

/* =======================
   ETAPA INICIAL
======================= */
function handleInitialStage(mensaje, senderNumber) {
  // ✅ No soy el asegurado/a
  if (
    mensaje === '2' ||
    mensaje.includes('no soy') ||
    mensaje.includes('no es el asegurado') ||
    mensaje.includes('no soy el asegurado')
  ) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed',
      stage: 'completed'
    });
    return responses.noEsAsegurado;
  }

  // ✅ Sí, soy el asegurado/a
  const esConfirmacionSi =
    mensaje === '1' ||
    mensaje === 'si' ||
    mensaje === 'sí' ||
    mensaje.startsWith('si ') ||
    mensaje.startsWith('sí ') ||
    (mensaje.includes('soy el asegurado') && !mensaje.includes('no soy'));

  if (esConfirmacionSi) {
    conversationManager.advanceStage(senderNumber, 'identity_confirmed');
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'awaiting_verification'
    });
    return ' '; // para que index.js envíe el template de verificación
  }

  // ✅ No puedo atender (snooze 6h)
  if (mensaje === '3' || mensaje.includes('no puedo') || mensaje.includes('ahora no')) {
    conversationManager.setSnoozed(senderNumber, Date.now() + 6 * 60 * 60 * 1000);
    return responses.ocupado;
  }

  return responses.initialStageHelp;
}

/* =======================
   VERIFICACIÓN DE DATOS
======================= */
function handleIdentityConfirmedStage(mensaje, senderNumber) {
  // ✅ Datos correctos => pasar a attendee_select (template mensaje4)
  if (
    mensaje.includes('sí') || mensaje.includes('si') ||
    mensaje.includes('correctos') || mensaje.includes('correcto')
  ) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
    return ' '; // para que index.js envíe el template mensaje4
  }

  // ❌ Datos incorrectos => pedir corrección
  if (mensaje.includes('no') || mensaje.includes('error') || mensaje.includes('incorrecto')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded'
    });

    // si no existe en responses.js, caemos a un texto seguro
    return responses.pedirDatosCorregidos || `De acuerdo. Por favor, indíquenos los datos corregidos en un solo mensaje.

Ejemplo:
- Dirección: ...
- Fecha de ocurrencia: ...
- Nombre del asegurado: ...`;
  }

  return responses.identityConfirmedStageHelp;
}

/* =======================
   ESPERANDO DATOS CORREGIDOS
   - Guarda dirección/fecha/nombre
   - Pasa a confirming_corrections para que index.js envíe el template mensaje_corregir
======================= */
function handleAwaitingCorrectionsStage(rawMessage, senderNumber) {
  const text = (rawMessage || '').trim();

  if (text.length < 5) {
    return responses.pedirDatosCorregidos;
  }

  // Intento 1: con etiquetas
  let direccion = (text.match(/direcci[oó]n\s*:\s*(.+)/i) || [])[1]?.trim() || '';
  let fecha = (text.match(/fecha(?:\s*de\s*ocurrencia)?\s*:\s*(.+)/i) || [])[1]?.trim() || '';
  let nombre = (text.match(/nombre(?:\s*del\s*asegurado)?\s*:\s*(.+)/i) || [])[1]?.trim() || '';

  // Intento 2: 3 líneas sin etiquetas
  if (!direccion && !fecha && !nombre) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length >= 1) direccion = lines[0];
    if (lines.length >= 2) fecha = lines[1];
    if (lines.length >= 3) nombre = lines[2];
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    correctedDataText: text,
    correctedDireccion: direccion,
    correctedFecha: fecha,
    correctedNombre: nombre,
    stage: 'confirming_corrections',
    status: 'awaiting_correction_confirmation'
  });

  return ' '; // index.js enviará el template mensaje_corregir
}

/* =======================
   CONFIRMAR DATOS CORREGIDOS (tras template mensaje_corregir)
======================= */
function handleConfirmingCorrectionsStage(mensaje, senderNumber) {
  // ✅ Confirmación
  if (mensaje.includes('sí') || mensaje === 'si' || mensaje === 'sí' || mensaje.includes('correctos') || mensaje.includes('correcto')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
    return ' '; // volverá a mandar template mensaje4
  }

  // ❌ Volver a pedir corrección
  if (mensaje.includes('no') || mensaje.includes('error') || mensaje.includes('incorrecto')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded'
    });
    return responses.pedirDatosCorregidos;
  }

  // Si dice cualquier otra cosa, repetir (texto simple)
  return 'Por favor, responda: "Sí, son correctos" o "No, hay algún error".';
}

/* =======================
   QUIÉN ATENDERÁ AL PERITO (mensaje4)
======================= */
function handleAttendeeSelectStage(mensaje, senderNumber) {
  const m = (mensaje || '').toLowerCase().trim();

  // Botón: "Otra persona"
  if (m.includes('otra persona')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_other_person_details',
      status: 'responded'
    });

    return `Por favor, indíquenos:

· Nombre y apellidos
· Teléfono de contacto
· Relación con el siniestro (inquilino/a, familiar, etc.)`;
  }

  // Botón: "Yo (asegurado/a)" => pedir tipología
  if (m.includes('yo') || m.includes('asegurado')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_claim_type',
      status: 'responded'
    });

    return CLAIM_TYPE_MENU;
  }

  return 'Por favor, seleccione una opción válida: "Yo (asegurado/a)" u "Otra persona".';
}

/* =======================
   TIPOLGÍA DEL SINIESTRO
   - Acepta número 1..18 o texto ("lesiones", "arbitraje", etc.)
   - Si 14-18 => presencial => pedir fecha
======================= */
function handleClaimTypeStage(rawMessage, senderNumber) {
  const n = extractClaimType(rawMessage);

  if (!n) {
    return `No he entendido la opción. Por favor, responda con un número del 1 al 18 (o escriba la tipología).\n\n${CLAIM_TYPE_MENU}`;
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    claimType: n,
    claimTypeRaw: (rawMessage || '').trim()
  });

  // 14-18 => presencial obligatoria => pedir fecha directa
  // 14-18 => presencial obligatoria => pedir fecha directa
  if ([14, 15, 16, 17, 18].includes(n)) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded'
    });

    return 'Cita únicamente disponible presencialmente, por favor indique la fecha que mejor le convenga';
  }

  // 1-13 => NO es presencial obligatoria => pedir gravedad primero
  conversationManager.createOrUpdateConversation(senderNumber, {
    appointmentMode: null,      // aún no decidido
    severityBand: null,
    severityChecked: false,
    stage: 'awaiting_severity',
    status: 'responded'
  });

  return `Para clasificar la gravedad aproximada del siniestro, indique el tramo que considera más adecuado:

1️⃣ 0 – 500 €
2️⃣ 500 – 2.500 €
3️⃣ 2.500 – 5.000 €
4️⃣ 5.000 – 12.000 €
5️⃣ Más de 12.000 €`;

}

/* =======================
   FECHA CITA PRESENCIAL
======================= */
function handleAppointmentSelectStage(rawMessage, senderNumber) {
  const t = normalizeText(rawMessage);
  const conv = conversationManager.getConversation(senderNumber);

  const alreadyCheckedSeverity = !!conv?.severityChecked;

  // Si ya hemos pasado por gravedad (band 1-3), cualquier elección va a fecha
  if (alreadyCheckedSeverity) {
    if (t.includes('presencial')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        appointmentMode: 'presencial',
        stage: 'awaiting_date',
        status: 'responded'
      });
      return 'Por favor, indique la fecha que mejor le convenga';
    }

    if (t.includes('telematica') || t.includes('telemática')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        appointmentMode: 'telematica',
        stage: 'awaiting_date',
        status: 'responded'
      });
      return 'Por favor, indique la fecha que mejor le convenga';
    }
  }

  // Flujo normal (antes de gravedad)
  if (t.includes('presencial')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded'
    });
    return 'Por favor, indique la fecha que mejor le convenga';
  }

  if (t.includes('telematica') || t.includes('telemática')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'telematica',
      stage: 'awaiting_severity',
      status: 'responded'
    });

    return `Para clasificar la gravedad aproximada del siniestro, indique el tramo que considera más adecuado:

1️⃣ 0 – 500 €
2️⃣ 500 – 2.500 €
3️⃣ 2.500 – 5.000 €
4️⃣ 5.000 – 12.000 €
5️⃣ Más de 12.000 €`;
  }

  // si manda otra cosa, re-enviar template
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment'
  });
  return ' '; // index.js reenvía mensaje_cita
}

function extractSeverityBand(rawMessage) {
  const t = normalizeText(rawMessage);

  // número 1..5
  const m = t.match(/\b([1-5])\b/);
  if (m) return parseInt(m[1], 10);

  // texto por rangos
  if (t.includes('mas de 12000') || t.includes('más de 12000') || t.includes('> 12000')) return 5;
  if (t.includes('5000') || t.includes('5.000') || t.includes('12000') || t.includes('12.000')) {
    // si menciona 5.000-12.000 intentamos asumir 4
    if (t.includes('5000') || t.includes('5.000')) return 4;
  }

  return null;
}

function handleSeverityStage(rawMessage, senderNumber) {
  const band = extractSeverityBand(rawMessage);

  if (!band) {
    return `No he entendido la opción. Responda con un número del 1 al 5.\n\n` +
      `1️⃣ 0 – 500 €\n2️⃣ 500 – 2.500 €\n3️⃣ 2.500 – 5.000 €\n4️⃣ 5.000 – 12.000 €\n5️⃣ Más de 12.000 €`;
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    severityBand: band,
    severityChecked: true
  });

  // 4 o 5 => > 5.000€ => forzar presencial
  if (band >= 4) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded'
    });
    return 'Cita únicamente disponible presencialmente, por favor indique la fecha que mejor le convenga';
  }

  // 1-3 => mostrar mensaje_cita para elegir modalidad y luego pedir fecha
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment'
  });

  return ' '; // index.js envía mensaje_cita
}

function handleDateStage(rawMessage, senderNumber) {
  const dateText = (rawMessage || '').trim();

  if (dateText.length < 4) {
    return 'Por favor, indique la fecha que mejor le convenga (por ejemplo: 15/01/2026 o “martes por la tarde”).';
  }

  const conv = conversationManager.getConversation(senderNumber);

  conversationManager.createOrUpdateConversation(senderNumber, {
    preferredDate: dateText,
    status: 'completed',
    stage: 'completed'
  });

  const modo = conv?.appointmentMode === 'presencial' ? 'Presencial' : 'Telemática';
  const tipologia = conv?.claimType ? `Opción ${conv.claimType}` : '(sin tipología)';
  const gravedad = conv?.severityBand ? `Tramo ${conv.severityBand}` : 'No aplica';

  return `✅ Resumen de datos:

- Tipología: ${tipologia}
- Gravedad: ${gravedad}
- Tipo de cita: ${modo}
- Fecha propuesta: ${dateText}

Muchas gracias. El perito se pondrá en contacto con el asegurado para coordinar la visita.`;
}

/* =======================
   TWIML
======================= */
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