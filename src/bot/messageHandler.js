// messageHandler.js
const responses = require('./responses');
const conversationManager = require('./conversationManager');

function parseCorrections(text) {
  const raw = (text || '').trim();

  // Intentar formato estructurado
  const direccion =
    raw.match(/direccion\s*:\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() || '';
  const fecha =
    raw.match(/fecha\s*:\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() || '';
  const nombre =
    raw.match(/nombre\s*:\s*(.+)/i)?.[1]?.split('\n')[0]?.trim() || '';

  // Fallback: texto libre tipo "calle flores 12/12/2025 paco"
  if (!direccion && !fecha && !nombre) {
    const parts = raw.split(/\s+/);
    const dateRegex = /\d{1,2}\/\d{1,2}\/\d{2,4}/;

    const fechaToken = parts.find(p => dateRegex.test(p)) || '';
    const fechaIndex = fechaToken ? parts.indexOf(fechaToken) : -1;

    const dir = fechaIndex > 0 ? parts.slice(0, fechaIndex).join(' ') : raw;
    const nom = fechaIndex >= 0 ? parts.slice(fechaIndex + 1).join(' ') : '';

    return {
      direccion: dir.trim(),
      fecha: fechaToken.trim(),
      nombre: nom.trim()
    };
  }

  return { direccion, fecha, nombre };
}

function normalizeText(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/* =======================
   ADMIN OFFER HELPERS
======================= */
function isLikelyValidButtonReply(stage, rawMessage) {
  const t = normalizeText(rawMessage);
  if (!t) return false;

  if (/\b\d{1,2}\b/.test(t)) return true;
  if (/\b(si|no|ok|vale|correcto|correctos|error|incorrecto)\b/.test(t)) return true;

  if (stage === 'initial') {
    if (t.includes('son correct')) return true;
    if (t.includes('hay algun error') || t.includes('hay algún error')) return true;
    if (t.includes('numero equivocado') || t.includes('número equivocado')) return true;
    if (t.includes('asegurad')) return true;
    if (t.includes('no soy')) return true;
    if (t.includes('no puedo')) return true;
  }

  if (stage === 'attendee_select') {
    if (t.includes('otra persona')) return true;
    if (t.includes('yo') || t.includes('asegurad')) return true;
  }

  if (stage === 'appointment_select') {
    if (t.includes('presencial')) return true;
    if (t.includes('telematic') || t.includes('telema')) return true;
  }

  if (stage === 'awaiting_severity') {
    if (t.includes('500') || t.includes('2500') || t.includes('5000') || t.includes('12000') || t.includes('mas de')) return true;
  }

  return false;
}

function shouldOfferAdmin(conversation, rawMessage) {
  if (!conversation) return false;
  if (conversation.lastPromptType !== 'buttons') return false;

  if (conversation.status === 'awaiting_continuation' || conversation.status === 'awaiting_admin_offer') return false;
  if (conversation.status === 'completed' || conversation.status === 'escalated') return false;

  const strictStages = new Set(['initial', 'attendee_select', 'appointment_select', 'awaiting_severity']);
  if (!strictStages.has(conversation.stage)) return false;

  return !isLikelyValidButtonReply(conversation.stage, rawMessage);
}

/* =======================
   CLAIM TYPE
======================= */
const CLAIM_TYPE_OPTIONS = [
  'Rotura de vitrocerámica, cristales o sanitarios',
  'Incendio',
  'Fenómenos atmosféricos: precipitaciones de Lluvia',
  'Fenómenos atmosféricos: viento',
  'Fenómenos atmosféricos: rayos',
  'Otros fenómenos atmosféricos',
  'Daños por agua',
  'Sobretensión producida por compañía suministradora de luz',
  'Otros daños eléctricos',
  'Actos vandálicos o intento de robo sin sustracción de Bienes',
  'Robo con sustracción de Bienes',
  'Impacto',
  'Responsabilidad Civil (RC)',
  'Lesiones',
  'Otros'
];

const CLAIM_TYPE_MENU = `Indique la tipología del siniestro (marque una opción):

*1.* Rotura de vitrocerámica, cristales o sanitarios
*2.* Incendio
*3.* Fenómenos atmosféricos: precipitaciones de Lluvia
*4.* Fenómenos atmosféricos: viento
*5.* Fenómenos atmosféricos: rayos
*6.* Otros fenómenos atmosféricos
*7.* Daños por agua
*8.* Sobretensión producida por compañía suministradora de luz
*9.* Otros daños eléctricos
*10.* Actos vandálicos o intento de robo sin sustracción de Bienes
*11.* Robo con sustracción de Bienes
*12.* Impacto
*13.* Responsabilidad Civil (RC)
*14.* Lesiones
*15.* Otros`;

function extractClaimTypeByChoice(rawMessage) {
  const t = normalizeText(rawMessage);

  const numMatch = t.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= CLAIM_TYPE_OPTIONS.length) {
      return { index: n, label: CLAIM_TYPE_OPTIONS[n - 1] };
    }
  }

  for (let i = 0; i < CLAIM_TYPE_OPTIONS.length; i++) {
    if (normalizeText(CLAIM_TYPE_OPTIONS[i]) === t) {
      return { index: i + 1, label: CLAIM_TYPE_OPTIONS[i] };
    }
  }

  return null;
}

function isForcedPresentialClaimType(label) {
  const n = normalizeText(label);
  return (
    n === normalizeText('Sobretensión producida por compañía suministradora de luz') ||
    n === normalizeText('Robo con sustracción de Bienes') ||
    n === normalizeText('Lesiones')
  );
}

/* =======================
   SEVERITY (TEMPLATE) - ✅ CORREGIDO CON PUNTOS Y COMAS
======================= */
const SEVERITY_OPTIONS = ['0 – 500', '500 – 2500', '2500 – 5000', '5000 – 12000', 'Más de 12000'];

function extractSeverityByChoice(rawMessage) {
  const t = normalizeText(rawMessage);

  // normaliza guiones "raros" a "-"
  const normalized = t.replace(/[–—]/g, '-');

  // quita €, puntos, comas y espacios
  const clean = normalized
    .replace(/€/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();

  // 1) Si responde con número 1-5, perfecto
  const direct = clean.match(/^([1-5])$/);
  if (direct) {
    const idx = parseInt(direct[1], 10);
    return { index: idx, label: SEVERITY_OPTIONS[idx - 1] };
  }

  // 2) Si viene un rango tipo "5001-12000"
  const range = clean.match(/^(\d+)-(\d+)$/);
  if (range) {
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);

    // Clasifica por el "tope" (b)
    if (b <= 500) return { index: 1, label: SEVERITY_OPTIONS[0] };
    if (b <= 2500) return { index: 2, label: SEVERITY_OPTIONS[1] };
    if (b <= 5000) return { index: 3, label: SEVERITY_OPTIONS[2] };
    if (b <= 12000) return { index: 4, label: SEVERITY_OPTIONS[3] };
  }

  // 3) "masde12000"
  if (clean.includes('masde12000')) {
    return { index: 5, label: SEVERITY_OPTIONS[4] };
  }

  // 4) Match directo con texto de opciones (por si acaso)
  for (let i = 0; i < SEVERITY_OPTIONS.length; i++) {
    const optClean = normalizeText(SEVERITY_OPTIONS[i]).replace(/\s+/g, '');
    if (optClean === clean) return { index: i + 1, label: SEVERITY_OPTIONS[i] };
  }

  return null;
}

function isForcedPresentialSeverity(label) {
  // ✅ Normalizar y limpiar para comparar
  const clean = normalizeText(label).replace(/\s+/g, '').replace(/€/g, '').replace(/\./g, '').replace(/,/g, '');

  // Opciones que FUERZAN presencial (3, 4, 5)
  const forcedOptions = [
    '2500-5000',     // Opción 3
    '5000-12000',    // Opción 4
    'masde12000'     // Opción 5
  ];

  return forcedOptions.includes(clean);
}

/* =======================
   MAIN
======================= */
function processMessage(incomingMessage, senderNumber) {
  let conversation = conversationManager.getConversation(senderNumber);
  if (!conversation) {
    conversation = conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'initial',
      status: 'pending',
      attempts: 0
    });
  }

  if (conversation.status === 'snoozed') {
    conversation = conversationManager.clearSnoozed(senderNumber);
  }

  // ✅ MANEJAR CONTINUACIÓN
  if (conversation.status === 'awaiting_continuation') {
    const { handleContinuationResponse } = require('./inactivityHandler');
    const continuationResponse = handleContinuationResponse(incomingMessage, senderNumber);
    if (continuationResponse) {
      conversationManager.recordResponse(senderNumber, incomingMessage, 'user');
      if (continuationResponse.trim()) {
        conversationManager.recordResponse(senderNumber, continuationResponse, 'bot');
      }
      return continuationResponse;
    }
  }

  // admin offer flow
  if (conversation.status === 'awaiting_admin_offer') {
    const t = normalizeText(incomingMessage);
    conversationManager.recordResponse(senderNumber, incomingMessage, 'user');

    if (t === 'si' || t === 'sí') {
      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'escalated',
        stage: 'escalated',
        lastPromptType: 'text'
      });
      const txt = 'De acuerdo. Administración se pondrá en contacto con usted. Un saludo.';
      conversationManager.recordResponse(senderNumber, txt, 'bot');
      return txt;
    }

    if (t === 'no') {
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

  conversationManager.recordResponse(senderNumber, incomingMessage, 'user');

  if (conversation.continuationAskedAt || conversation.continuationTimeoutAt || conversation.inactivityCheckAt) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      continuationAskedAt: null,
      continuationTimeoutAt: null,
      inactivityCheckAt: null
    });
  }

  if (shouldOfferAdmin(conversation, incomingMessage)) {
    const txt = '¿Desea hablar con administración? Responda "Sí" o "No".';
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'awaiting_admin_offer',
      lastPromptType: 'text'
    });
    conversationManager.recordResponse(senderNumber, txt, 'bot');
    return txt;
  }

  let response;

  switch (conversation.stage) {
    case 'initial':
      response = handleInitialStage(incomingMessage, senderNumber);
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
    case 'awaiting_severity':
      response = handleSeverityStage(incomingMessage, senderNumber);
      break;
    case 'appointment_select':
      response = handleAppointmentSelectStage(incomingMessage, senderNumber);
      break;
    case 'awaiting_date':
      response = handleDateStage(incomingMessage, senderNumber);
      break;
    default:
      response = responses.default;
  }

  if (response && response.trim()) {
    conversationManager.recordResponse(senderNumber, response, 'bot');
  }

  return response;
}

/* =======================
   STAGES
======================= */

function handleInitialStage(rawMessage, senderNumber) {
  const mensaje = normalizeText(rawMessage);

  // ✅ Reconocer confirmación de datos
  if (mensaje.includes('son correct') || mensaje.includes('correcto')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee',
      lastPromptType: 'buttons'
    });
    return ' ';
  }

  // ✅ Reconocer confirmación de identidad
  if (mensaje.includes('si') || mensaje.includes('sí') || mensaje.includes('asegurad')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee',
      lastPromptType: 'buttons'
    });
    return ' ';
  }

  // ✅ Detectar errores en datos
  if (mensaje.includes('hay algun error') || mensaje.includes('hay algún error') || mensaje.includes('error')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded',
      lastPromptType: 'text'
    });
    return 'De acuerdo. Por favor, indíquenos los datos correctos en un solo mensaje.\n\nEjemplo:\n- Dirección: ...\n- Fecha de ocurrencia: ...\n- Nombre del asegurado: ...';
  }

  // ✅ Número equivocado
  if (mensaje.includes('numero equivocado') || mensaje.includes('número equivocado') || mensaje.includes('no soy')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      status: 'completed',
      stage: 'completed',
      lastPromptType: 'text'
    });
    return responses.noEsAsegurado;
  }

  // ✅ Usuario ocupado
  if (mensaje === '3' || mensaje.includes('no puedo') || mensaje.includes('ahora no puedo')) {
    conversationManager.snoozeConversation(senderNumber, 6 * 60 * 60 * 1000); // 6 horas
    return responses.ocupado;
  }

  return responses.default;
}

function handleAwaitingCorrectionsStage(rawMessage, senderNumber) {
  const txt = (rawMessage || '').trim();

  if (txt.length < 5) {
    return 'Por favor, indique los datos a corregir con algo más de detalle.';
  }

  const parsed = parseCorrections(txt);

  conversationManager.createOrUpdateConversation(senderNumber, {
    corrections: txt,
    correctedDireccion: parsed.direccion,
    correctedFecha: parsed.fecha,
    correctedNombre: parsed.nombre,
    stage: 'confirming_corrections',
    status: 'awaiting_correction_confirmation',
    lastPromptType: 'buttons'
  });

  return ' ';
}

function handleConfirmingCorrectionsStage(rawMessage, senderNumber) {
  const m = normalizeText(rawMessage);

  if (m.includes('si') || m.includes('sí') || m.includes('correct')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'attendee_select',
      status: 'awaiting_attendee',
      lastPromptType: 'buttons'
    });
    return ' ';
  }

  if (m.includes('no') || m.includes('error') || m.includes('incorrect')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_corrections',
      status: 'responded',
      lastPromptType: 'text'
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
      status: 'responded',
      lastPromptType: 'text'
    });
    return 'Por favor, indique en un solo mensaje: nombre, teléfono y relación con el asegurado.';
  }

  if (m.includes('yo') || m.includes('asegurad')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_claim_type',
      status: 'responded',
      lastPromptType: 'text'
    });
    return CLAIM_TYPE_MENU;
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'attendee_select',
    status: 'awaiting_attendee',
    lastPromptType: 'buttons'
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
    status: 'responded',
    lastPromptType: 'text'
  });

  return CLAIM_TYPE_MENU;
}

function handleClaimTypeStage(rawMessage, senderNumber) {
  const chosen = extractClaimTypeByChoice(rawMessage);

  if (!chosen) {
    return `No he entendido la opción. Responda con un número del 1 al 15.\n\n${CLAIM_TYPE_MENU}`;
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    claimType: chosen.index,
    claimTypeLabel: chosen.label
  });

  // if (isForcedPresentialClaimType(chosen.label)) {
  //   conversationManager.createOrUpdateConversation(senderNumber, {
  //     appointmentMode: 'presencial',
  //     presentialForced: true,
  //     stage: 'completed',
  //     status: 'completed',
  //     lastPromptType: 'text'
  //   });
  //   return 'Cita solo disponible de forma presencial, administración se pondrá en contacto con usted.';
  // }

  if (chosen.index >= 3) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      presentialForced: true,
      stage: 'completed',
      status: 'completed',
      lastPromptType: 'text'
    });
    return 'Cita solo disponible de forma presencial, administración se pondrá en contacto con usted.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'awaiting_severity',
    status: 'awaiting_severity_template',
    lastPromptType: 'buttons'
  });

  return ' ';
}

function handleSeverityStage(rawMessage, senderNumber) {
  const chosen = extractSeverityByChoice(rawMessage);

  if (!chosen) {
    // No reconoció la opción, reenviar template
    conversationManager.createOrUpdateConversation(senderNumber, {
      stage: 'awaiting_severity',
      status: 'awaiting_severity_template',
      lastPromptType: 'buttons'
    });
    return ' ';
  }

  // Guardar la selección
  conversationManager.createOrUpdateConversation(senderNumber, {
    severityIndex: chosen.index,
    severityLabel: chosen.label
  });

  // ✅ Si es opción 3, 4 o 5 → FORZAR PRESENCIAL Y FINALIZAR
  if (chosen.index >= 3) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      presentialForced: true,
      stage: 'completed',
      status: 'completed',
      lastPromptType: 'text'
    });
    return 'Cita solo disponible de forma presencial, administración se pondrá en contacto con usted.';
  }


  // ✅ Si es opción 1 o 2 → PERMITIR ELEGIR
  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment',
    lastPromptType: 'buttons'
  });
  return ' ';
}

function handleAppointmentSelectStage(rawMessage, senderNumber) {
  const t = normalizeText(rawMessage);

  if (t.includes('presencial')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'presencial',
      stage: 'awaiting_date',
      status: 'responded',
      lastPromptType: 'text',
      lastInteractive: {
        kind: 'text',
        body: 'Por favor, indique la fecha que mejor le convenga.'
      }
    });
    return 'Por favor, indique la fecha que mejor le convenga.';
  }

  if (t.includes('telematic') || t.includes('telema')) {
    conversationManager.createOrUpdateConversation(senderNumber, {
      appointmentMode: 'telematica',
      stage: 'awaiting_date',
      status: 'responded',
      lastPromptType: 'text',
      lastInteractive: {
        kind: 'text',
        body: 'Por favor, indique la fecha que mejor le convenga.'
      }
    });
    return 'Por favor, indique la fecha que mejor le convenga.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    stage: 'appointment_select',
    status: 'awaiting_appointment',
    lastPromptType: 'buttons'
  });
  return ' ';
}

function handleDateStage(rawMessage, senderNumber) {
  const dateText = (rawMessage || '').trim();

  if (dateText.length < 4) {
    return 'Por favor, indique una fecha válida.';
  }

  conversationManager.createOrUpdateConversation(senderNumber, {
    preferredDate: dateText,
    stage: 'completed',
    status: 'completed',
    lastPromptType: 'text'
  });

  return responses.conversacionFinalizada;
}

module.exports = {
  processMessage
};