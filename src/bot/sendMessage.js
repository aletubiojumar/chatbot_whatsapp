// src/bot/sendMessage.js - META WHATSAPP API (Sin Twilio)
require('dotenv').config();
const axios = require('axios');

// Configuración de Meta WhatsApp API
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';

if (!META_ACCESS_TOKEN) {
  throw new Error('❌ Falta META_ACCESS_TOKEN en .env');
}

if (!META_PHONE_NUMBER_ID) {
  throw new Error('❌ Falta META_PHONE_NUMBER_ID en .env');
}

// Base URL de Meta WhatsApp API
const WHATSAPP_API_URL = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

/**
 * Normaliza número de teléfono para Meta WhatsApp
 * Meta espera números en formato: 34612345678 (sin + ni espacios)
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;

  let normalized = phoneNumber.toString().trim();
  
  // Quitar whatsapp: si existe
  normalized = normalized.replace(/^whatsapp:/i, '');
  
  // Quitar espacios, guiones, paréntesis
  normalized = normalized.replace(/[\s\-\(\)]/g, '');
  
  // Quitar el + si existe
  normalized = normalized.replace(/^\+/, '');
  
  return normalized;
}

/**
 * Envía un mensaje de texto simple
 * @param {string} toNumber - Número de teléfono (puede incluir whatsapp:+34...)
 * @param {string} messageText - Texto del mensaje
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function sendTextMessage(toNumber, messageText) {
  const to = normalizePhoneNumber(toNumber);
  
  if (!to) {
    throw new Error(`Número de teléfono inválido: ${toNumber}`);
  }

  console.log('📤 Enviando mensaje de texto...');
  console.log('   To:', to);
  console.log('   Text length:', messageText.length);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: messageText
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Mensaje enviado correctamente');
    console.log('   Message ID:', response.data.messages[0].id);
    
    return response.data;

  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un template de WhatsApp (con botones, etc.)
 * @param {string} toNumber - Número de teléfono
 * @param {string} templateName - Nombre del template aprobado
 * @param {string} languageCode - Código de idioma (ej: 'es', 'en_US')
 * @param {object} components - Componentes del template (variables, botones, etc.)
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function sendTemplateMessage(toNumber, templateName, languageCode = 'es', components = []) {
  const to = normalizePhoneNumber(toNumber);
  
  if (!to) {
    throw new Error(`Número de teléfono inválido: ${toNumber}`);
  }

  console.log('📤 Enviando template...');
  console.log('   To:', to);
  console.log('   Template:', templateName);
  console.log('   Language:', languageCode);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode
          },
          components: components
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Template enviado correctamente');
    console.log('   Message ID:', response.data.messages[0].id);
    
    return response.data;

  } catch (error) {
    console.error('❌ Error enviando template:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un template con variables
 * @param {string} toNumber - Número de teléfono
 * @param {string} templateName - Nombre del template
 * @param {array} variables - Array de variables para el template
 * @param {string} languageCode - Código de idioma
 * @returns {Promise<object>} - Respuesta de Meta API
 * 
 * Ejemplo:
 * sendTemplateWithVariables(
 *   '34612345678',
 *   'recordatorio_cita',
 *   ['Juan Pérez', '15 de marzo', '10:00 AM'],
 *   'es'
 * )
 */
async function sendTemplateWithVariables(toNumber, templateName, variables = [], languageCode = 'es') {
  const components = [];
  
  if (variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(variable => ({
        type: 'text',
        text: variable
      }))
    });
  }

  return sendTemplateMessage(toNumber, templateName, languageCode, components);
}

/**
 * Envía una imagen
 * @param {string} toNumber - Número de teléfono
 * @param {string} imageUrl - URL de la imagen
 * @param {string} caption - Texto opcional de la imagen
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function sendImageMessage(toNumber, imageUrl, caption = '') {
  const to = normalizePhoneNumber(toNumber);
  
  if (!to) {
    throw new Error(`Número de teléfono inválido: ${toNumber}`);
  }

  console.log('📤 Enviando imagen...');
  console.log('   To:', to);
  console.log('   Image URL:', imageUrl);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'image',
        image: {
          link: imageUrl,
          caption: caption
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Imagen enviada correctamente');
    console.log('   Message ID:', response.data.messages[0].id);
    
    return response.data;

  } catch (error) {
    console.error('❌ Error enviando imagen:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un documento
 * @param {string} toNumber - Número de teléfono
 * @param {string} documentUrl - URL del documento
 * @param {string} filename - Nombre del archivo
 * @param {string} caption - Texto opcional
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function sendDocumentMessage(toNumber, documentUrl, filename, caption = '') {
  const to = normalizePhoneNumber(toNumber);
  
  if (!to) {
    throw new Error(`Número de teléfono inválido: ${toNumber}`);
  }

  console.log('📤 Enviando documento...');
  console.log('   To:', to);
  console.log('   Document URL:', documentUrl);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'document',
        document: {
          link: documentUrl,
          filename: filename,
          caption: caption
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Documento enviado correctamente');
    console.log('   Message ID:', response.data.messages[0].id);
    
    return response.data;

  } catch (error) {
    console.error('❌ Error enviando documento:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Marca un mensaje como leído
 * @param {string} messageId - ID del mensaje a marcar como leído
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function markMessageAsRead(messageId) {
  console.log('✓ Marcando mensaje como leído:', messageId);

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Mensaje marcado como leído');
    return response.data;

  } catch (error) {
    console.error('❌ Error marcando mensaje como leído:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Envía un mensaje con botones interactivos
 * @param {string} toNumber - Número de teléfono
 * @param {string} bodyText - Texto del mensaje
 * @param {array} buttons - Array de botones [{id: '1', title: 'Opción 1'}, ...]
 * @param {string} headerText - Texto opcional del header
 * @param {string} footerText - Texto opcional del footer
 * @returns {Promise<object>} - Respuesta de Meta API
 */
async function sendInteractiveButtonsMessage(toNumber, bodyText, buttons, headerText = '', footerText = '') {
  const to = normalizePhoneNumber(toNumber);
  
  if (!to) {
    throw new Error(`Número de teléfono inválido: ${toNumber}`);
  }

  if (buttons.length > 3) {
    throw new Error('Máximo 3 botones permitidos');
  }

  console.log('📤 Enviando mensaje con botones interactivos...');
  console.log('   To:', to);
  console.log('   Buttons:', buttons.length);

  const interactiveMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: bodyText
      },
      action: {
        buttons: buttons.map(btn => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title.substring(0, 20) // Max 20 caracteres
          }
        }))
      }
    }
  };

  // Agregar header si existe
  if (headerText) {
    interactiveMessage.interactive.header = {
      type: 'text',
      text: headerText
    };
  }

  // Agregar footer si existe
  if (footerText) {
    interactiveMessage.interactive.footer = {
      text: footerText
    };
  }

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      interactiveMessage,
      {
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Mensaje con botones enviado correctamente');
    console.log('   Message ID:', response.data.messages[0].id);
    
    return response.data;

  } catch (error) {
    console.error('❌ Error enviando mensaje con botones:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendTemplateWithVariables,
  sendImageMessage,
  sendDocumentMessage,
  markMessageAsRead,
  sendInteractiveButtonsMessage,
  normalizePhoneNumber
};