// src/calendar/appointmentScheduler.js
// Lógica de negocio para encontrar huecos disponibles en Outlook y crear citas.
//
// Reglas del sistema:
//   · Duración fija: 1 hora (slots siempre en punto: 09:00, 10:00, …)
//   · Mañana: 09:00 – 14:00 (slots: 09, 10, 11, 12, 13)
//   · Tarde:  16:00 – 18:30 (slots: 16, 17 — el slot de las 18:00 terminaría a las 19:00, excede el límite)
//   · Máximo CALENDAR_MAX_SLOTS_PER_HOUR citas simultáneas (default: 2)
//   · Búsqueda desde día actual +1 (evitar asignaciones inmediatas)
//   · Horizonte: próximos CALENDAR_HORIZON_DAYS días laborales (default: 5)
//   · Solo lunes a viernes laborables

const fs   = require('fs');
const path = require('path');
const { getEventsForRange, createCalendarEvent } = require('./outlookCalendar');

const MAX_SLOTS    = Number(process.env.CALENDAR_MAX_SLOTS_PER_HOUR || 2);
const HORIZON_DAYS = Number(process.env.CALENDAR_HORIZON_DAYS       || 5);

// Archivo de reservas locales (persiste estado entre reinicios del proceso)
const BOOKINGS_PATH = path.resolve(__dirname, '../../data/calendar_bookings.json');

// ── Persistencia de reservas ──────────────────────────────────────────────────

function _loadBookings() {
  try {
    if (fs.existsSync(BOOKINGS_PATH)) {
      return JSON.parse(fs.readFileSync(BOOKINGS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('❌ [Calendar] Error leyendo calendar_bookings.json:', e.message);
  }
  return {};
}

function _saveBookings(data) {
  try {
    const dir = path.dirname(BOOKINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ [Calendar] Error guardando calendar_bookings.json:', e.message);
  }
}

// ── Helpers de calendario ─────────────────────────────────────────────────────

function _isBusinessDay(date) {
  const d = date.getDay(); // 0=Dom, 6=Sáb
  return d >= 1 && d <= 5;
}

/**
 * Devuelve los slots horarios (objetos Date) para un día y preferencia dados.
 * Todos los slots empiezan en punto y duran 1 hora.
 */
function _getSlotsForDay(date, preference) {
  const pref = String(preference || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const isMorning = pref.includes('manana') || pref.includes('morning');

  const hours = isMorning
    ? [9, 10, 11, 12, 13]   // 09:00–14:00
    : [16, 17];              // 16:00–18:00

  return hours.map(h => {
    const d = new Date(date);
    d.setHours(h, 0, 0, 0);
    return d;
  });
}

/**
 * Construye un mapa slot_key → count a partir de los eventos de Outlook
 * y las reservas locales en vuelo.
 */
function _buildSlotCountMap(events, bookings) {
  const map = {};

  for (const ev of events) {
    const raw   = ev.start?.dateTime || ev.start?.date;
    if (!raw) continue;
    const key   = _slotKey(new Date(raw));
    map[key]    = (map[key] || 0) + 1;
  }

  for (const b of Object.values(bookings)) {
    if (!b.slotStart || b.status === 'error' || b.status === 'cancelled') continue;
    const key = _slotKey(new Date(b.slotStart));
    map[key]  = (map[key] || 0) + 1;
  }

  return map;
}

/** Clave canónica de slot: "YYYY-MM-DDTHH:MM" en zona local. */
function _slotKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const H = String(d.getHours()).padStart(2, '0');
  const M = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${D}T${H}:${M}`;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Busca el primer hueco disponible según la preferencia horaria.
 *
 * @param {'Mañana'|'Tarde'|string} preference
 * @param {string} [nexpToExclude] — omite la reserva existente de este nexp (evita auto-bloqueo)
 * @returns {Promise<{start: Date, key: string}|null>}
 *   null si no hay disponibilidad en el horizonte configurado.
 */
async function findNextAvailableSlot(preference, nexpToExclude = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const searchStart = new Date(today);
  searchStart.setDate(searchStart.getDate() + 1);

  const searchEnd = new Date(today);
  searchEnd.setDate(searchEnd.getDate() + 1 + HORIZON_DAYS * 3); // buffer holgado para fines de semana
  searchEnd.setHours(23, 59, 59, 999);

  let events = [];
  try {
    events = await getEventsForRange(searchStart, searchEnd);
  } catch (err) {
    console.error('❌ [Calendar] Error consultando Outlook:', err.message);
    throw err;
  }

  const allBookings = _loadBookings();
  const bookings    = nexpToExclude
    ? Object.fromEntries(Object.entries(allBookings).filter(([n]) => n !== nexpToExclude))
    : allBookings;

  const slotCount = _buildSlotCountMap(events, bookings);

  let laborDaysChecked = 0;
  const cursor = new Date(searchStart);

  while (laborDaysChecked < HORIZON_DAYS) {
    if (_isBusinessDay(cursor)) {
      const slots = _getSlotsForDay(cursor, preference);
      for (const slotStart of slots) {
        const key   = _slotKey(slotStart);
        const count = slotCount[key] || 0;
        if (count < MAX_SLOTS) {
          return { start: slotStart, key };
        }
      }
      laborDaysChecked++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return null; // sin disponibilidad en el horizonte
}

/**
 * Reserva una cita en Outlook y persiste el registro localmente.
 *
 * @param {object} opts
 *   nexp        {string}
 *   slot        {object}   — { start: Date } devuelto por findNextAvailableSlot
 *   attName     {string}   — persona que atiende al perito
 *   attPhone    {string}
 *   peritoEmail {string}
 *   peritoName  {string}
 * @returns {Promise<{success: boolean, slot?: object, event?: object, alreadyBooked?: boolean}>}
 */
async function bookAppointment({ nexp, slot, attName, attPhone, peritoEmail, peritoName }) {
  const bookings = _loadBookings();

  // Si ya está confirmada, no volver a crear
  const existing = bookings[nexp];
  if (existing?.status === 'confirmed' && existing.outlookEventId) {
    console.log(`ℹ️  [Calendar] Expediente ${nexp} ya tiene cita confirmada — se omite`);
    return { success: true, slot: { start: new Date(existing.slotStart) }, alreadyBooked: true };
  }

  // Reservar localmente ANTES de llamar a Outlook (evita doble booking por concurrencia)
  bookings[nexp] = {
    slotStart:      slot.start.toISOString(),
    attName:        attName   || '',
    attPhone:       attPhone  || '',
    peritoEmail:    peritoEmail || '',
    peritoName:     peritoName  || '',
    createdAt:      Date.now(),
    outlookEventId: null,
    status:         'pending',
    error:          null,
  };
  _saveBookings(bookings);

  try {
    const event = await createCalendarEvent({
      nexp, slot, peritoEmail, peritoName, attName, attPhone,
    });

    bookings[nexp].outlookEventId = event.id;
    bookings[nexp].status         = 'confirmed';
    bookings[nexp].eventSubject   = event.subject;
    _saveBookings(bookings);

    console.log(`✅ [Calendar] Cita creada en Outlook | nexp=${nexp} | slot=${slot.key}`);
    return { success: true, slot, event };

  } catch (err) {
    bookings[nexp].status = 'error';
    bookings[nexp].error  = err.message;
    _saveBookings(bookings);

    console.error(`❌ [Calendar] Error creando cita en Outlook | nexp=${nexp}:`, err.message);
    throw err;
  }
}

/** Devuelve la reserva de un expediente, o null si no existe. */
function getBooking(nexp) {
  return _loadBookings()[nexp] || null;
}

/**
 * Persiste un slot propuesto (antes de confirmación del asegurado).
 * Permite recuperarlo en el siguiente mensaje para hacer el booking.
 */
function saveProposedSlot(nexp, slot) {
  const bookings = _loadBookings();
  if (!bookings[nexp]) {
    bookings[nexp] = { status: 'proposed', createdAt: Date.now() };
  }
  bookings[nexp].slotStart = slot.start.toISOString();
  bookings[nexp].slotKey   = slot.key;
  bookings[nexp].status    = bookings[nexp].status === 'confirmed' ? 'confirmed' : 'proposed';
  _saveBookings(bookings);
}

/** Elimina el registro de reserva de un expediente. */
function clearBooking(nexp) {
  const bookings = _loadBookings();
  delete bookings[nexp];
  _saveBookings(bookings);
}

// ── Formateo para mensajes ────────────────────────────────────────────────────

/**
 * Formatea un slot en texto legible en español.
 * Ej: "jueves 3 de abril, de 10:00 a 11:00"
 */
function formatSlotForUser(slotOrDate) {
  if (!slotOrDate) return null;
  const start = new Date(slotOrDate.start || slotOrDate);
  if (isNaN(start)) return null;
  const end = new Date(start.getTime() + 60 * 60 * 1_000);

  const dayStr = start.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const h1 = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const h2 = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

  return `${dayStr}, de ${h1} a ${h2}`;
}

/**
 * Detecta preferencia horaria directamente en el texto del usuario (sin IA).
 * Útil para añadir el slot al contexto ANTES de llamar a la IA.
 * @returns {'Mañana'|'Tarde'|null}
 */
function detectPreferenceFromText(text) {
  const t = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/\bmanana\b|\bpor la manana\b|\bmorning\b/.test(t)) return 'Mañana';
  if (/\btarde\b|\bpor la tarde\b|\bafternoon\b/.test(t))  return 'Tarde';
  return null;
}

module.exports = {
  findNextAvailableSlot,
  bookAppointment,
  getBooking,
  saveProposedSlot,
  clearBooking,
  formatSlotForUser,
  detectPreferenceFromText,
};
