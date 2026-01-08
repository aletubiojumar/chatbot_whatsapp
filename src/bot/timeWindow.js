// timeWindow.js
const TIMEZONE = process.env.BOT_TIMEZONE || 'Europe/Madrid';
const START_HOUR = Number(process.env.SEND_START_HOUR || 8);  // 08:00
const END_HOUR = Number(process.env.SEND_END_HOUR || 21);    // 21:00 (incluye 20:59)

function getLocalParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function isWithinSendWindow(date = new Date()) {
  const { hour } = getLocalParts(date);
  return hour >= START_HOUR && hour < END_HOUR;
}

function nextSendTimeMs(now = new Date()) {
  // Si estamos dentro, es "ya"
  if (isWithinSendWindow(now)) return now.getTime();

  const { year, month, day, hour } = getLocalParts(now);

  // Construimos el "próximo 08:00" en la TZ local
  // Truco: creamos una fecha "UTC" aproximada y luego dejamos que Intl nos guíe con partes.
  // Para simplificar: si es antes de 08:00 => hoy a las 08:00, si es >=21 => mañana a las 08:00.
  const base = new Date(now.getTime());

  // Ajuste de día
  if (hour >= END_HOUR) {
    base.setDate(base.getDate() + 1);
  }
  // Fijar 08:00 “local” es complicado sin librería; lo resolvemos iterando hasta que Intl nos dé 08:00.
  // Hacemos una aproximación: poner 08:00 en hora local usando el offset de sistema suele valer si el servidor está en Europe/Madrid.
  // Recomendación: ejecuta node con TZ=Europe/Madrid para que esto sea exacto.
  const d = new Date(base);
  d.setHours(START_HOUR, 0, 0, 0);
  return d.getTime();
}

module.exports = { isWithinSendWindow, nextSendTimeMs, TIMEZONE, START_HOUR, END_HOUR };
