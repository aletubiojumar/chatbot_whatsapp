// messageHandler.js
const responses = require('./responses');
const conversationManager = require('./conversationManager');

/**
 * Regla "Administración":
 * - SOLO se activa si el último prompt enviado fue un TEMPLATE con botones (lastPromptType === 'buttons')
 * - y el usuario envía algo que NO parece una respuesta válida para ese paso.
 *
 * Reenvío de templates:
 * - Cuando el usuario responde inválido en etapas de botones, devolvemos ' ' y ajustamos status
 *   para que index.js reenvíe el template correspondiente.
 */

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .trim();
}

/* =======================
   ADMIN OFFER HELPERS
======================= */

function isLikelyValidButtonReply(stage, rawMessage) {
  const t = normalizeText(rawMessage);
  if (!t) return false;

  // números sueltos
  if (/\b\d{1,2}\b/.test(t)) return true;

  // sí/no típicos
  if (/\b(si|no|ok|vale|correcto|correctos|error|incorrecto)\b/.test(t)) return true;

  // por etapa (botones suelen devolver texto literal)
  if (stage === 'initial') {
    if (t.includes('asegurad')) return true;
    if (t.includes('no soy')) return true;
    if (t.includes('no puedo')) return true;
    if (t.includes('ahora no puedo')) return true;
    if (t.includes('ha sido un error')) return true;
  }

  if (stage === 'identity_confirmed') {
    // confirmación de datos correctos/incorrectos
    if (t.includes('correct')) return true;
    if (t.includes('error') || t.includes('incorrect')) return true;
  }

  if (stage === 'attendee_select') {
    if (t.includes('otra persona')) return true;
    if (t.includes('yo') || t.includes('asegurad')) return true;
  }

  if (stage === 'appointment_select') {
    if (t.includes('presencial')) return true;
    if (t.includes('telematic') || t.includes('telema')) return true;
  }

  return false;
}

function shouldOfferAdmin(conversation, rawMessage) {
  if (!conversation) return false;

  // solo si venimos de botones
  if (conversation.lastPromptType !== 'buttons') return false;

  // no interferir con estados especiales
  if (conversation.status === 'awaiting_continuation' || conversation.status === 'awaiting_admin_offer') return false;
  if (conversation.status === 'completed' || conversation.status === 'escalated') return false;

  const strictStages = new Set([
    'initial',
    'identity_confirmed',
    'attendee_select',
    'appointment_select'
  ]);

  if (!strictStages.has(conversation.stage)) return false;

  return !isLikelyValidButtonReply(conversation.stage, rawMessage);
}

/* =======================
   CLAIM TYPE (texto/número)
======================= */

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
  { n: 1, keys: ['actos vandalicos', 'vandalico', 'vandalicos'] },
  { n: 2, keys: ['averia electrica', 'equipo electrico', 'electrodomestico'] },
  { n: 3, keys: ['rayo', 'caida de rayo'] },
  { n: 4, keys: ['cristal', 'cristales', 'vitroceramica', 'rotura vidrio'] },
  { n: 5, keys: ['agua', 'danos por agua', 'fuga', 'filtracion', 'humedad'] },
  { n: 6, keys: ['impacto', 'golpe', 'choque'] },
  { n: 7, keys: ['incendio', 'fuego', 'quemado'] },
  { n: 8, keys: ['viento', 'temporal', 'vendaval'] },
  { n: 9, keys: ['precipitaciones', 'lluvia', 'granizo', 'nieve'] },
  { n: 10, keys: ['rc', 'responsabilidad civil', 'responsabilidad'] },
  { n: 11, keys: ['robo sin sustraccion', 'intento de robo', 'danos por robo'] },
  { n: 12, keys: ['rotura sanitario', 'sanitario', 'wc', 'inodoro', 'lavabo'] },
  { n: 13, keys: ['sobretension', 'suministro publico'] },
  { n: 14, keys: ['arbitraje'] },
  { n: 15, keys: ['lesiones', 'herida', 'accidente'] },
  { n: 16, keys: ['robo con sustraccion', 'sustraccion'] },
  { n: 17, keys: ['varias opciones', 'varios', 'multiple'] },
  { n: 18, keys: ['otros', 'otro'] }
];

function extractClaimType(rawMessage) {
  const t = normalizeText(rawMessage);

  const numMatch = t.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 18) return n;
  }

  for (const item of CLAIM_TYPE_KEYWORDS) {
    for (const k of item.keys) {
      if (t.includes(normalizeText(k))) return item.n;
    }
  }

  return null;
}

/* =======================
   MAIN
======================= */

function processMessage(incomingMessage, senderNumber) {
  // Obtener/crear conversación
  let conversation = conversationManager.getConversation(senderNumber);
  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending',
      attempts: 0
    });
  }

  // Si estaba snoozed y vuelve a escribir, cancelar snooze
  if (conversation.status === 'snoozed') {
    conversation = conversationManager.clearSnoozed(senderNumber);
  }

  // 1) Modo: esperando respuesta a administración
  if (conversation.status === 'awaiting_admin_offer') {
    const t = normalizeText(incomingMessage);

    conversationManager.recordResponse(senderNumber, incomingMessage, 'user');

    if (t === 'si' || t.startsWith('si ') || t === 'sí' || t.startsWith('sí ')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'escalated',
        stage: 'escalated',
        lastPromptType: 'text'
      });

      const txt = 'De acuerdo. Administración se pondrá en contacto con usted. Un saludo.';
      conversationManager.recordResponse(senderNumber, txt, 'bot');
      return txt;
    }

    if (t === 'no' || t.startsWith('no ')) {
      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'text'
      });

      const txt = 'Perfecto, continuemos.';
      conversationManager.recordResponse(senderNumber, txt, 'bot');
      return txt;
    }

    const txt = 'Por favor, responda "Sí" o "No". ¿Desea hablar con administración?';
    conversationManager.createOrUpdateConversation(senderNumber, { lastPromptType: 'text' });
    conversationManager.recordResponse(senderNumber, txt, 'bot');
    return txt;
  }

  // 2) Modo: esperando continuación (inactividad)
  if (conversation.status === 'awaiting_continuation') {
    const { handleContinuationResponse } = require('./inactivityHandler');
    const continuationResponse = handleContinuationResponse(incomingMessage, senderNumber);

    if (continuationResponse) {
      conversationManager.recordResponse(senderNumber, incomingMessage, 'user');
      conversationManager.recordResponse(senderNumber, continuationResponse, 'bot');
      return continuationResponse;
    }
  }

  // Registrar mensaje usuario
  conversationManager.recordResponse(senderNumber, incomingMessage, 'user');

  // Limpiar campos inactividad si responde
  if (conversation.continuationAskedAt || conversation.continuationTimeoutAt || conversation.inactivityCheckAt) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null
    });
  }

  // 3) Oferta de administración (solo si veníamos de botones y el texto es raro)
  if (shouldOfferAdmin(conversation, incomingMessage)) {
    const txt = '¿Desea hablar con administración? Responda "Sí" o "No".';
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'awaiting_admin_offer',
      lastPromptType: 'text'
    });
    conversationManager.recordResponse(senderNumber, txt, 'bot');
    return txt;
  }

  // 4) Flujo normal por etapa
  let response;

  switch (conversation.stage) {
    case 'initial':
      response = handleInitialStage(incomingMessage, senderNumber);
      break;

    case 'identity_confirmed':
      response = handleIdentityConfirmedStage(incomingMessage, senderNumber);
      break;

    case 'awaiting_corrections':
      response = handleAwaitingCorrectionsStage(incomingMessage, senderNumber);
      break;

    case 'confirming_corrections':
      response = handleConfirmingCorrectionsStage(incomingMessage, senderNumber);
      break;

    case 'attendee_select':
      response = handleAttendeeSelectStage(incomingMessage, senderNumber);
      break;

    case 'awaiting_other_person_details':
      response = handleOtherPersonDetailsStage(incomingMessage, senderNumber);
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

  // Registrar respuesta bot solo si hay texto no-vacío
  if (response && response.trim() !== '') {
    conversationManager.createOrUpdateConversation(senderNumber, { lastPromptType: 'text' });
    conversationManager.recordResponse(senderNumber, response, 'bot');
  }

  return response || ' ';
}

/* =======================
   STAGES
======================= */

function handleInitialStage(rawMessage, senderNumber) {
  const mensaje = normalizeText(rawMessage);

  // No soy el asegurado
  if (
    mensaje === '2' ||
    mensaje.includes('no soy') ||
    mensaje.includes('no es el asegurado')
  ) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed',
      stage: 'completed'
    });
    return responses.noEsAsegurado;
  }

  // Sí, soy el asegurado
  const esSi =
    mensaje === '1' ||
    mensaje === 'si' ||
    mensaje === 'sí' ||
    mensaje.includes('soy') ||
    mensaje.includes('asegurado');

  if (esSi) {
    conversationManager.advanceStage(senderNumber, 'identity_confirmed');
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'awaiting_verification'
    });
    return ' '; // index.js envía template verificación
  }

  // No puedo atender (snooze)
  if (mensaje === '3' || mensaje.includes('no puedo') || mensaje.includes('ahora no puedo')) {
    conversationManager.setSnoozed(senderNumber, 6);
    return responses.ocupado;
  }

  // Si llega algo raro aquí, NO mandamos opciones en texto (porque el equivalente es template inicial)
  // Si quieres reenviar el template inicial, aquí necesitarías tener un envío automático en index.js.
  // Por ahora, fallback genérico:
  return responses.default;
}

function handleIdentityConfirmedStage(rawMessage, senderNumber) {
  const m = normalizeText(rawMessage);

  // Datos correctos
  if (m.includes('si') || m.includes('sí') || m.includes('correct')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
    return ' '; // index.js envía template attendee
  }

  // Datos incorrectos
  if (m.includes('no') || m.includes('error') || m.includes('incorrect')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded'
    });
    return responses.pedirDatosCorregidos;
  }

  // ✅ Reenviar el template de verificación (en vez de texto)
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'identity_confirmed',
    status: 'awaiting_verification'
  });
  return ' ';
}

function handleAwaitingCorrectionsStage(rawMessage, senderNumber) {
  const txt = (rawMessage || '').trim();

  if (txt.length < 5) {
    return 'Por favor, indique los datos a corregir con algo más de detalle.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    corrections: txt,
    stage: 'confirming_corrections',
    status: 'responded'
  });

  return responses.confirmarDatosCorregidos(txt);
}

function handleConfirmingCorrectionsStage(rawMessage, senderNumber) {
  const m = normalizeText(rawMessage);

  if (m.includes('si') || m.includes('sí') || m.includes('correct')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee'
    });
    return ' ';
  }

  if (m.includes('no') || m.includes('error') || m.includes('incorrect')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded'
    });
    return responses.pedirDatosCorregidos;
  }

  return 'Por favor, responda "Sí" o "No".';
}

function handleAttendeeSelectStage(rawMessage, senderNumber) {
  const m = normalizeText(rawMessage);

  if (m.includes('otra persona')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_other_person_details',
      status: 'responded'
    });
    return 'Por favor, indique en un solo mensaje: nombre, teléfono y relación con el asegurado.';
  }

  if (m.includes('yo') || m.includes('asegurad')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_claim_type',
      status: 'responded'
    });
    return `Indique la tipología del siniestro (número o texto).\n\n${CLAIM_TYPE_MENU}`;
  }

  // ✅ Reenviar template attendee (en vez de texto)
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'attendee_select',
    status: 'awaiting_attendee'
  });
  return ' ';
}

function handleOtherPersonDetailsStage(rawMessage, senderNumber) {
  const txt = (rawMessage || '').trim();

  if (txt.length < 10) {
    return 'Por favor, indique nombre y teléfono (y si puede, relación con el asegurado) en un solo mensaje.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    otherPersonDetails: txt,
    stage: 'awaiting_claim_type',
    status: 'responded'
  });

  return `Indique la tipología del siniestro (número o texto).\n\n${CLAIM_TYPE_MENU}`;
}

function handleClaimTypeStage(rawMessage, senderNumber) {
  const n = extractClaimType(rawMessage);

  if (!n) {
    return `No he entendido la opción. Responda con un número del 1 al 18 (o escriba la tipología).\n\n${CLAIM_TYPE_MENU}`;
  }

  conversationManager.createOrUpdateConversation(senderNumber, { claimType: n });

  // Si >= 13 => presencial directo => pedir fecha
  if (n >= 13) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded'
    });
    return 'Por favor, indique la fecha que mejor le convenga.';
  }

  // Si no, seleccionar cita (template)
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment'
  });

  return ' ';
}

function handleAppointmentSelectStage(rawMessage, senderNumber) {
  const t = normalizeText(rawMessage);

  if (t.includes('presencial')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded'
    });
    return 'Por favor, indique la fecha que mejor le convenga.';
  }

  if (t.includes('telematic') || t.includes('telema')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'telematica',
      stage: 'awaiting_severity',
      status: 'responded'
    });
    return 'Indique el nivel de gravedad (por ejemplo: leve, media o grave).';
  }

  // ✅ Reenviar template cita (en vez de texto)
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment'
  });
  return ' ';
}

function extractSeverityBand(rawMessage) {
  const t = normalizeText(rawMessage);

  const m = t.match(/\b([1-5])\b/);
  if (m) return parseInt(m[1], 10);

  if (t.includes('leve')) return 1;
  if (t.includes('media')) return 3;
  if (t.includes('grave')) return 5;

  return null;
}

function handleSeverityStage(rawMessage, senderNumber) {
  const band = extractSeverityBand(rawMessage);

  if (!band) {
    return 'Indique el nivel de gravedad (por ejemplo: leve, media o grave).';
  }

  if (band <= 3) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      severityBand: band,
      appointmentMode: 'telematica',
      stage: 'awaiting_date',
      status: 'responded'
    });
    return 'Por favor, indique la fecha que mejor le convenga.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    severityBand: band,
    appointmentMode: 'presencial',
    stage: 'awaiting_date',
    status: 'responded'
  });

  return 'Por favor, indique la fecha que mejor le convenga.';
}

function handleDateStage(rawMessage, senderNumber) {
  const dateText = (rawMessage || '').trim();

  if (dateText.length < 4) {
    return 'Por favor, indique una fecha válida.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    preferredDate: dateText,
    stage: 'completed',
    status: 'completed'
  });

  return responses.conversacionFinalizada;
}

function generateTwiMLResponse(responseText) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(responseText || ' ')}</Message>
</Response>`;
}

function escapeXml(unsafe) {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  processMessage,
  generateTwiMLResponse
};
