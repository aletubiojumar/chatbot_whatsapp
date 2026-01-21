// src/bot/utils/phone.js

/**
 * Normaliza un número de teléfono a formato WhatsApp de Twilio
 * @param {string} input - Número en cualquier formato
 * @returns {string|null} - Formato whatsapp:+E164 o null si inválido
 */
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

/**
 * Valida que un número tenga el formato correcto para Twilio WhatsApp
 * @param {string} number - Número a validar
 * @returns {boolean} - true si es válido
 */
function isValidTwilioWhatsAppTo(number) {
  if (!number) return false;
  
  // Debe empezar con whatsapp:+
  if (!number.startsWith('whatsapp:+')) return false;
  
  // Extraer solo los dígitos después de whatsapp:+
  const digits = number.replace('whatsapp:+', '');
  
  // Debe tener al menos 10 dígitos (formato internacional)
  if (digits.length < 10) return false;
  
  // Debe contener solo dígitos
  if (!/^\d+$/.test(digits)) return false;
  
  return true;
}

module.exports = { 
  normalizeWhatsAppNumber,
  isValidTwilioWhatsAppTo
};