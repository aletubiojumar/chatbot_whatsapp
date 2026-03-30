// src/calendar/outlookCalendar.js
// Operaciones sobre el calendario compartido de Outlook via Microsoft Graph API.
//
// Cada evento se crea en DOS sitios:
//   1. Calendario central de administración (OUTLOOK_CALENDAR_USER / OUTLOOK_CALENDAR_NAME)
//   2. Calendario personal del perito asignado (añadido como attendee — Outlook lo refleja automáticamente)
//
// Variables de entorno:
//   OUTLOOK_CALENDAR_USER  — email del buzón que contiene el calendario de administración
//                            (ej: videoperitaciones@jumar.com)
//   OUTLOOK_CALENDAR_NAME  — nombre del calendario (default: "Videoperitaciones y TTR")

const axios = require('axios');
const { getAccessToken, invalidateToken } = require('./graphAuth');

const GRAPH_BASE     = 'https://graph.microsoft.com/v1.0';
const CALENDAR_USER  = () => (process.env.OUTLOOK_CALENDAR_USER || '').trim();
const CALENDAR_NAME  = () => (process.env.OUTLOOK_CALENDAR_NAME || 'Videoperitaciones y TTR').trim();

// Cache del ID del calendario (evita listar calendarios en cada llamada)
let _calendarId   = null;
let _calendarUser = null;

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

async function _graphRequest(method, path, params = null, body = null) {
  const token = await getAccessToken();
  const config = {
    method,
    url: `${GRAPH_BASE}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  };
  if (params) config.params = params;
  if (body)   config.data   = body;

  try {
    const res = await axios(config);
    return res.data;
  } catch (err) {
    // Renovar token y reintentar una vez ante 401
    if (err.response?.status === 401) {
      invalidateToken();
      const token2 = await getAccessToken();
      config.headers.Authorization = `Bearer ${token2}`;
      const res2 = await axios(config);
      return res2.data;
    }
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`[Graph] ${method} ${path} → ${err.response?.status || ''} ${msg}`);
  }
}

// ── Resolución del calendario ─────────────────────────────────────────────────

/**
 * Obtiene (con caché) el ID del calendario configurado en OUTLOOK_CALENDAR_NAME.
 * Invalida caché si el usuario configurado cambia.
 */
async function getCalendarId() {
  const user = CALENDAR_USER();
  if (!user) throw new Error('OUTLOOK_CALENDAR_USER no configurado en .env');

  if (_calendarId && _calendarUser === user) return _calendarId;

  const data = await _graphRequest('GET', `/users/${user}/calendars`, {
    $select: 'id,name',
    $top:    50,
  });

  const name = CALENDAR_NAME();
  const cal  = (data.value || []).find(c => c.name === name);
  if (!cal) {
    const available = (data.value || []).map(c => `"${c.name}"`).join(', ');
    throw new Error(
      `Calendario "${name}" no encontrado en ${user}. ` +
      `Calendarios disponibles: ${available || '(ninguno)'}`
    );
  }

  _calendarId   = cal.id;
  _calendarUser = user;
  console.log(`📅 [Graph] Calendario "${name}" resuelto (id: ${_calendarId.slice(0, 20)}…)`);
  return _calendarId;
}

// ── Consulta de eventos ───────────────────────────────────────────────────────

/**
 * Devuelve los eventos del calendario en el rango [startDt, endDt].
 * Usa calendarView para incluir eventos recurrentes correctamente.
 *
 * @param {Date} startDt
 * @param {Date} endDt
 * @returns {Promise<Array>}
 */
async function getEventsForRange(startDt, endDt) {
  const user  = CALENDAR_USER();
  const calId = await getCalendarId();

  const data = await _graphRequest(
    'GET',
    `/users/${user}/calendars/${calId}/calendarView`,
    {
      startDateTime: startDt.toISOString(),
      endDateTime:   endDt.toISOString(),
      $select:       'id,subject,start,end,isCancelled',
      $top:          200,
      $orderby:      'start/dateTime',
    }
  );

  // Filtrar eventos cancelados
  return (data.value || []).filter(e => !e.isCancelled);
}

// ── Creación de evento ────────────────────────────────────────────────────────

/**
 * Crea un evento de videoperitación en el calendario compartido de administración
 * y añade al perito como attendee (lo que hace que aparezca también en su Outlook).
 *
 * @param {object} opts
 *   nexp          {string} — número de expediente
 *   slot          {object} — { start: Date }
 *   peritoEmail   {string} — email del perito (attendee obligatorio)
 *   peritoName    {string} — nombre del perito
 *   attName       {string} — nombre del asegurado/contacto
 *   attPhone      {string} — teléfono de contacto
 * @returns {Promise<object>} evento creado (incluye id)
 */
async function createCalendarEvent({ nexp, slot, peritoEmail, peritoName, attName, attPhone }) {
  const user  = CALENDAR_USER();
  const calId = await getCalendarId();

  const start = new Date(slot.start);
  const end   = new Date(start.getTime() + 60 * 60 * 1_000); // +1h

  // Formato del título: VIDEOPERITACIÓN – EXP 880337292 – JUEVES 03/04 10:00
  const dayLabel  = start.toLocaleDateString('es-ES', {
    weekday: 'long', day: '2-digit', month: '2-digit',
  }).toUpperCase();
  const timeLabel = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const subject   = `VIDEOPERITACIÓN – EXP ${nexp} – ${dayLabel} ${timeLabel}`;

  // Perito como attendee → el evento aparece en su Outlook automáticamente
  const attendees = [];
  if (peritoEmail) {
    attendees.push({
      emailAddress: { address: peritoEmail, name: peritoName || 'Perito' },
      type: 'required',
    });
  }

  const bodyContent =
    `Videoperitación automatizada — Expediente ${nexp}\n\n` +
    `Contacto en la intervención:\n` +
    `• Nombre: ${attName  || 'sin indicar'}\n` +
    `• Teléfono: ${attPhone || 'sin indicar'}\n\n` +
    `Generado automáticamente por Bot Pericial Jumar.`;

  const payload = {
    subject,
    start: { dateTime: start.toISOString(), timeZone: 'Europe/Madrid' },
    end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Madrid' },
    body:  { contentType: 'text', content: bodyContent },
    attendees,
    isOnlineMeeting:            true,
    onlineMeetingProvider:      'teamsForBusiness',
    showAs:                     'busy',
    reminderMinutesBeforeStart: 30,
    isReminderOn:               true,
  };

  const event = await _graphRequest(
    'POST',
    `/users/${user}/calendars/${calId}/events`,
    null,
    payload
  );

  console.log(`📅 [Graph] Evento creado: "${subject}" (id: ${event.id?.slice(0, 20)}…)`);
  return event;
}

/**
 * Cancela un evento previamente creado.
 * @param {string} eventId
 * @param {string} [comment]
 */
async function cancelCalendarEvent(eventId, comment = '') {
  const user = CALENDAR_USER();
  await _graphRequest(
    'POST',
    `/users/${user}/events/${eventId}/cancel`,
    null,
    { comment: comment || 'Cita cancelada.' }
  );
  console.log(`🗑️  [Graph] Evento cancelado: ${eventId.slice(0, 20)}…`);
}

module.exports = {
  getCalendarId,
  getEventsForRange,
  createCalendarEvent,
  cancelCalendarEvent,
};
