// src/bot/messageHandler.js
const conversationManager = require('./conversationManager');
const { procesarConIA } = require('../ai/aiModel');
const adapter             = require('../channels/whatsappAdapter');
const { canProcess, isValidTransition } = require('./stateMachine');
const { triggerEncargoSync } = require('./peritolineAutoSync');
const { buildInitialTemplateText } = require('./templateSender');
const fileLogger          = require('../utils/fileLogger');
const axios = require('axios');
const {
  findNextAvailableSlot,
  bookAppointment,
  getBooking,
  saveProposedSlot,
  formatSlotForUser,
  detectPreferenceFromText,
} = require('../calendar/appointmentScheduler');

// Activo solo si están configuradas las credenciales de Microsoft Graph
const CALENDAR_ENABLED = !!(process.env.OUTLOOK_CALENDAR_USER && process.env.MICROSOFT_TENANT_ID);

// Mapping nombre perito → email para añadirlo como attendee en el evento de Outlook
const PERITO_EMAIL_MAP = (() => {
  try { return JSON.parse(process.env.OUTLOOK_PERITO_EMAILS || '{}'); } catch { return {}; }
})();

// Mapeo entre los valores que devuelve la IA y los stages internos
const ESTADO_IA_TO_STAGE = {
  identificacion: 'identification',
  valoracion:     'valoracion',
  agendando:      'agendando',
};

const TASK_FALLBACK_MESSAGES = {
  confirmar_direccion: '¿Es correcta la dirección registrada para este siniestro?',
  corregir_direccion: 'Indíquenos por favor la dirección correcta. Si lo prefiere, también puede compartir la ubicación del inmueble por WhatsApp.',
  confirmar_at_perito: '¿Será usted quien atienda al perito en la visita, o será otra persona?',
  pedir_estimacion: '¿Podría indicarnos una estimación aproximada del importe de los daños?',
  evaluar_digital: '¿Le vendría bien realizar la peritación por videollamada, o prefiere que el perito acuda en persona?',
  pedir_preferencia_horaria: '¿Prefiere que la visita del perito sea por la mañana o por la tarde?',
  pedir_ubicacion: 'Para poder asignar correctamente al perito, ¿podría compartir la ubicación del inmueble?',
  seguimiento_abierto: 'Gracias. Hemos tomado nota de la información. La conversación sigue abierta por si necesita añadir algún dato más.',
};

// Cache de CP → localidad para no repetir peticiones
const cpCache = {};
const RELATION_RE = /\b(?:mi|su)\s+(herman[oa]|padre|madre|hij[oa]|espos[oa]|marido|mujer|pareja|prim[oa]|tio|tia|sobrin[oa]|abuel[oa]|niet[oa]|cunad[oa]|yerno|nuera|representante|abogado|emplead[oa]|operari[oa]|limpieza|inquilin[oa]|arrendatari[oa]|vecin[oa]|amig[oa])\b/i;

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isPeritoAttendeePrompt(text) {
  const t = norm(text);
  return (
    (t.includes('quien') && t.includes('atendera') && t.includes('perito')) ||
    t.includes('atienda al perito') ||
    t.includes('atendera al perito') ||
    t.includes('atendera al perito cuando realice la visita') ||
    (t.includes('perito') && (t.includes('telefono') || t.includes('contactar'))) ||
    (t.includes('sera usted') && t.includes('atienda al perito'))
  );
}

function isPeritoAttendeeMentionInUser(text) {
  const t = norm(text);
  return (
    t.includes('atienda al perito') ||
    t.includes('atendera al perito') ||
    (t.includes('perito') && t.includes('atender'))
  );
}

function isConsentPrompt(text) {
  const t = norm(text);
  if (!t) return false;

  return (
    t.includes('necesitamos confirmar si desea continuar la conversacion por este medio') ||
    t.includes('desea continuar la gestion por este medio') ||
    t.includes('desea continuar la conversacion por este medio')
  );
}

function normalizeShortReply(text) {
  return norm(text)
    .trim()
    .replace(/^[+]+|[+]+$/g, '')
    .replace(/[.!,;:¿?]+$/g, '')
    .trim();
}

function isAffirmativeAck(text) {
  const t = normalizeShortReply(text);
  return /^(si|sí|ok|vale|perfecto|correcto|todo ok|todo correcto|de acuerdo|confirmado)$/.test(t);
}

function isNegativeAck(text) {
  const t = normalizeShortReply(text);
  return /^(no|negativo|prefiero no|rechazo)$/.test(t);
}

function buildRegisteredAddressText(valoresExcel = {}) {
  return [valoresExcel?.direccion, valoresExcel?.municipio].filter(Boolean).join(', ').trim();
}

function isAddressConfirmationPrompt(text, valoresExcel = {}) {
  const t = norm(text);
  if (!t) return false;

  const addressRef = norm(buildRegisteredAddressText(valoresExcel));
  const asksConfirmation =
    t.includes('es correcta') ||
    t.includes('es correcto') ||
    t.includes('hay algun dato que corregir');
  const mentionsRegisteredAddress =
    t.includes('direccion registrada') ||
    t.includes('direccion del siniestro') ||
    t.includes('segun nuestros datos, la direccion');

  return Boolean(asksConfirmation && (mentionsRegisteredAddress || (addressRef && t.includes(addressRef))));
}

function isAddressCorrectionPrompt(text) {
  const t = norm(text);
  if (!t) return false;

  return (
    t.includes('direccion correcta') &&
    (t.includes('puede compartir la ubicacion') || t.includes('tambien puede compartir la ubicacion'))
  );
}

function isPlainAddressRejection(text) {
  const t = normalizeShortReply(text);
  return /^(no|incorrecta|incorrecto|no es correcta|no es correcto|es incorrecta|es incorrecto)$/.test(t);
}

function hasMeaningfulAddressCorrection(text, { locationCoords = '' } = {}) {
  if (String(locationCoords || '').trim()) return true;

  const raw = String(text || '').trim();
  if (!raw) return false;

  return !isAffirmativeAck(raw) && !isPlainAddressRejection(raw);
}

function isLocationRequestPrompt(text) {
  const t = norm(text);
  if (!t) return false;

  return (
    t.includes('compartir la ubicacion del inmueble') ||
    t.includes('compartir la ubicacion del riesgo') ||
    t.includes('enviar la ubicacion del inmueble') ||
    t.includes('enviar la ubicacion del riesgo')
  );
}

/**
 * Detecta si el usuario está rechazando explícitamente una solicitud de ubicación
 * (ej: "no quiero", "no puedo", "prefiero no")
 */
function isLocationRequestRejection(text) {
  const t = norm(text);
  if (!t) return false;
  
  const shortReply = t.trim();
  
  return (
    shortReply === 'no' ||
    t.includes('no quiero') ||
    t.includes('no puedo') ||
    t.includes('prefiero no') ||
    t.includes('no compartir') ||
    t.includes('no enviar')
  );
}

function isExplicitHumanEscalationIntent(text) {
  const t = norm(text);
  return (
    t.includes('hablar con una persona') ||
    t.includes('hablar con alguien') ||
    t.includes('hablar con un agente') ||
    t.includes('hablar con un humano') ||
    t.includes('que me llamen') ||
    t.includes('que me llame') ||
    t.includes('me llamen') ||
    t.includes('me llame') ||
    t.includes('llamada') ||
    t.includes('por telefono') ||
    t.includes('por tlf')
  );
}

function canApplyStageTransition(currentStage, nextStage) {
  const from = String(currentStage || 'consent').trim() || 'consent';
  const to = String(nextStage || '').trim();
  if (!to) return false;
  return from === to || isValidTransition(from, to);
}

function getNonTerminalAiStateForStage(stage) {
  switch (stage) {
    case 'valoracion':
      return 'valoracion';
    case 'agendando':
      return 'agendando';
    case 'consent':
    case 'identification':
    default:
      return 'identificacion';
  }
}

function normalizeSchedulePreference(value) {
  const t = norm(value).trim();
  if (!t) return '';
  if (t === 'mañana' || t === 'manana') return 'Mañana';
  if (t === 'tarde') return 'Tarde';
  return '';
}

function hasSchedulePreference(value) {
  return Boolean(normalizeSchedulePreference(value));
}

function shouldAssumeDigitalAcceptance({ extractedDigital, existingDigital, preferredSchedule }) {
  if (typeof extractedDigital === 'boolean') return extractedDigital;
  if (String(existingDigital || '').trim().toLowerCase() === 'no') return false;
  return Boolean(normalizeSchedulePreference(preferredSchedule));
}

function shouldBlockEarlyTerminalStage({ currentStage, nextStage, userText, hasOutgoingMessage }) {
  const stage = String(currentStage || 'consent').trim() || 'consent';
  if (!hasOutgoingMessage) return false;

  const isEarlyStage = stage === 'consent' || stage === 'identification';
  if (!isEarlyStage) return false;

  if (nextStage === 'finalizado') return true;

  if (nextStage === 'escalated') {
    if (stage === 'consent' && isNegativeAck(userText)) return false;
    if (isExplicitHumanEscalationIntent(userText)) return false;
    return true;
  }

  return false;
}

function looksLikeClosureMessage(text) {
  const t = norm(text);
  if (!t) return false;

  return (
    t.includes('le contactaremos en breve') ||
    t.includes('gracias por su paciencia') ||
    t.includes('su caso esta siendo atendido por nuestro equipo') ||
    t.includes('su caso esta siendo atendido') ||
    t.includes('seguimos con el expediente') ||
    t.includes('continuara con el expediente') ||
    t.includes('continuara la gestion') ||
    t.includes('el perito continuara la gestion') ||
    t.includes('el perito se pondra en contacto con usted') ||
    t.includes('se pondra en contacto con usted') ||
    t.includes('el perito le llamara') ||
    t.includes('le llamara') ||
    t.includes('trasladamos la informacion al perito') ||
    t.includes('finalizamos la gestion por este medio') ||
    t.includes('finalizamos la comunicacion por este medio')
  );
}

function isAllowedTerminalTurn({
  responseType,
}) {
  return responseType === '__never__';
}

function hasMeaningfulAttendee(conversation, { lastBotMessage = '', userText = '', extractedAttendeeName = '' } = {}) {
  const stored = String(conversation?.attPerito || '').trim();
  if (stored && !stored.startsWith('sin indicar')) return true;

  // Si la IA ya extrajo un nombre de contacto en esta respuesta, el AT. perito es conocido
  if (extractedAttendeeName && String(extractedAttendeeName).trim()) return true;

  return isPeritoAttendeePrompt(lastBotMessage) && isAffirmativeAck(userText);
}

function detectNextRequiredTask({
  conversation,
  currentStage,
  addressStatus,
  lastBotMessage,
  userText,
  estimateAlreadyKnown,
  extractedDigital,
  extractedAttendeeName,
  preferredSchedule,
  locationAlreadyShared,
  locationRequestCount,
}) {
  const stage = String(currentStage || conversation?.stage || 'consent').trim() || 'consent';
  const effectiveAddressStatus = String(addressStatus || conversation?.addressStatus || 'pending').trim() || 'pending';
  const addressResolved = effectiveAddressStatus === 'confirmed' || effectiveAddressStatus === 'corrected';

  if (stage !== 'consent') {
    if (effectiveAddressStatus === 'needs_correction') return 'corregir_direccion';
    if (!addressResolved) return 'confirmar_direccion';
  }

  const attendeeKnown = hasMeaningfulAttendee(conversation, { lastBotMessage, userText, extractedAttendeeName });
  if (!attendeeKnown) return 'confirmar_at_perito';
  if (!estimateAlreadyKnown) return 'pedir_estimacion';

  const existingDigital = String(conversation?.digital || '').trim();
  const digitalKnown =
    typeof extractedDigital === 'boolean' ||
    existingDigital === 'Sí' ||
    existingDigital === 'No';
  if (!digitalKnown) return 'evaluar_digital';

  if (!hasSchedulePreference(preferredSchedule || conversation?.horario)) {
    return 'pedir_preferencia_horaria';
  }

  if (!locationAlreadyShared && locationRequestCount < 2) return 'pedir_ubicacion';

  return 'seguimiento_abierto';
}

function buildBlockedTerminalRetryContext(currentStage) {
  const aiState = getNonTerminalAiStateForStage(currentStage);
  return `[SISTEMA: CONTINUAR_FLUJO_SIN_CERRAR stage=${aiState}]`;
}

function buildBlockedClosureRetryContext(currentStage, task) {
  const aiState = getNonTerminalAiStateForStage(currentStage);
  const taskMarker = task ? ` task=${task}` : '';
  return `[SISTEMA: PROHIBIDO_CIERRE_SIN_RESUMEN stage=${aiState}${taskMarker}]`;
}

function getFallbackAiStateForTask(currentStage, task) {
  if (task === 'seguimiento_abierto') return 'agendando';
  return getNonTerminalAiStateForStage(currentStage);
}

function isTerminalStage(stage) {
  return stage === 'finalizado' || stage === 'escalated';
}

function isTerminalResponseType(responseType) {
  return responseType === 'resumen_final' || responseType === 'cierre_definitivo';
}

function buildSummaryFallbackMessage({
  conversation,
  valoresExcel,
  lastBotMessage = '',
  userText = '',
  estimateFromCurrent = '',
  preferredSchedule = '',
  locationAlreadyShared = false,
  extractedDigital,
  extractedAttendeeName = '',
  extractedAttendeeRelation = '',
}) {
  const lines = [];
  const address = [valoresExcel?.direccion, valoresExcel?.municipio].filter(Boolean).join(', ');
  const cause = String(valoresExcel?.causa || '').trim();

  if (address) lines.push(`Dirección del siniestro: ${address}.`);
  if (cause) lines.push(`Causa del siniestro: ${cause}.`);

  const storedAttendee = String(conversation?.attPerito || '').trim();
  if (storedAttendee && !storedAttendee.startsWith('sin indicar')) {
    const [name = '', relation = ''] = storedAttendee.split(' - ').map(v => String(v || '').trim());
    if (name && relation && relation !== 'sin indicar') {
      lines.push(`Persona que atenderá al perito: ${name} (${relation}).`);
    } else if (name) {
      lines.push(`Persona que atenderá al perito: ${name}.`);
    }
  } else if (String(extractedAttendeeName || '').trim()) {
    const name = String(extractedAttendeeName).trim();
    const relation = String(extractedAttendeeRelation || '').trim();
    if (relation) {
      lines.push(`Persona que atenderá al perito: ${name} (${relation}).`);
    } else {
      lines.push(`Persona que atenderá al perito: ${name}.`);
    }
  } else if (isPeritoAttendeePrompt(lastBotMessage) && isAffirmativeAck(userText)) {
    const insuredName = String(valoresExcel?.nombre || '').trim();
    if (insuredName) {
      lines.push(`Persona que atenderá al perito: ${insuredName}.`);
    } else {
      lines.push('Persona que atenderá al perito: la misma persona que responde por WhatsApp.');
    }
  }

  const estimate = String(estimateFromCurrent || conversation?.danos || '').trim();
  if (estimate) lines.push(`Estimación aproximada de daños: ${estimate}.`);

  const schedule = normalizeSchedulePreference(preferredSchedule || conversation?.horario || '');
  const storedDigital = String(conversation?.digital || '').trim();
  const effectiveDigital = typeof extractedDigital === 'boolean'
    ? extractedDigital
    : (storedDigital === 'Sí' ? true : storedDigital === 'No' ? false : null);

  if (schedule) {
    lines.push(`Modalidad prevista: videoperitación (${schedule.toLowerCase()}).`);
  } else if (effectiveDigital === true) {
    lines.push('Modalidad prevista: videoperitación.');
  } else if (effectiveDigital === false) {
    lines.push('Modalidad prevista: visita presencial.');
  }

  lines.push(
    locationAlreadyShared
      ? 'Ubicación del riesgo: facilitada.'
      : 'Ubicación del riesgo: pendiente de envío.'
  );

  const summaryBody = lines.length
    ? lines.map(line => `• ${line}`).join('\n')
    : '• Datos del expediente confirmados.';

  return `Perfecto. Antes de finalizar, le resumo los datos que tenemos:\n${summaryBody}\n\nSi todo es correcto, responda "sí".`;
}

function buildForcedConsentConfirmationResponse({ valoresExcel }) {
  const insuredName = String(valoresExcel?.nombre || '').trim();
  return {
    mensaje_para_usuario: insuredName
      ? `¿Hablo con ${insuredName}?`
      : '¿Hablo con el titular del seguro?',
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'identificacion',
      tipo_respuesta: 'pregunta_identidad',
    },
  };
}

function buildForcedAddressConfirmationResponse({ valoresExcel }) {
  const registeredAddress = buildRegisteredAddressText(valoresExcel);
  return {
    mensaje_para_usuario: registeredAddress
      ? `La dirección registrada para este siniestro es ${registeredAddress}. ¿Es correcta?`
      : TASK_FALLBACK_MESSAGES.confirmar_direccion,
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'identificacion',
      tipo_respuesta: 'normal',
    },
  };
}

function buildForcedAddressCorrectionResponse() {
  return {
    mensaje_para_usuario: TASK_FALLBACK_MESSAGES.corregir_direccion,
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'identificacion',
      tipo_respuesta: 'normal',
    },
  };
}

function buildForcedAttendeeConfirmationResponse({ valoresExcel, waId, relation = '' }) {
  return {
    mensaje_para_usuario: TASK_FALLBACK_MESSAGES.confirmar_at_perito,
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'valoracion',
      tipo_respuesta: 'normal',
      nombre_contacto: String(valoresExcel?.nombre || '').trim(),
      relacion_contacto: String(relation || '').trim(),
      telefono_contacto: normalizeContactPhone(waId),
    },
  };
}

function buildForcedLocationRequestResponse() {
  return {
    mensaje_para_usuario: TASK_FALLBACK_MESSAGES.pedir_ubicacion,
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'agendando',
      tipo_respuesta: 'peticion_ubicacion',
    },
  };
}

function buildForcedLocationClosureResponse() {
  return {
    mensaje_para_usuario: 'Entendido. Continuamos sin la ubicación del inmueble. Pasemos al siguiente paso.',
    mensaje_entendido: true,
    datos_extraidos: {
      estado_expediente: 'agendando',
      tipo_respuesta: 'normal',
    },
  };
}

function getTaskFallbackMessage(task, valoresExcel = {}) {
  if (task === 'confirmar_direccion') {
    return buildForcedAddressConfirmationResponse({ valoresExcel }).mensaje_para_usuario;
  }

  return TASK_FALLBACK_MESSAGES[task] || TASK_FALLBACK_MESSAGES.seguimiento_abierto;
}

function doesResponseMatchTask(task, { responseType = 'normal', message = '', valoresExcel = {} } = {}) {
  switch (task) {
    case 'confirmar_direccion':
      return isAddressConfirmationPrompt(message, valoresExcel);
    case 'corregir_direccion':
      return isAddressCorrectionPrompt(message);
    case 'pedir_ubicacion':
      return responseType === 'peticion_ubicacion' || isLocationRequestPrompt(message);
    default:
      return false;
  }
}

function buildForcedTaskResponse(task, { valoresExcel, currentStage } = {}) {
  switch (task) {
    case 'confirmar_direccion':
      return buildForcedAddressConfirmationResponse({ valoresExcel });
    case 'corregir_direccion':
      return buildForcedAddressCorrectionResponse();
    case 'pedir_ubicacion':
      return buildForcedLocationRequestResponse();
    default:
      return {
        mensaje_para_usuario: getTaskFallbackMessage(task, valoresExcel),
        mensaje_entendido: true,
        datos_extraidos: {
          estado_expediente: getFallbackAiStateForTask(currentStage, task),
          tipo_respuesta: 'normal',
        },
      };
  }
}

function hasSharedLocation(conversation, currentLocationCoords) {
  return Boolean(String(currentLocationCoords || conversation?.coordenadas || '').trim());
}

function normalizeContactPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^\d{9}$/.test(digits) && /^[6-9]/.test(digits)) digits = `34${digits}`;
  return digits;
}

/**
 * Analiza si una dirección española ya incluye datos de vivienda (bloque/escalera/
 * portal/piso) o si apunta a una vivienda unifamiliar, o si solo tiene calle+número
 * y habría que preguntar si es un piso.
 *
 * @returns {'completa'|'unifamiliar'|'incompleta'}
 */
function analyzeAddressType(direccion) {
  if (!direccion) return 'incompleta';
  const d = String(direccion).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Ya contiene datos de piso/bloque/escalera/portal
  if (
    /\bBLOQUE\b/.test(d) || /\bBL[OQ]?\.?\s*\d/.test(d) ||
    /\bESCALERA\b/.test(d) || /\bESC\.?\s*[A-Z\d]/.test(d) ||
    /\bPORTAL\b/.test(d)  || /\bPTA?\.?\s*[A-Z\d]/.test(d) ||
    /\bPUERTA\b/.test(d)  || /\bPISO\b/.test(d) ||
    /\bPLANTA\b/.test(d)  || /\bPL\.?\s*\d/.test(d) ||
    /\bAPTO\.?\b/.test(d) || /\bAPARTAMENTO\b/.test(d) ||
    /\b\d+[°ºAa]\s*[A-Z]?\b/.test(d)   // "1ºA", "2B", "3ª", etc.
  ) return 'completa';

  // Indicios claros de vivienda unifamiliar
  if (
    /\bCHALET\b/.test(d) || /\bVILLA\b/.test(d) ||
    /\bCASA\b/.test(d)   || /\bFINCA\b/.test(d) ||
    /\bPARCELA\b/.test(d) || /\bUNIFAMILIAR\b/.test(d) ||
    /\bURBANIZACI/.test(d)
  ) return 'unifamiliar';

  return 'incompleta';
}

function extractRelationship(text) {
  const m = String(text || '').toLowerCase().match(RELATION_RE);
  return m?.[1] ? m[1] : '';
}

function detectEconomicEstimate(text) {
  const raw = String(text || '').trim();
  const lowered = raw.toLowerCase();
  if (!raw) return null;

  // Rango: "1000-3000", "entre 1000 y 3000", "de 1000 a 3000"
  const rangeMatch = lowered.match(/(?:entre\s+)?(\d{1,2}(?:[.,]\d{3})+|\d{1,5})\s*(?:-|a|y)\s*(\d{1,2}(?:[.,]\d{3})+|\d{1,5})/i);
  if (rangeMatch) {
    const a = rangeMatch[1].replace(/\./g, '');
    const b = rangeMatch[2].replace(/\./g, '');
    return `${a} - ${b} €`;
  }

  // Importe con símbolo/palabra de moneda
  const moneyMatch = lowered.match(/(\d{1,2}(?:[.,]\d{3})+|\d{1,5})(?:[.,]\d{1,2})?\s*(?:€|euros?|eur)\b/i);
  if (moneyMatch) {
    return `${moneyMatch[1].replace(/\./g, '')} €`;
  }

  // Solo número corto (p.ej. "200")
  const justNumber = lowered.match(/^(\d{1,4})(?:[.,]\d{1,2})?$/);
  if (justNumber) {
    return `${justNumber[1]} €`;
  }

  return null;
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=es`;
    const res = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'BotPericialJumar/1.0' },
    });
    const a = res.data?.address;
    if (!a) return null;

    const road     = a.road || a.pedestrian || a.footway || '';
    const number   = a.house_number || '';
    const cp       = a.postcode || '';
    const city     = a.city || a.town || a.village || a.municipality || '';
    const province = a.province || a.state || '';

    const parts = [
      road && number ? `${road} ${number}` : road,
      cp,
      city,
      province !== city ? province : '',
    ].filter(Boolean);

    return { address: parts.join(', '), cp, city, displayName: res.data.display_name };
  } catch {
    return null;
  }
}

async function lookupCP(text) {
  const match = text.match(/\b(\d{5})\b/);
  if (!match) return null;
  const cp = match[1];
  if (cpCache[cp]) return cpCache[cp];
  try {
    const res = await axios.get(`https://api.zippopotam.us/es/${cp}`, { timeout: 3000 });
    const place = res.data.places?.[0];
    if (place) {
      const info = { cp, localidad: place['place name'], provincia: place.state };
      cpCache[cp] = info;
      return info;
    }
  } catch { /* CP no encontrado o API no disponible */ }
  return null;
}

async function buildAIConversationContext(conversation, nexp) {
  const userData = conversation?.userData || {};
  let mensajesPrevios = await conversationManager.getMensajes(conversation?.waId);

  if (mensajesPrevios.length === 0 && userData.aseguradora && nexp) {
    mensajesPrevios = [{
      direction: 'out',
      text:      buildInitialTemplateText({ aseguradora: userData.aseguradora, nexp, causa: userData.causa || userData.observaciones || '' }),
      timestamp: null,
    }];
  }

  const historial = mensajesPrevios.map(m => ({
    role:  m.direction === 'in' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const valoresExcel = {
    saludo:        new Date().getHours() < 12 ? 'Buenos días' : 'Buenas tardes',
    aseguradora:   userData.aseguradora   || 'la aseguradora',
    nexp,
    causa:         userData.causa         || '',
    observaciones: userData.observaciones || '',
    nombre:        userData.nombre        || 'el titular',
    direccion:     userData.direccion     || '',
    cp:            userData.cp            || '',
    municipio:     userData.municipio     || '',
  };

  return { userData, mensajesPrevios, historial, valoresExcel };
}

function normalizeAIResponse(rawResponse) {
  const respuestaIA = (rawResponse && typeof rawResponse === 'object') ? rawResponse : {};
  if (!respuestaIA.datos_extraidos || typeof respuestaIA.datos_extraidos !== 'object') {
    respuestaIA.datos_extraidos = {};
  }
  respuestaIA.mensaje_para_usuario = String(respuestaIA?.mensaje_para_usuario || '').trim();
  return respuestaIA;
}

async function requestAIResponse({ historial, mensajeUsuario, contextoSistema, valoresExcel, extraContext = '' }) {
  const mergedContext = extraContext ? `${contextoSistema}\n${extraContext}` : contextoSistema;
  const rawResponse = await procesarConIA(historial, mensajeUsuario, mergedContext, valoresExcel);
  return normalizeAIResponse(rawResponse);
}

/**
 * Procesa un mensaje entrante de WhatsApp.
 * @param {string} waId       - número sin + (ej. "34674742564")
 * @param {object} messageObj - objeto normalizado del whatsappAdapter
 */
async function processMessage(waId, messageObj) {
  try {
    let text = (messageObj.text || '').trim();
    let locationResolved = false;
    let locationCoords = null;

    // Mensajes de ubicación compartida por WhatsApp
    if (!text && messageObj.type === 'location' && messageObj.location?.latitude) {
      const loc = messageObj.location;
      locationCoords = `${loc.latitude}, ${loc.longitude}`;
      if (loc.address) {
        // Meta ya trae la dirección (negocio/POI seleccionado del mapa)
        text = `${loc.address} (GPS: ${locationCoords})`;
        locationResolved = true;
      } else {
        // Ubicación actual o pin manual: resolver con reverse geocoding
        const geo = await reverseGeocode(loc.latitude, loc.longitude);
        if (geo) {
          text = `${geo.address} (GPS: ${locationCoords})`;
          locationResolved = true;
        } else {
          // Fallback: coordenadas en texto para que la IA lo intente gestionar
          text = `Ubicación GPS: ${locationCoords}`;
          locationResolved = true;
        }
      }
    }

    if (!text) return;
    let stageAplicado = null;

    // Buscar el nexp vinculado a este número
    const nexp = await conversationManager.getNexpByWaId(waId);
    if (!nexp) {
      console.log(`⚠️  Número ${waId} sin expediente vinculado — ignorando`);
      return;
    }

    // ── Logger contextual (prefija [nexp] en cada línea) ─────────────────
    const FL = fileLogger.forNexp(nexp);
    const L = {
      log:  (...a) => console.log( `[${nexp}]`, ...a),
      warn: (...a) => { console.warn(`[${nexp}]`, ...a); FL.warn(a.map(String).join(' ')); },
      err:  (...a) => { console.error(`[${nexp}]`, ...a); FL.error(a.map(String).join(' ')); },
    };
    const msgPreview = text.length > 70 ? `${text.slice(0, 70)}…` : text;
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`📨 [${nexp}] "${msgPreview}"`);
    console.log('─'.repeat(65));

    // ── Máquina de estados ───────────────────────────────────────────────
    const conversation = await conversationManager.getConversation(waId);
    const stateCheck = canProcess(conversation);
    if (!stateCheck.ok) {
      L.log(`⛔ Bloqueado (${stateCheck.reason}) stage=${conversation?.stage}`);
      if (locationCoords) {
        const lateUpdate = { coordenadas: locationCoords };
        if (conversation.status === 'awaiting_location') {
          lateUpdate.status = 'pending';
          lateUpdate.locationStandbyUntil = 0;
        }
        await conversationManager.createOrUpdateConversation(waId, lateUpdate);
        triggerEncargoSync(nexp, 'coordenadas_tardias', '', false, true);
        L.log(`📍 Coordenadas recibidas, guardadas y sync disparado: ${locationCoords}`);
      }
      return;
    }

    // Detectar primera respuesta ANTES de registrar actividad
    const isFirstResponse = !conversation.lastUserMessageAt;
    const currentStage = String(conversation.stage || 'consent').trim() || 'consent';
    const currentAddressStatus = String(conversation.addressStatus || 'pending').trim() || 'pending';

    // Registrar actividad (resetea inactivityAttempts y nextReminderAt)
    await conversationManager.recordUserMessage(waId);

    // Leer datos del siniestro y mensajes desde Excel
    const {
      userData,
      mensajesPrevios,
      historial,
      valoresExcel,
    } = await buildAIConversationContext(conversation, nexp);

    const lastOutMsg      = [...mensajesPrevios].reverse().find(m => m?.direction === 'out') || null;
    const lastBotMessage  = lastOutMsg?.text || '';
    const lastBotResponseType = String(conversation.lastBotResponseType || '').trim();
    const locationRequestCount = Number(conversation.locationRequestCount || 0);
    const relationFromCurrent = extractRelationship(text);
    const peritoAttendeeContext = isPeritoAttendeePrompt(lastBotMessage) || isPeritoAttendeeMentionInUser(text);
    const identityConfirmedNow = lastBotResponseType === 'pregunta_identidad' && isAffirmativeAck(text);
    const identityResolvedNow = lastBotResponseType === 'pregunta_identidad' && (isAffirmativeAck(text) || Boolean(relationFromCurrent));
    const addressConfirmationActive = isAddressConfirmationPrompt(lastBotMessage, valoresExcel);
    const addressCorrectionActive = currentAddressStatus === 'needs_correction' || isAddressCorrectionPrompt(lastBotMessage);
    const addressConfirmedNow = addressConfirmationActive && isAffirmativeAck(text);
    const addressRejectedWithoutCorrection =
      (addressConfirmationActive || addressCorrectionActive) &&
      !locationCoords &&
      isPlainAddressRejection(text);
    const addressCorrectionProvidedNow =
      (addressConfirmationActive || addressCorrectionActive) &&
      hasMeaningfulAddressCorrection(text, { locationCoords });
    const effectiveAddressStatus = addressCorrectionProvidedNow
      ? 'corrected'
      : addressRejectedWithoutCorrection
        ? 'needs_correction'
        : addressConfirmedNow
          ? 'confirmed'
          : currentAddressStatus;
    const relationAlreadyKnown = Boolean(
      (!peritoAttendeeContext && relationFromCurrent) ||
      (conversation.relacion && String(conversation.relacion).trim())
    );
    const estimateFromCurrent = detectEconomicEstimate(text);
    const estimateAlreadyKnown = Boolean((conversation.danos && String(conversation.danos).trim()) || estimateFromCurrent);

    L.log('🔎 Estado previo |',
      `stage=${currentStage}`,
      `addressStatus=${currentAddressStatus}`,
      `locationRequestCount=${locationRequestCount}`,
      `lastBotResponseType=${lastBotResponseType}`,
      `relacion=${String(conversation.relacion || '').trim()}`,
      `danos=${String(conversation.danos || '').trim()}`
    );
    L.log('🔎 Contexto de respuesta |',
      `peritoAttendeeContext=${peritoAttendeeContext}`,
      `relationFromCurrent=${String(relationFromCurrent || '').trim()}`,
      `relationAlreadyKnown=${relationAlreadyKnown}`,
      `estimateFromCurrent=${String(estimateFromCurrent || '').trim()}`,
      `estimateAlreadyKnown=${estimateAlreadyKnown}`
    );

    // Enriquecer contexto con CP si se detecta
    const cpInfo = await lookupCP(text);
    const hoy = new Date();
    const diasSemana = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
    let contextoSistema = `[INFO]: Fecha actual: ${diasSemana[hoy.getDay()]} ${fechaHoy}. Ubicación: ${valoresExcel.direccion}, CP ${valoresExcel.cp}, ${valoresExcel.municipio}.`;
    if (locationResolved) {
      contextoSistema += `\n[UBICACIÓN GPS]: El usuario ha compartido su ubicación por GPS. La dirección "${text}" fue obtenida automáticamente. Acéptala como la dirección del siniestro sin pedir que la escriba de nuevo.`;
    }
    if (valoresExcel.observaciones) {
      contextoSistema += `\n[OBSERVACIONES DEL EXPEDIENTE]: ${valoresExcel.observaciones}`;
    }
    if (cpInfo) {
      contextoSistema += `\n[CP DETECTADO]: El código postal ${cpInfo.cp} corresponde a ${cpInfo.localidad} (${cpInfo.provincia}). No preguntes la localidad, úsala directamente.`;
    }
    if (effectiveAddressStatus === 'confirmed') {
      contextoSistema += '\n[DIRECCIÓN CONFIRMADA]: La dirección del expediente ya ha sido confirmada por el usuario. No vuelvas a pedirla.';
    } else if (effectiveAddressStatus === 'corrected') {
      contextoSistema += '\n[DIRECCIÓN CORREGIDA]: El usuario ya ha corregido la dirección del expediente. Usa la versión corregida del historial y no vuelvas a pedir confirmación.';
    } else if (effectiveAddressStatus === 'needs_correction') {
      contextoSistema += '\n[DIRECCIÓN PENDIENTE DE CORRECCIÓN]: El usuario indicó que la dirección del Excel no es correcta. Pide exclusivamente la dirección corregida y menciona que puede compartir la ubicación si lo prefiere.';
    }
    if (conversation.idioma && conversation.idioma !== 'es') {
      contextoSistema += `\n[IDIOMA ACTIVO]: ${conversation.idioma} — Responde SIEMPRE en este idioma, sin excepción.`;
    }
    // Análisis de dirección: si solo es calle+número, guiar a la IA para que pregunte datos de piso
    const tipoVivienda = analyzeAddressType(valoresExcel.direccion);
    if (tipoVivienda === 'incompleta') {
      contextoSistema += `\n[DIRECCIÓN INCOMPLETA]: La dirección registrada solo contiene calle y número ("${valoresExcel.direccion}"). No se puede saber si es piso o unifamiliar. Al confirmar la dirección, pregunta SIEMPRE de forma directa si es un piso y, de serlo, solicita bloque, escalera, portal y número de vivienda. No uses forma condicional débil; pregunta con certeza.`;
    } else if (tipoVivienda === 'completa') {
      contextoSistema += `\n[DIRECCIÓN COMPLETA]: La dirección ya incluye datos de bloque/escalera/portal/vivienda. Confírmala tal como está; no solicites más datos de ubicación de la vivienda.`;
    }
    // tipoVivienda === 'unifamiliar': la IA gestiona sin hint adicional

    contextoSistema += '\n[Videoperitación]: Si el usuario no expresa dudas, no expliques funcionamiento; pregunta disponibilidad directa (mañana/tarde).';

    // Contexto especial para el primer mensaje de consentimiento
    if ((currentStage === 'consent' || isFirstResponse) && isAffirmativeAck(text)) {
      contextoSistema += '\n[CONSENTIMIENTO CONFIRMADO]: El asegurado acaba de aceptar continuar por WhatsApp. Procede DIRECTAMENTE con la pregunta de identidad ("¿Hablo con [nombre completo]?"). PROHIBIDO repetir la presentación inicial ni el número de expediente.';
    }

    // Estado de espera de ubicación
    if (conversation.status === 'awaiting_location') {
      if (locationCoords) {
        contextoSistema += '\n[UBICACIÓN RECIBIDA]: El asegurado acaba de enviar su ubicación GPS. Acéptala y continúa con el flujo normal sin cerrar la conversación.';
      } else {
        contextoSistema += '\n[UBICACIÓN PENDIENTE]: La conversación está pendiente de recibir la ubicación del riesgo. El asegurado indicó que la enviaría más tarde. Si ahora escribe sin enviar GPS, responde brevemente y recuérdale que puede compartir la ubicación cuando quiera.';
      }
    }

    // Reintento de petición de ubicación si el asegurado la ignoró o rechazó
    if (!locationCoords && conversation.status !== 'awaiting_location' && lastBotResponseType === 'peticion_ubicacion') {
      if (locationRequestCount === 1) {
        contextoSistema += '\n[UBICACIÓN RECHAZADA UNA VEZ]: El asegurado rechazó compartir la ubicación. Vuelve a pedirla una última vez con el mismo mensaje exacto antes de continuar con el flujo.';
      } else if (locationRequestCount >= 2) {
        contextoSistema += '\n[UBICACIÓN RECHAZADA DOS VECES]: El asegurado ha rechazado la ubicación dos veces. NO vuelvas a pedirla. Continúa con el flujo normal (agradece brevemente y avanza) sin cerrar la conversación.';
      }
    }
    contextoSistema += '\n[DISTINCIÓN DE CAMPOS]: "Relación" es SOLO la relación del interlocutor actual con el asegurado. "AT. Perito" es SOLO la persona que atenderá al perito en la visita.';
    if (peritoAttendeeContext) {
      contextoSistema += '\n[CONTEXTO ACTUAL]: El usuario está respondiendo sobre quién atenderá al perito. Extrae nombre_contacto/relacion_contacto/telefono_contacto para "AT. Perito". No cambies la columna "Relación" del interlocutor.';
    }
    if (relationAlreadyKnown) {
      contextoSistema += '\n[DATO YA INFORMADO]: El interlocutor ya ha indicado su relación con el asegurado. No vuelvas a preguntar la relación; solicita solo el dato que falte.';
    }
    if (estimateAlreadyKnown) {
      const estimateRef = estimateFromCurrent || String(conversation.danos || '').trim();
      contextoSistema += `\n[DATO YA INFORMADO]: Ya existe estimación económica (${estimateRef}). No la vuelvas a pedir y avanza al siguiente paso.`;
    }
    if ((lastBotResponseType === 'resumen_final' || lastBotResponseType === 'cierre_definitivo') && isAffirmativeAck(text)) {
      contextoSistema += '\n[CONFIRMACIÓN DATOS]: El usuario confirma que los datos están correctos. Agradece brevemente y mantén la conversación abierta, sin despedida final ni cierre.';
    }
    if (identityConfirmedNow) {
      contextoSistema += '\n[CONFIRMACIÓN IDENTIDAD]: El usuario responde afirmativamente a tu pregunta de identidad/relación. Da la identificación por confirmada y avanza al siguiente dato pendiente. PROHIBIDO repetir la misma pregunta de identidad.';
    }

    // ── Calendario Outlook: consultar slot ANTES de llamar a la IA ───────
    if (CALENDAR_ENABLED) {
      const digitalSi       = conversation.digital === 'Sí';
      const prefFromText    = detectPreferenceFromText(text);
      const prefFromPrev    = String(conversation.horario || '').trim();
      const currentPref     = prefFromText || prefFromPrev;
      const existingBooking = getBooking(nexp);
      const slotConfirmed   = existingBooking?.status === 'confirmed';

      if (digitalSi && currentPref && !slotConfirmed) {
        const proposedBooking = existingBooking?.status === 'proposed' && existingBooking?.slotStart;

        if (proposedBooking && isAffirmativeAck(text)) {
          // Usuario confirma el slot propuesto → crear la cita ahora
          try {
            const proposedSlot = { start: new Date(existingBooking.slotStart) };
            const [attNombreRaw = '', , attTelefonoRaw = ''] = String(conversation.attPerito || '').split(' - ');
            const attNombreFinal   = attNombreRaw   !== 'sin indicar' ? attNombreRaw   : '';
            const attTelefonoFinal = attTelefonoRaw !== 'sin indicar' ? attTelefonoRaw : conversation.waId || '';
            const virtualPeritoKey = (process.env.PERITOLINE_VIRTUAL_PERITO_NAME || '').toUpperCase();
            const peritoEmail      = PERITO_EMAIL_MAP[virtualPeritoKey] || '';

            // URL de la plataforma web de videoperitación de la aseguradora
            const aseguradoraUrl = (() => {
              try {
                const urlMap = JSON.parse(process.env.OUTLOOK_ASEGURADORA_URLS || '{}');
                const aseg   = String(valoresExcel.aseguradora || '').trim().toUpperCase();
                return urlMap[aseg] || process.env.OUTLOOK_ASEGURADORA_URL_DEFAULT || '';
              } catch { return process.env.OUTLOOK_ASEGURADORA_URL_DEFAULT || ''; }
            })();

            const result = await bookAppointment({
              nexp,
              slot:       proposedSlot,
              attName:    attNombreFinal,
              attPhone:   attTelefonoFinal,
              peritoEmail,
              peritoName: virtualPeritoKey,
              aseguradoraUrl,
            });

            if (result.success) {
              const slotText = formatSlotForUser(proposedSlot);
              contextoSistema += `\n[CITA CONFIRMADA EN CALENDARIO]: La videoperitación ha sido registrada en el calendario de Outlook para el ${slotText}. Confirma al asegurado la fecha y hora exacta y mantén estado_expediente="agendando". No cierres la conversación.`;
              L.log(`📅 Cita Outlook creada: ${slotText}`);
            }
          } catch (err) {
            contextoSistema += `\n[ERROR CALENDARIO]: No se pudo crear la cita (${err.message}). Informa al asegurado de que confirmaremos la fecha por otro medio y mantén la conversación abierta.`;
            L.err(`❌ Error creando cita Outlook: ${err.message}`);
          }

        } else if (!proposedBooking) {
          // Aún no hay slot propuesto → buscar y proponer uno
          try {
            const slot = await findNextAvailableSlot(currentPref, nexp);
            if (slot) {
              saveProposedSlot(nexp, slot);
              const slotText = formatSlotForUser(slot);
              contextoSistema += `\n[SLOT DISPONIBLE EN OUTLOOK]: Hay disponibilidad el ${slotText}. Propón EXACTAMENTE esta fecha y hora al asegurado para que confirme. Mantén la conversación abierta.`;
              L.log(`📅 Slot propuesto: ${slotText}`);
            } else {
              contextoSistema += `\n[SIN DISPONIBILIDAD]: No hay huecos disponibles en los próximos ${process.env.CALENDAR_HORIZON_DAYS || 5} días laborables para la preferencia "${currentPref}". Informa al asegurado y ofrece contactar por teléfono para gestionar la cita manualmente.`;
              L.warn(`⚠️  Sin disponibilidad en Outlook para "${currentPref}"`);
            }
          } catch (err) {
            L.err(`❌ Error consultando Outlook: ${err.message}`);
            // No bloqueamos el flujo: la IA continúa sin la info del slot
          }
        }
      }
    }

    // ── Llamada a la IA ──────────────────────────────────────────────────
    // isFirstResponse cubre el caso en que DynamoDB tenga un stage incorrecto
    // pero el usuario claramente responde por primera vez al template inicial.
    const consentPromptDetected = currentStage === 'consent' || isConsentPrompt(lastBotMessage) || isFirstResponse;
    const consentConfirmedNow = consentPromptDetected && isAffirmativeAck(text);
    const attendeeConfirmedNow = peritoAttendeeContext && isAffirmativeAck(text);
    let respuestaIA;
    let forcePauseAfterReply = false;
    let forceLocationRetry = false;
    if (consentConfirmedNow) {
      respuestaIA = buildForcedConsentConfirmationResponse({ valoresExcel });
      L.warn(`⚠️  Consentimiento afirmativo detectado (stage=${currentStage}, consentimiento_detectado=${consentPromptDetected ? 'sí' : 'no'}) — se fuerza la pregunta de identidad sin pasar por la IA`);
    } else if (identityResolvedNow && currentAddressStatus === 'pending') {
      respuestaIA = buildForcedAddressConfirmationResponse({ valoresExcel });
      L.warn('⚠️  Identidad resuelta y dirección aún no validada — se fuerza la confirmación de dirección');
    } else if (addressRejectedWithoutCorrection) {
      respuestaIA = buildForcedAddressCorrectionResponse();
      L.warn('⚠️  Dirección rechazada sin corrección — se fuerza la petición de dirección corregida');
    } else if ((lastBotResponseType === 'peticion_ubicacion' || isLocationRequestPrompt(lastBotMessage)) && !locationCoords) {
      if (locationRequestCount < 2) {
        respuestaIA = buildForcedLocationRequestResponse();
        forceLocationRetry = true;
        L.warn('⚠️  Falta la ubicación tras la primera petición — se fuerza un único reintento');
      } else {
        forcePauseAfterReply = true;
        L.warn('⚠️  Segunda negativa a compartir ubicación — se continúa sin pedir la ubicación adicionalmente');
        respuestaIA = await requestAIResponse({
          historial,
          mensajeUsuario: text,
          contextoSistema,
          valoresExcel,
        });
      }
    } else if (attendeeConfirmedNow && !estimateAlreadyKnown) {
      respuestaIA = buildForcedAttendeeConfirmationResponse({
        valoresExcel,
        waId,
        relation: String(conversation.relacion || '').trim(),
      });
      L.warn('⚠️  Confirmación de AT. Perito detectada con acuse simple; se fuerza la pregunta de estimación sin pasar por la IA');
    } else {
      respuestaIA = await requestAIResponse({
        historial,
        mensajeUsuario: text,
        contextoSistema,
        valoresExcel,
      });
    }
    if (!respuestaIA.mensaje_para_usuario) {
      L.warn('⚠️  IA devolvió mensaje vacío — se solicita una nueva redacción');
      respuestaIA = await requestAIResponse({
        historial,
        mensajeUsuario: text,
        contextoSistema,
        valoresExcel,
        extraContext: '[SISTEMA: REINTENTO_MENSAJE_VACIO]',
      });
    }

    const locationAlreadyShared = hasSharedLocation(conversation, locationCoords);
    let responseType = String(respuestaIA.datos_extraidos?.tipo_respuesta || 'normal').trim() || 'normal';
    let hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);
    let nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos?.estado_expediente];
    let preferredSchedule = normalizeSchedulePreference(
      respuestaIA.datos_extraidos?.preferencia_horaria || conversation.horario || ''
    );
    let nextRequiredTask = detectNextRequiredTask({
      conversation,
      currentStage,
      addressStatus: effectiveAddressStatus,
      lastBotMessage,
      userText: text,
      estimateAlreadyKnown,
      extractedDigital: respuestaIA.datos_extraidos?.acepta_videollamada,
      extractedAttendeeName: respuestaIA.datos_extraidos?.nombre_contacto,
      preferredSchedule,
      locationAlreadyShared,
      locationRequestCount,
    });

    const mustForceTaskNow =
      !forceLocationRetry &&
      (
        (
          ['confirmar_direccion', 'corregir_direccion', 'pedir_ubicacion'].includes(nextRequiredTask) &&
          !doesResponseMatchTask(nextRequiredTask, {
            responseType,
            message: respuestaIA.mensaje_para_usuario,
            valoresExcel,
          })
        ) ||
        (responseType === 'peticion_ubicacion' && nextRequiredTask !== 'pedir_ubicacion')
      );

    if (mustForceTaskNow) {
      const forcedTaskResponse = buildForcedTaskResponse(nextRequiredTask, {
        valoresExcel,
        currentStage,
      });
      respuestaIA = forcedTaskResponse;
      responseType = String(respuestaIA.datos_extraidos?.tipo_respuesta || 'normal').trim() || 'normal';
      hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);
      nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos?.estado_expediente];
      L.warn(`⚠️  Tarea obligatoria forzada por backend (${nextRequiredTask})`);
    }

    // ── Neutralización determinista de cierre/resumen ─────────────────────────
    // El bot ya no puede cerrar la conversación. Si la IA intenta resumir,
    // despedirse, derivar o marcar un stage terminal, se sustituye por el
    // siguiente paso pendiente o por un acuse no terminal.
    const isLegitimateClose = isAllowedTerminalTurn({
      responseType,
    });
    const aiWantsToClose =
      isTerminalResponseType(responseType) ||
      isTerminalStage(nextStage) ||
      (hasOutgoingMessage && looksLikeClosureMessage(respuestaIA.mensaje_para_usuario));

    if (aiWantsToClose && !isLegitimateClose) {
      const fallbackAiState = getFallbackAiStateForTask(currentStage, nextRequiredTask);
      const fallbackMessage = getTaskFallbackMessage(nextRequiredTask, valoresExcel);
      const canReuseAiMessage =
        hasOutgoingMessage &&
        !looksLikeClosureMessage(respuestaIA.mensaje_para_usuario) &&
        !isTerminalResponseType(responseType);
      const safeMessage = fallbackMessage || (canReuseAiMessage ? respuestaIA.mensaje_para_usuario : TASK_FALLBACK_MESSAGES.seguimiento_abierto);

      if (safeMessage) {
        L.warn(`⚠️  Intento de cierre/resumen bloqueado (stage=${currentStage}, nextStage=${nextStage || '—'}, tarea=${nextRequiredTask}) — fallback aplicado`);
        respuestaIA = {
          mensaje_para_usuario: safeMessage,
          mensaje_entendido: true,
          datos_extraidos: {
            estado_expediente: fallbackAiState,
            tipo_respuesta: 'normal',
          },
        };
        responseType = 'normal';
        hasOutgoingMessage = true;
        nextStage = ESTADO_IA_TO_STAGE[fallbackAiState];
      }
    }

    // Protección extra: si aún detectamos un mensaje de cierre en etapas iniciales,
    // forzamos el siguiente paso pendiente en lugar de dejar que el flujo termine.
    if (
      hasOutgoingMessage &&
      looksLikeClosureMessage(respuestaIA.mensaje_para_usuario) &&
      !isLegitimateClose &&
      currentStage !== 'agendando' &&
      currentStage !== 'finalizado' &&
      currentStage !== 'escalated'
    ) {
      const forcedTaskResponse = buildForcedTaskResponse(nextRequiredTask, {
        valoresExcel,
        currentStage,
      });
      respuestaIA = forcedTaskResponse;
      responseType = String(respuestaIA.datos_extraidos?.tipo_respuesta || 'normal').trim() || 'normal';
      hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);
      nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos?.estado_expediente];
      L.warn(`⚠️  Cierre temprano detectado en etapa ${currentStage} — forzado paso obligatorio ${nextRequiredTask}`);
    }

    let aiWantsToSummarizeOrClose = isTerminalResponseType(responseType);

    L.log('🔎 Decision interno |',
      `nextRequiredTask=${nextRequiredTask}`,
      `responseType=${responseType}`,
      `nextStage=${nextStage || '—'}`,
      `hasOutgoingMessage=${hasOutgoingMessage}`,
      `aiWantsToClose=${aiWantsToClose}`,
      `mustForceTaskNow=${mustForceTaskNow}`
    );

    if (
      nextRequiredTask === 'pedir_ubicacion' &&
      !locationAlreadyShared &&
      locationRequestCount < 2 &&
      aiWantsToSummarizeOrClose &&
      responseType !== 'peticion_ubicacion'
    ) {
      const forcedLocationResponse = await requestAIResponse({
        historial,
        mensajeUsuario: text,
        contextoSistema,
        valoresExcel,
        extraContext: '[SISTEMA: FORZAR_PEDIR_UBICACION]',
      });
      if (forcedLocationResponse.mensaje_para_usuario) {
        respuestaIA = forcedLocationResponse;
        responseType = String(respuestaIA.datos_extraidos?.tipo_respuesta || 'normal').trim() || 'normal';
        hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);
        nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos?.estado_expediente];
        aiWantsToSummarizeOrClose = isTerminalResponseType(responseType);
        L.warn('⚠️  IA intentó resumir/cerrar sin pedir ubicación GPS — se fuerza una nueva respuesta');
      }
    }

    if (
      nextRequiredTask === 'pedir_ubicacion' &&
      !locationAlreadyShared &&
      locationRequestCount >= 2 &&
      aiWantsToSummarizeOrClose &&
      respuestaIA.datos_extraidos.ubicacion_pendiente !== true
    ) {
      respuestaIA.datos_extraidos.ubicacion_pendiente = true;
      L.warn('⚠️  IA omitió marcar ubicación pendiente tras dos peticiones — se corrige en backend');
    }

    if (
      identityConfirmedNow &&
      lastOutMsg &&
      lastOutMsg.text === respuestaIA.mensaje_para_usuario
    ) {
      const identityRetryResponse = await requestAIResponse({
        historial,
        mensajeUsuario: text,
        contextoSistema,
        valoresExcel,
        extraContext: '[SISTEMA: NO_REPETIR_IDENTIDAD]',
      });
      if (identityRetryResponse.mensaje_para_usuario && identityRetryResponse.mensaje_para_usuario !== lastOutMsg.text) {
        respuestaIA = identityRetryResponse;
        responseType = String(respuestaIA.datos_extraidos?.tipo_respuesta || 'normal').trim() || 'normal';
        hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);
        nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos?.estado_expediente];
        L.warn('⚠️  Bucle de identificación detectado tras "sí" del usuario — se solicita una nueva respuesta');
      }
    }

    // Si el usuario rechazó la ubicación dos veces y no quedan más tareas, cerrar con mensaje de cierre
    if (forcePauseAfterReply && nextRequiredTask === 'seguimiento_abierto') {
      respuestaIA = {
        mensaje_para_usuario: 'Entendido. Hemos registrado la información disponible sobre su siniestro. Le contactaremos próximamente para gestionar la peritación.',
        mensaje_entendido: true,
        datos_extraidos: {
          ...(respuestaIA.datos_extraidos || {}),
          estado_expediente: 'agendando',
          tipo_respuesta: 'normal',
        },
      };
      responseType = 'normal';
      hasOutgoingMessage = true;
      L.warn('⚠️  Conversación cerrada tras segunda negativa a la ubicación — mensaje de cierre enviado');
    }

    // Persistir mensajes y datos extraídos en el Excel
    if (respuestaIA.mensaje_entendido) {
      const {
        nombre_contacto,
        relacion_contacto,
        telefono_contacto,
        importe_estimado,
        acepta_videollamada,
        preferencia_horaria,
        estado_expediente,
        tipo_respuesta,
        idioma_conversacion,
        ubicacion_pendiente,
      } = respuestaIA.datos_extraidos || {};

      const excelUpdates = {
        lastBotResponseType: tipo_respuesta || 'normal',
        locationRequestCount: locationRequestCount,
        mensajes: [
          ...mensajesPrevios,
          { direction: 'in',  text, timestamp: new Date().toISOString() },
          ...(hasOutgoingMessage ? [{ direction: 'out', text: respuestaIA.mensaje_para_usuario, timestamp: new Date().toISOString() }] : []),
        ],
      };
      if (effectiveAddressStatus !== currentAddressStatus) {
        excelUpdates.addressStatus = effectiveAddressStatus;
      }
      const relacionInterlocutor = String(peritoAttendeeContext ? '' : (relationFromCurrent || relacion_contacto || '')).trim();
      if (relacionInterlocutor) {
        excelUpdates.relacion = relacionInterlocutor;
      }

      // Actualizar AT. Perito:
      // - Si el bot preguntó explícitamente por el asistente al perito → siempre actualizar.
      // - Si no (peritoAttendeeContext=false) → guardar el nombre del interlocutor como
      //   valor inicial de AT. Perito, pero SOLO si aún no hay ninguno registrado.
      //   Así el nombre se captura aunque la conversación no llegue a la fase de agendado.
      const attPeritoActual = String(conversation.attPerito || '').trim();
      const attPeritoVacio  = !attPeritoActual || attPeritoActual.startsWith('sin indicar');
      const shouldUpdateAttPerito =
        (peritoAttendeeContext && Boolean(nombre_contacto || relacion_contacto || relationFromCurrent || telefono_contacto)) ||
        (!peritoAttendeeContext && attPeritoVacio && Boolean(nombre_contacto));
      if (shouldUpdateAttPerito) {
        const [exNombre = '', exRelacion = '', exTelefono = ''] = attPeritoActual.split(' - ');
        const nombreAtt = String(nombre_contacto || '').trim() || (exNombre !== 'sin indicar' ? exNombre : '') || 'sin indicar';
        const relacionAtt = String(relacion_contacto || relationFromCurrent || '').trim() || (exRelacion !== 'sin indicar' ? exRelacion : '') || 'sin indicar';
        const telefonoAtt = normalizeContactPhone(telefono_contacto) || normalizeContactPhone(exTelefono) || normalizeContactPhone(waId);
        excelUpdates.attPerito = `${nombreAtt} - ${relacionAtt} - ${telefonoAtt}`;
      }
      if (idioma_conversacion && idioma_conversacion !== 'es') {
        excelUpdates.idioma = idioma_conversacion;
      }
      if (importe_estimado || estimateFromCurrent) {
        excelUpdates.danos = String(importe_estimado || estimateFromCurrent).trim();
      }
      const preferredSchedule = normalizeSchedulePreference(preferencia_horaria);
      if (preferredSchedule) excelUpdates.horario = preferredSchedule;
      if (shouldAssumeDigitalAcceptance({
        extractedDigital: acepta_videollamada,
        existingDigital: conversation.digital,
        preferredSchedule,
      })) {
        excelUpdates.digital = 'Sí';
      } else if (typeof acepta_videollamada === 'boolean') {
        excelUpdates.digital = acepta_videollamada ? 'Sí' : 'No';
      }
      // Incrementar contador si:
      // 1. Bot acaba de pedir ubicación (tipo_respuesta = 'peticion_ubicacion')
      // 2. Usuario rechaza explícitamente después de una solicitud previa
      const userRejectsLocation = (lastBotResponseType === 'peticion_ubicacion' || isLocationRequestPrompt(lastBotMessage)) && isLocationRequestRejection(text);
      if (locationCoords) {
        excelUpdates.coordenadas = locationCoords;
      } else if (userRejectsLocation && locationRequestCount >= 2 && !String(conversation.coordenadas || '').trim()) {
        excelUpdates.coordenadas = '[no proporcionado]';
      }
      if (userRejectsLocation && locationRequestCount >= 2) {
        forcePauseAfterReply = true;
      }
      if (tipo_respuesta === 'peticion_ubicacion' || userRejectsLocation) {
        excelUpdates.locationRequestCount = locationRequestCount + 1;
      } else if (locationCoords) {
        excelUpdates.locationRequestCount = 0;
      }

      // Gestión de standby de ubicación
      if (locationCoords && conversation.status === 'awaiting_location') {
        // GPS recibida mientras estaba en espera → desactivar standby
        excelUpdates.status = 'pending';
        excelUpdates.locationStandbyUntil = 0;
        excelUpdates.locationRequestCount = 0;
        L.log(`📍 Ubicación recibida — standby de ubicación desactivado`);
      } else if (ubicacion_pendiente === true && !locationCoords && conversation.status !== 'awaiting_location') {
        // Asegurado indica que enviará la ubicación más tarde → activar standby
        const standbyHoras = Number(process.env.LOCATION_STANDBY_HOURS || 48);
        excelUpdates.status = 'awaiting_location';
        excelUpdates.locationStandbyUntil = Date.now() + standbyHoras * 3600000;
        L.log(`📍 Ubicación pendiente — standby activado por ${standbyHoras}h`);
      }
      const nuevoStage = ESTADO_IA_TO_STAGE[estado_expediente];
      if (nuevoStage) {
        if (!canApplyStageTransition(currentStage, nuevoStage)) {
          L.warn(`⚠️  Transición de stage inválida ${currentStage} → ${nuevoStage}; se mantiene stage actual`);
        } else if (isTerminalStage(nuevoStage) || isTerminalResponseType(tipo_respuesta)) {
          L.warn(`⚠️  Estado terminal ignorado (${estado_expediente || '—'} / ${tipo_respuesta || '—'}) — la conversación permanece abierta`);
        } else {
          stageAplicado = nuevoStage;
          excelUpdates.stage = nuevoStage;
          L.log(`🔄 Stage ${currentStage} → ${nuevoStage}`);
        }
      }

      if (forcePauseAfterReply) {
        excelUpdates.stage = 'cerrado';
        excelUpdates.status = 'paused';
        excelUpdates.nextReminderAt = null;
        excelUpdates.locationStandbyUntil = 0;
        L.log('ℹ️  Usuario rechazó la ubicación dos veces — conversación cerrada, recordatorios desactivados');
      }

      // ── Calendario Outlook: guardar datos de cita confirmada en Excel ──
      if (CALENDAR_ENABLED) {
        const booking = getBooking(nexp);
        if (booking?.status === 'confirmed' && booking.slotStart) {
          const slotDate = new Date(booking.slotStart);
          excelUpdates.citaFecha     = slotDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
          excelUpdates.citaHora      = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}`;
          excelUpdates.citaOutlookId = booking.outlookEventId || '';
        }
      }

      await conversationManager.createOrUpdateConversation(waId, excelUpdates);

      // Primera respuesta del usuario → asignar perito + marcar contacto en PeritoLine
      if (isFirstResponse) {
        await conversationManager.createOrUpdateConversation(waId, { contacto: 'Sí' });
        triggerEncargoSync(nexp, 'primera_respuesta');
        L.log(`🔗 Primera respuesta → sync PeritoLine iniciado (asignar perito + contacto)`);
      }
    }

    // ── Enviar respuesta ─────────────────────────────────────────────────
    const respPreview = (respuestaIA.mensaje_para_usuario || '').slice(0, 80);
    L.log(`🤖 IA [${respuestaIA.datos_extraidos?.estado_expediente || '?'}]: "${respPreview}${respPreview.length < (respuestaIA.mensaje_para_usuario || '').length ? '…' : ''}"`);

    // Última protección contra cierres prematuros. Si aún tenemos un mensaje de
    // cierre y no estamos en un stage terminal, lo reemplazamos por una respuesta
    // abierta segura antes de enviarlo.
    if (
      hasOutgoingMessage &&
      looksLikeClosureMessage(respuestaIA.mensaje_para_usuario) &&
      !isLegitimateClose &&
      !isTerminalStage(currentStage) &&
      currentStage !== 'finalizado' &&
      currentStage !== 'escalated'
    ) {
      const overrideMessage = getTaskFallbackMessage(nextRequiredTask, valoresExcel) || TASK_FALLBACK_MESSAGES.seguimiento_abierto;
      L.warn(`⚠️  Cierre prematuro detectado justo antes de enviar — override aplicado: ${overrideMessage}`);
      respuestaIA.mensaje_para_usuario = overrideMessage;
      respuestaIA.datos_extraidos = {
        estado_expediente: getFallbackAiStateForTask(currentStage, nextRequiredTask),
        tipo_respuesta: 'normal',
      };
      responseType = 'normal';
      nextStage = ESTADO_IA_TO_STAGE[respuestaIA.datos_extraidos.estado_expediente];
    }

    // Anti-duplicado de salida: si el bot acaba de enviar ese mismo texto
    // en los últimos 60 s, lo registramos en log pero lo enviamos igualmente
    // para no dejar la conversación en silencio.
    const RESP_DEDUP_MS = 60 * 1000;
    if (
      hasOutgoingMessage &&
      lastOutMsg &&
      lastOutMsg.text === respuestaIA.mensaje_para_usuario &&
      Date.now() - new Date(lastOutMsg.timestamp).getTime() < RESP_DEDUP_MS
    ) {
      L.warn(`⚠️  Respuesta idéntica al mensaje previo (<60s) — se envía igualmente para evitar silencio`);
    }

    if (hasOutgoingMessage) {
      const result = await adapter.sendText(waId, respuestaIA.mensaje_para_usuario);
      L.log(`✅ Enviado (msgId: ${result?.messageId}) | entendido=${respuestaIA.mensaje_entendido}`);
      await conversationManager.recordResponse(waId);
    } else {
      L.warn('⚠️  La IA no devolvió un mensaje saliente y no se envía texto desde código');
    }

  } catch (error) {
    const nexpCtx = (await conversationManager.getNexpByWaId(waId)) || waId;
    console.error(`[${nexpCtx}] ❌ Error crítico en processMessage:`, error);
    fileLogger.writeLog(nexpCtx, 'ERROR', `Error crítico en processMessage: ${error?.stack || error?.message || error}`);
  }
}

module.exports = {
  processMessage,
  // Exportadas para tests unitarios
  _test: {
    detectEconomicEstimate,
    hasSharedLocation,
    normalizeContactPhone,
    isAffirmativeAck,
    isNegativeAck,
    isConsentPrompt,
    isAddressConfirmationPrompt,
    isAddressCorrectionPrompt,
    isPlainAddressRejection,
    hasMeaningfulAddressCorrection,
    isExplicitHumanEscalationIntent,
    canApplyStageTransition,
    getNonTerminalAiStateForStage,
    extractRelationship,
    analyzeAddressType,
    normalizeSchedulePreference,
    shouldAssumeDigitalAcceptance,
    shouldBlockEarlyTerminalStage,
    hasMeaningfulAttendee,
    detectNextRequiredTask,
    looksLikeClosureMessage,
    isAllowedTerminalTurn,
    getFallbackAiStateForTask,
    buildSummaryFallbackMessage,
    buildForcedConsentConfirmationResponse,
    buildForcedAddressConfirmationResponse,
    buildForcedAddressCorrectionResponse,
    buildForcedAttendeeConfirmationResponse,
    buildForcedLocationClosureResponse,
  },
};
