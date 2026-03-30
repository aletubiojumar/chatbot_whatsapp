// src/bot/messageHandler.js
const conversationManager = require('./conversationManager');
const { procesarConIA, translateMessagesToSpanish } = require('../ai/aiModel');
const adapter             = require('../channels/whatsappAdapter');
const { canProcess }      = require('./stateMachine');
const { triggerEncargoSync } = require('./peritolineAutoSync');
const { generateConversationPdf } = require('../utils/pdfGenerator');
const { buildInitialTemplateText } = require('./templateSender');
const fileLogger          = require('../utils/fileLogger');
const axios = require('axios');

// Mapeo entre los valores que devuelve la IA y los stages internos
const ESTADO_IA_TO_STAGE = {
  finalizado:      'finalizado',
  escalado_humano: 'escalated',
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

function isAffirmativeAck(text) {
  const t = String(text || '').trim().toLowerCase();
  return /^(si|sí|ok|vale|perfecto|correcto|todo ok|todo correcto|de acuerdo|confirmado)$/.test(t);
}

function isNegativeAck(text) {
  const t = norm(text);
  return /^(no|nop|negativo|mejor no|prefiero no|no quiero|no deseo continuar|no acepto|rechazo)$/.test(t);
}

function isExplicitHumanEscalationIntent(text) {
  const t = norm(text);
  return (
    t.includes('hablar con una persona') ||
    t.includes('hablar con alguien') ||
    t.includes('persona real') ||
    t.includes('atencion humana') ||
    t.includes('atencion telefonica') ||
    t.includes('que me llamen') ||
    t.includes('que me llame') ||
    t.includes('prefiero que me llamen') ||
    t.includes('prefiero hablar con') ||
    t.includes('quiero hablar con') ||
    t.includes('quiero que me llamen') ||
    t.includes('llamadme') ||
    t.includes('llamame') ||
    t.includes('llamenme') ||
    (t.includes('humano')) ||
    (t.includes('agente')) ||
    (t.includes('operador')) ||
    (t.includes('por telefono') && !isAffirmativeAck(text))
  );
}

function shouldBlockEarlyTerminalStage({ currentStage, nextStage, userText, hasOutgoingMessage }) {
  if (!hasOutgoingMessage) return false;
  if (!['consent', 'identification'].includes(String(currentStage || '').trim())) return false;
  if (nextStage === 'finalizado') return true;
  if (nextStage !== 'escalated') return false;
  if (currentStage === 'consent' && isNegativeAck(userText)) return false;
  if (isExplicitHumanEscalationIntent(userText)) return false;
  return true;
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

function normalizeSchedulePreference(preferencia) {
  const pref = norm(preferencia);
  if (pref === 'manana') return 'Mañana';
  if (pref === 'tarde') return 'Tarde';
  return '';
}

function shouldAssumeDigitalAcceptance({ extractedDigital, existingDigital, preferredSchedule }) {
  if (!preferredSchedule) return false;
  if (typeof extractedDigital === 'boolean') return extractedDigital;
  return String(existingDigital || '').trim().toLowerCase() !== 'no';
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

function buildAIConversationContext(conversation, nexp) {
  const userData = conversation?.userData || {};
  let mensajesPrevios = conversationManager.getMensajes(conversation?.waId);

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
    const nexp = conversationManager.getNexpByWaId(waId);
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
    const conversation = conversationManager.getConversation(waId);
    const stateCheck = canProcess(conversation);
    if (!stateCheck.ok) {
      L.log(`⛔ Bloqueado (${stateCheck.reason}) stage=${conversation?.stage}`);
      if (stateCheck.aiBehavior === 'reply_once_then_close') {
        const { mensajesPrevios, historial, valoresExcel } = buildAIConversationContext(conversation, nexp);
        const terminalMarker = conversation?.stage === 'finalizado'
          ? '[SISTEMA: TERMINAL_FINALIZADO]'
          : '[SISTEMA: TERMINAL_ESCALADO]';
        const respuestaTerminal = await requestAIResponse({
          historial,
          mensajeUsuario: text,
          contextoSistema: terminalMarker,
          valoresExcel,
        });
        const terminalMessage = respuestaTerminal.mensaje_para_usuario;
        const terminalUpdates = {
          stage: 'cerrado',
          lastBotResponseType: 'cierre_definitivo',
          ...(conversation?.status === 'escalated' ? { status: 'pending' } : {}),
        };

        if (terminalMessage) {
          await adapter.sendText(waId, terminalMessage);
          terminalUpdates.mensajes = [
            ...mensajesPrevios,
            { direction: 'in',  text,            timestamp: new Date().toISOString() },
            { direction: 'out', text: terminalMessage, timestamp: new Date().toISOString() },
          ];
          conversationManager.recordResponse(waId);
        }

        conversationManager.createOrUpdateConversation(waId, terminalUpdates);
      }
      // Guardar coordenadas aunque la conversación esté cerrada y sincronizar PeritoLine
      if (locationCoords) {
        const lateUpdate = { coordenadas: locationCoords };
        if (conversation.status === 'awaiting_location') {
          lateUpdate.status = 'pending'; // desactivar standby al recibir la ubicación
          lateUpdate.locationStandbyUntil = 0;
        }
        conversationManager.createOrUpdateConversation(waId, lateUpdate);
        triggerEncargoSync(nexp, 'coordenadas_tardias', '', false, true);
        L.log(`📍 Coordenadas recibidas en stage terminal, guardadas y sync disparado: ${locationCoords}`);
      }
      return;
    }

    // Detectar primera respuesta ANTES de registrar actividad
    const isFirstResponse = !conversation.lastUserMessageAt;

    // Registrar actividad (resetea inactivityAttempts y nextReminderAt)
    conversationManager.recordUserMessage(waId);

    // Leer datos del siniestro y mensajes desde Excel
    const {
      userData,
      mensajesPrevios,
      historial,
      valoresExcel,
    } = buildAIConversationContext(conversation, nexp);

    const lastOutMsg      = [...mensajesPrevios].reverse().find(m => m?.direction === 'out') || null;
    const lastBotMessage  = lastOutMsg?.text || '';
    const lastBotResponseType = String(conversation.lastBotResponseType || '').trim();
    const locationRequestCount = Number(conversation.locationRequestCount || 0);
    const relationFromCurrent = extractRelationship(text);
    const peritoAttendeeContext = isPeritoAttendeePrompt(lastBotMessage) || isPeritoAttendeeMentionInUser(text);
    const identityConfirmedNow = lastBotResponseType === 'pregunta_identidad' && isAffirmativeAck(text);
    const relationAlreadyKnown = Boolean(
      (!peritoAttendeeContext && relationFromCurrent) ||
      (conversation.relacion && String(conversation.relacion).trim())
    );
    const estimateFromCurrent = detectEconomicEstimate(text);
    const estimateAlreadyKnown = Boolean((conversation.danos && String(conversation.danos).trim()) || estimateFromCurrent);

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

    //contextoSistema += '\n[Videoperitación]: Si el usuario no expresa dudas, no expliques funcionamiento; pregunta disponibilidad directa (mañana/tarde).';
    contextoSistema += '\n[CIERRE SIN CALENDARIO]: No hay agenda automática. Si el asegurado acepta la videoperitación e indica preferencia horaria (mañana o tarde), confirma que el equipo gestionará la cita con esa preferencia y emite un mensaje final. Marca estado_expediente="finalizado" y tipo_respuesta="cierre_definitivo".';

    // Estado de espera de ubicación
    if (conversation.status === 'awaiting_location') {
      if (locationCoords) {
        contextoSistema += '\n[UBICACIÓN RECIBIDA]: El asegurado acaba de enviar su ubicación GPS. Acéptala y procede directamente con el resumen final de datos para concluir la conversación.';
      } else {
        contextoSistema += '\n[UBICACIÓN PENDIENTE]: La conversación está pendiente de recibir la ubicación del riesgo. El asegurado indicó que la enviaría más tarde. Si ahora escribe sin enviar GPS, responde brevemente y recuérdale que puede compartir la ubicación cuando quiera.';
      }
    }

    // Reintento de petición de ubicación si el asegurado la ignoró
    if (!locationCoords && conversation.status !== 'awaiting_location' && lastBotResponseType === 'peticion_ubicacion') {
      if (locationRequestCount < 2) {
        contextoSistema += '\n[UBICACIÓN IGNORADA – REINTENTAR]: El asegurado ha respondido sin enviar la ubicación GPS. Vuelve a pedirla con el mismo mensaje exacto antes de continuar con el resumen.';
      } else {
        contextoSistema += '\n[UBICACIÓN IGNORADA – SEGUNDA VEZ]: El asegurado ha ignorado la petición de ubicación en dos ocasiones. Continúa con el resumen sin pedirla más e incluye «ubicacion_pendiente»: true en datos_extraidos.';
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
    if (lastBotResponseType === 'resumen_final' && isAffirmativeAck(text)) {
      contextoSistema += '\n[CONFIRMACIÓN RESUMEN]: El usuario confirma que los datos están correctos. Envía despedida final y marca estado_expediente="finalizado".';
    }
    if (identityConfirmedNow) {
      contextoSistema += '\n[CONFIRMACIÓN IDENTIDAD]: El usuario responde afirmativamente a tu pregunta de identidad/relación. Da la identificación por confirmada y avanza al siguiente dato pendiente. PROHIBIDO repetir la misma pregunta de identidad.';
    }

    // ── Llamada a la IA ──────────────────────────────────────────────────
    let respuestaIA = await requestAIResponse({
      historial,
      mensajeUsuario: text,
      contextoSistema,
      valoresExcel,
    });
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
    const aiWantsToSummarizeOrClose =
      responseType === 'resumen_final' ||
      responseType === 'cierre_definitivo';

    if (
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
        L.warn('⚠️  IA intentó resumir/cerrar sin pedir ubicación GPS — se fuerza una nueva respuesta');
      }
    }

    if (
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
        L.warn('⚠️  Bucle de identificación detectado tras "sí" del usuario — se solicita una nueva respuesta');
      }
    }

    L.log(`🧠 IA datos_extraidos: ${JSON.stringify(respuestaIA.datos_extraidos || {})}`);
    L.log(`🧠 IA tipo=${responseType} estado=${String(respuestaIA.datos_extraidos?.estado_expediente || '').trim()}`);

    const hasOutgoingMessage = Boolean(respuestaIA.mensaje_para_usuario);

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
      if (typeof acepta_videollamada === 'boolean') {
        excelUpdates.digital = acepta_videollamada ? 'Sí' : 'No';
      }
      const horarioPreferido = normalizeSchedulePreference(preferencia_horaria);
      if (horarioPreferido) {
        excelUpdates.horario = horarioPreferido;
        if (shouldAssumeDigitalAcceptance({
          extractedDigital: acepta_videollamada,
          existingDigital: conversation.digital,
          preferredSchedule: horarioPreferido,
        })) {
          excelUpdates.digital = 'Sí';
        }
      }
      if (locationCoords) excelUpdates.coordenadas = locationCoords;
      if (tipo_respuesta === 'peticion_ubicacion') {
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
        if (!hasOutgoingMessage && nuevoStage === 'escalated') {
          stageAplicado = nuevoStage;
          excelUpdates.stage = nuevoStage;
          excelUpdates.contacto = 'Sí';
          L.warn('⚠️  La conversación se marca como escalada sin mensaje saliente por indisponibilidad de modelos');
        } else if (shouldBlockEarlyTerminalStage({
          currentStage: conversation.stage,
          nextStage: nuevoStage,
          userText: text,
          hasOutgoingMessage,
        })) {
          L.warn(`⚠️  Cierre terminal bloqueado por backend en stage temprano (${conversation.stage})`);
        } else if ((nuevoStage === 'finalizado' || nuevoStage === 'escalated') && tipo_respuesta !== 'cierre_definitivo') {
          L.warn(`⚠️  IA marcó "${estado_expediente}" sin mensaje terminal explícito; no se cierra aún`);
        } else {
          stageAplicado = nuevoStage;
          excelUpdates.stage = nuevoStage;
          excelUpdates.contacto = 'Sí'; // Conversación terminada con el asegurado
          L.log(`🔄 Stage → ${nuevoStage}`);
        }
      }

      conversationManager.createOrUpdateConversation(waId, excelUpdates);

      // Primera respuesta del usuario → asignar perito + marcar contacto en PeritoLine
      if (isFirstResponse) {
        conversationManager.createOrUpdateConversation(waId, { contacto: 'Sí' });
        triggerEncargoSync(nexp, 'primera_respuesta');
        L.log(`🔗 Primera respuesta → sync PeritoLine iniciado (asignar perito + contacto)`);
      }

      // Disparo al cerrar conversación (principalmente para subir PDF).
      // Nota: incluye isFirstResponse para casos donde la primera respuesta ya causa escalado/finalizado.
      if (excelUpdates.contacto === 'Sí' && (stageAplicado === 'finalizado' || stageAplicado === 'escalated')) {
        const digitalVal = excelUpdates.digital || conversation.digital;
        const horarioVal = String(excelUpdates.horario || conversation.horario || '').trim().toLowerCase();
        let horarioLabel = '';
        if (horarioVal.includes('mañana') || horarioVal.includes('manana')) horarioLabel = 'Mañana';
        else if (horarioVal.includes('tarde')) horarioLabel = 'Tarde';
        let anotacion;
        if (stageAplicado === 'escalated') {
          anotacion = '[IA] Solicita llamada';
        } else if (digitalVal === 'Sí') {
          anotacion = horarioLabel ? `[IA] Digital: Sí (${horarioLabel})` : '[IA] Digital: Sí';
        } else if (digitalVal === 'No') {
          anotacion = '[IA] Digital: Rechaza';
        } else {
          anotacion = '[IA] Digital: sin determinar';
        }
        triggerEncargoSync(nexp, `stage_${stageAplicado}`, anotacion, false, true);
      }

      // Generar PDF de transcripción al finalizar la conversación
      if (stageAplicado === 'finalizado' || stageAplicado === 'escalated') {
        const allMsgs = excelUpdates.mensajes || conversationManager.getMensajes(waId);
        const pdfExtra = {
          stage:     stageAplicado,
          contacto:  excelUpdates.contacto,
          attPerito: conversation.attPerito,
          danos:     conversation.danos     || excelUpdates.danos,
          digital:   conversation.digital   || excelUpdates.digital,
          horario:   conversation.horario   || excelUpdates.horario,
        };

        generateConversationPdf(nexp, userData, allMsgs, pdfExtra)
          .catch(e => {
            console.error(`❌ Error generando PDF nexp=${nexp}:`, e.message);
            FL.error(`Error generando PDF: ${e.message}`);
          });

        // PDF traducido al español si la conversación fue en otro idioma
        const idioma = excelUpdates.idioma || conversation.idioma;
        if (idioma && idioma !== 'es') {
          translateMessagesToSpanish(allMsgs, idioma)
            .then(translated => generateConversationPdf(nexp, userData, translated, {
              ...pdfExtra,
              filename: `conversation_${nexp}_español.pdf`,
              translatedFrom: idioma,
            }))
            .catch(e => {
              console.error(`❌ Error generando PDF traducido nexp=${nexp}:`, e.message);
              FL.error(`Error generando PDF traducido: ${e.message}`);
            });
        }
      }
    }

    // ── Enviar respuesta ─────────────────────────────────────────────────
    const respPreview = (respuestaIA.mensaje_para_usuario || '').slice(0, 80);
    L.log(`🤖 IA [${respuestaIA.datos_extraidos?.estado_expediente || '?'}]: "${respPreview}${respPreview.length < (respuestaIA.mensaje_para_usuario || '').length ? '…' : ''}"`);
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
      conversationManager.recordResponse(waId);
    } else {
      L.warn('⚠️  La IA no devolvió un mensaje saliente y no se envía texto desde código');
    }

    // No cerramos aquí: stage "finalizado" permite una última respuesta segura
    // si el usuario vuelve a escribir. El paso a "cerrado" se hace en canProcess.

  } catch (error) {
    const nexpCtx = conversationManager.getNexpByWaId(waId) || waId;
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
    isExplicitHumanEscalationIntent,
    extractRelationship,
    analyzeAddressType,
    normalizeSchedulePreference,
    shouldAssumeDigitalAcceptance,
    shouldBlockEarlyTerminalStage,
  },
};
