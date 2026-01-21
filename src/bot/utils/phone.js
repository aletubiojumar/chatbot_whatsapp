function normalizeWhatsAppNumber(input) {
  if (!input) return null;

  let num = input.toString().trim();

  // Quitar prefijo whatsapp:
  if (num.startsWith('whatsapp:')) {
    num = num.replace('whatsapp:', '').trim();
  }

  // Quitar espacios
  num = num.replace(/\s+/g, '');

  // Asegurar +
  if (!num.startsWith('+')) {
    num = '+' + num;
  }

  return `whatsapp:${num}`;
}

module.exports = { normalizeWhatsAppNumber };
