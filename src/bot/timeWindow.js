// timeWindow.js
const START_HOUR = Number(process.env.SEND_START_HOUR || 8);
const END_HOUR = Number(process.env.SEND_END_HOUR || 21);

function isWithinSendWindow(date = new Date()) {
  const hour = date.getHours(); // si TZ está bien, esto es Madrid
  return hour >= START_HOUR && hour < END_HOUR;
}

function nextSendTimeMs(now = new Date()) {
  if (isWithinSendWindow(now)) return now.getTime();

  const d = new Date(now);
  const hour = d.getHours();

  // Si ya pasó END_HOUR => mañana
  if (hour >= END_HOUR) d.setDate(d.getDate() + 1);

  // Set a START_HOUR:00 local
  d.setHours(START_HOUR, 0, 0, 0);
  return d.getTime();
}

module.exports = { isWithinSendWindow, nextSendTimeMs, START_HOUR, END_HOUR };
