// src/bot/reminderScheduler.js — Scheduler unificado
//
// Regla de negocio: la conversación queda siempre abierta.
// La columna "Contacto" del Excel es la fuente de verdad:
//   - Vacío    → pendiente de contactar (sendInitialMessage.js se encarga)
//   - "En curso" → ya contactado, conversación activa
//   - "Sí"     → ya hubo interacción con el asegurado
//
// Gestiona dos escenarios:
//
//  A) SIN respuesta al primer mensaje (lastUserMessageAt = null)
//     → Cuando expira el timer, detiene los recordatorios automáticos sin
//       cerrar la conversación ni enviar mensajes adicionales.
//
//  B) INACTIVIDAD a mitad de conversación (lastUserMessageAt existe pero el
//     usuario lleva demasiado tiempo sin escribir)
//     → Envía mensajes de inactividad generados por IA cada
//       INACTIVITY_INTERVAL_MINUTES, hasta INACTIVITY_MAX_ATTEMPTS veces.
//       Tras agotar los intentos, pausa los recordatorios sin cerrar.
//
//  Los mensajes solo se envían dentro del horario L-V BUSINESS_HOURS_START–BUSINESS_HOURS_END.
//  La limpieza del Excel se ejecuta en cada ciclo independientemente del horario.

require('dotenv').config();
const conversationManager = require('./conversationManager');
const adapter             = require('../channels/whatsappAdapter');
const { isBusinessHours, cleanOldRows } = require('../utils/excelManager');
const { procesarConIA }   = require('../ai/aiModel');
const { cleanOldPdfs, cleanOldDebugLogs } = require('../utils/pdfGenerator');
const fileLogger          = require('../utils/fileLogger');

const CHECK_MINUTES           = Number(process.env.SCHEDULER_CHECK_MINUTES         || 15);
const INACTIVITY_MINUTES      = Number(process.env.INACTIVITY_INTERVAL_MINUTES     || process.env.INACTIVITY_INTERVAL_HOURS * 60  || 120);
const INACTIVITY_MAX          = Number(process.env.INACTIVITY_MAX_ATTEMPTS         || 3);
const LOCATION_STANDBY_HOURS  = Number(process.env.LOCATION_STANDBY_HOURS          || 48);

const INACTIVITY_MS = INACTIVITY_MINUTES * 60000;
const BH_START      = Number(process.env.BUSINESS_HOURS_START || 9);

let _timer = null;

/**
 * Calcula el timestamp de inicio del próximo período laboral (L-V, BH_START:00).
 * Si ahora es un día laborable antes de la hora de apertura, devuelve hoy a BH_START:00.
 * En cualquier otro caso (tarde, finde), devuelve el próximo día laborable a BH_START:00.
 */
function nextBusinessHoursStart() {
  const d = new Date();
  const day = d.getDay(); // 0=dom, 6=sab
  const hour = d.getHours();

  if (day >= 1 && day <= 5 && hour < BH_START) {
    // Hoy mismo, antes de abrir
    d.setHours(BH_START, 0, 0, 0);
    return d.getTime();
  }

  // Siguiente día laborable
  d.setDate(d.getDate() + 1);
  d.setHours(BH_START, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

// ── Lógica de comprobación ────────────────────────────────────────────────────

async function runChecks() {
  // Limpieza del Excel, PDFs y debug logs (sin restricción de horario)
  cleanOldRows();
  cleanOldPdfs();
  cleanOldDebugLogs();

  const now           = Date.now();
  const enHorario     = isBusinessHours();
  const conversaciones = (await conversationManager.getAllConversations())
    .filter(c => c.status === 'pending' || c.status === 'awaiting_location');

  for (const conv of conversaciones) {
    const { waId, nexp } = conv;
    if (!waId || !nexp) continue;

    // ── Escenario C: standby de ubicación pendiente ───────────────────────
    if (conv.status === 'awaiting_location') {
      if (conv.coordenadas) {
        // La ubicación ya llegó por otro canal (coords guardadas), solo limpiar el flag
        await conversationManager.createOrUpdateConversation(waId, { status: 'pending', locationStandbyUntil: 0 });
        console.log(`📍 Standby ubicación resuelto (coordenadas ya recibidas): nexp=${nexp}`);
      } else if (!conv.locationStandbyUntil || conv.locationStandbyUntil <= now) {
        await handleLocationStandbyExpired(conv);
      }
      continue; // nunca aplicar lógica A/B a estas conversaciones
    }

    // nextReminderAt aún no ha llegado
    if (conv.nextReminderAt && conv.nextReminderAt > now) continue;

    if (!enHorario) {
      // El timer ya venció pero estamos fuera de horario: posponer al inicio
      // del próximo período laboral para no acumular "deuda" de tiempo.
      await conversationManager.createOrUpdateConversation(waId, {
        nextReminderAt: nextBusinessHoursStart(),
      });
      continue;
    }

    const usuarioRespondio = Boolean(conv.lastUserMessageAt);

    if (!usuarioRespondio) {
      // ── Escenario A: sin respuesta al primer mensaje ──────────────────────
      await pausarSeguimiento(waId, nexp, 'sin_respuesta_inicial');
    } else {
      // ── Escenario B: inactividad a mitad de conversación ──────────────────
      await handleInactivity(conv, now);
    }
  }
}

async function pausarSeguimiento(waId, nexp, motivo, extraPatch = {}) {
  try {
    await conversationManager.createOrUpdateConversation(waId, {
      status:          'paused',
      nextReminderAt:  null,
      locationStandbyUntil: 0,
      ...extraPatch,
    });
    console.log(`⏸️ Seguimiento automático pausado (${motivo}): nexp=${nexp}`);
    fileLogger.writeLog(nexp, 'INFO', `Seguimiento pausado (${motivo}) waId=${waId}`);
  } catch (err) {
    console.error(`❌ Error pausando seguimiento ${waId}:`, err.message);
    fileLogger.writeLog(nexp, 'ERROR', `Error pausando seguimiento waId=${waId}: ${err.message}`);
  }
}

async function handleInactivity(conv, now) {
  const { waId, nexp } = conv;
  const intentos = conv.inactivityAttempts || 0;

  if (intentos >= INACTIVITY_MAX) {
    await pausarSeguimiento(waId, nexp, 'inactividad_maxima', {
      inactivityAttempts: intentos,
      lastReminderAt: now,
    });
    return;
  }

  const siguiente = intentos + 1;
  console.log(`💤 Inactividad ${siguiente}/${INACTIVITY_MAX} → nexp=${nexp}`);

  try {
    // Generar mensaje de inactividad con la IA
    const userData = conv.userData || {};
    const mensajesPrevios = await conversationManager.getMensajes(waId);
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

    const respuestaIA = await procesarConIA(historial, '[SISTEMA: INACTIVIDAD]', '', valoresExcel);
    const msgInactividad = respuestaIA.mensaje_para_usuario;

    await adapter.sendText(waId, msgInactividad);

    // Guardar el mensaje en el historial
    await conversationManager.saveMensajes(waId, [
      ...mensajesPrevios,
      { direction: 'out', text: msgInactividad, timestamp: new Date().toISOString() },
    ]);

    await conversationManager.createOrUpdateConversation(waId, {
      inactivityAttempts: siguiente,
      lastReminderAt:     now,
      nextReminderAt:     now + INACTIVITY_MS,
    });
    console.log(`✅ Mensaje de inactividad enviado (${siguiente}/${INACTIVITY_MAX}): "${msgInactividad}"`);
    if (siguiente >= INACTIVITY_MAX) {
      await pausarSeguimiento(waId, nexp, 'inactividad_maxima', {
        inactivityAttempts: siguiente,
        lastReminderAt: now,
      });
    }
  } catch (err) {
    console.error(`❌ Error enviando inactividad ${waId}:`, err.message);
    fileLogger.writeLog(nexp, 'ERROR', `Error enviando inactividad waId=${waId}: ${err.message}`);
  }
}

async function handleLocationStandbyExpired(conv) {
  const { waId, nexp } = conv;
  try {
    const mensajes    = await conversationManager.getMensajes(waId);
    const userData    = conv?.userData || {};
    const historial = mensajes.map(m => ({
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
    const respuestaIA = await procesarConIA(historial, '[SISTEMA: UBICACION_STANDBY_EXPIRADA]', '', valoresExcel);
    const msgRecordatorio = String(respuestaIA?.mensaje_para_usuario || '').trim();
    if (msgRecordatorio) {
      await adapter.sendText(waId, msgRecordatorio);
    }

    const mensajesActualizados = [
      ...mensajes,
      ...(msgRecordatorio ? [{ direction: 'out', text: msgRecordatorio, timestamp: new Date().toISOString() }] : []),
    ];
    await pausarSeguimiento(waId, nexp, 'ubicacion_standby_expirada', {
      mensajes: mensajesActualizados,
      lastReminderAt: Date.now(),
    });

    console.log(`📍 Standby ubicación expirado (${LOCATION_STANDBY_HOURS}h): nexp=${nexp}`);
    fileLogger.writeLog(nexp, 'INFO', `Standby ubicación expirado waId=${waId}`);
  } catch (err) {
    console.error(`❌ Error en standby ubicación ${waId}:`, err.message);
    fileLogger.writeLog(nexp, 'ERROR', `Error standby ubicación waId=${waId}: ${err.message}`);
  }
}

// ── Arranque / parada ─────────────────────────────────────────────────────────

function startScheduler() {
  if (_timer) {
    console.log('⚠️  Scheduler ya está corriendo');
    return;
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           SCHEDULER UNIFICADO INICIADO                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`   ⏱️  Verificación cada: ${CHECK_MINUTES} min`);
  console.log(`   📩 Sin respuesta:   pausa recordatorios sin cerrar`);
  console.log(`   💤 Inactividad:     aviso cada ${INACTIVITY_MINUTES}min × ${INACTIVITY_MAX} veces`);
  console.log(`   📍 Standby ubic.:   recordatorio y pausa a las ${LOCATION_STANDBY_HOURS}h sin GPS`);
  console.log(`   🕐 Envíos: L-V ${process.env.BUSINESS_HOURS_START || 9}:00–${process.env.BUSINESS_HOURS_END || 20}:00\n`);

  runChecks().catch(e => console.error('❌ Error en verificación inicial:', e.message));

  _timer = setInterval(() => {
    runChecks().catch(e => console.error('❌ Error en scheduler:', e.message));
  }, CHECK_MINUTES * 60000);

  console.log('✅ Scheduler configurado\n');
}

function stopScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startScheduler, stopScheduler, runChecks, _test: { nextBusinessHoursStart } };
