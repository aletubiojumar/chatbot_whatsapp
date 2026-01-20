// librerías
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const axios = require('axios');

// módulos
const { processMessage } = require('./messageHandler');
const { startReminderScheduler } = require('./reminderScheduler');
const { startInactivityScheduler } = require('./inactivityHandler');
const conversationManager = require('./conversationManager');
const responses = require('./responses');
const { isWithinSendWindow } = require('./timeWindow');
const {
  sendAttendeeTemplate,
  sendCorrectionTemplate,
  sendInitialConfirmV5Template,
  sendAppointmentTemplate,
  sendSeverityTemplate
} = require('./templateSender');

const app = express();
const PORT = process.env.PORT || 3000;

// Estado de siniestros enviados
const siniestrosMap = new Map(); // phoneNumber -> { siniestro, estado, timestamp }

/**
 * ENDPOINT 1: Recibir lista de teléfonos desde Python
 * POST /api/iniciar-contactos
 * Body: { contactos: [{ siniestro, telefono }, ...] }
 */

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/api/iniciar-contactos', async (req, res) => {
  try {
    const { contactos } = req.body;

    if (!Array.isArray(contactos) || contactos.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere un array de contactos no vacío'
      });
    }

    console.log(`\n📥 Recibidos ${contactos.length} contactos desde Python`);

    let enviados = 0;
    let errores = 0;

    // Procesar cada contacto
    for (const contacto of contactos) {
      const {
        siniestro,
        telefono,
        direccion,
        asegurado,
        fecha_siniestro,
        fechaSiniestro,
        fecha
      } = contacto;
      try {
        // Validar y formatear teléfono
        let phoneNumber = telefono.trim();

        // Si no tiene prefijo, añadir whatsapp:+34
        if (!phoneNumber.startsWith('whatsapp:')) {
          // Quitar cualquier prefijo +34 o 34 del teléfono
          phoneNumber = phoneNumber.replace(/^\+?34/, '');
          // Añadir prefijo completo
          phoneNumber = `whatsapp:+34${phoneNumber}`;
        }

        console.log(`   📱 Procesando: ${siniestro} -> ${phoneNumber}`);

        // Guardar relación siniestro -> teléfono
        siniestrosMap.set(phoneNumber, {
          siniestro,
          estado: 'pendiente',
          timestamp: Date.now()
        });

        // Enviar mensaje inicial
        const { sendInitialTemplate } = require('./templateSender');
        const CONTENT_SID = process.env.CONTENT_SID;

        await sendInitialTemplate(phoneNumber);

        // Registrar conversación
        conversationManager.createOrUpdateConversation(phoneNumber, {
          status: 'pending',
          stage: 'initial',
          siniestro: siniestro, // ✅ Guardar número de siniestro

          // ✅ Datos del siniestro (si vienen de Python)
          direccion: direccion || '',
          asegurado: asegurado || '',
          fechaSiniestro: fecha_siniestro || fechaSiniestro || fecha || '',

          lastPromptType: 'buttons',
          lastMessageAt: Date.now(),
          lastInteractive: {
            kind: 'template',
            sid: CONTENT_SID,
            variables: null
          }
        });

        console.log(`   ✅ Enviado a ${telefono}`);
        enviados++;

        // Esperar entre envíos para no saturar (2 segundos)
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`   ❌ Error enviando a ${telefono}:`, error.message);
        errores++;
      }
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   Total: ${contactos.length}`);
    console.log(`   ✅ Enviados: ${enviados}`);
    console.log(`   ❌ Errores: ${errores}`);

    res.json({
      ok: true,
      total: contactos.length,
      enviados,
      errores,
      mensaje: `${enviados}/${contactos.length} mensajes enviados correctamente`
    });

  } catch (error) {
    console.error('❌ Error en /api/iniciar-contactos:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * ENDPOINT 2: Consultar estado de envíos
 * GET /api/estado-contactos
 */
app.get('/api/estado-contactos', (req, res) => {
  const conversaciones = conversationManager.getConversations();

  const estadisticas = {
    total: Object.keys(conversaciones).length,
    pendientes: 0,
    respondidos: 0,
    completados: 0,
    escalados: 0
  };

  const detalles = Object.entries(conversaciones).map(([phone, conv]) => {
    // Contar estados
    if (conv.status === 'pending') estadisticas.pendientes++;
    else if (conv.status === 'responded') estadisticas.respondidos++;
    else if (conv.status === 'completed') estadisticas.completados++;
    else if (conv.status === 'escalated') estadisticas.escalados++;

    const siniestroData = siniestrosMap.get(phone) || {};

    return {
      telefono: phone.replace('whatsapp:+34', ''),
      siniestro: conv.siniestro || siniestroData.siniestro || 'N/A',
      estado: conv.status,
      etapa: conv.stage,
      intentos: conv.attempts || 0,
      ultimoMensaje: conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString('es-ES') : null
    };
  });

  res.json({
    ok: true,
    estadisticas,
    detalles
  });
});

/**
 * Función auxiliar para notificar a Python cuando un usuario responde
 */
async function notificarPythonRespuesta(phoneNumber, siniestro) {
  const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:5000';

  try {
    console.log(`🔔 Notificando a Python: Usuario ${phoneNumber} respondió (siniestro: ${siniestro})`);

    const response = await axios.post(
      `${PYTHON_API_URL}/api/marcar-contactado`,
      {
        siniestro,
        telefono: phoneNumber.replace('whatsapp:+34', ''),
        timestamp: new Date().toISOString()
      },
      { timeout: 10000 }
    );

    if (response.data.ok) {
      console.log(`✅ Python confirmó: ${siniestro} marcado como contactado`);
      return true;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`⚠️  No se pudo conectar con Python API en ${PYTHON_API_URL}`);
      console.error(`   Asegúrate de que está ejecutándose: python3 scripts/api_server.py`);
    } else {
      console.error(`❌ Error notificando a Python:`, error.message);
    }
    return false;
  }
}

/* =======================
   TWIML (LOCAL EN INDEX)
======================= */
function escapeXml(unsafe) {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateTwiMLResponse(responseText) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(responseText || ' ')}</Message>
</Response>`;
}

// Ruta de salud
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WhatsApp Bot está funcionando',
    timestamp: new Date().toISOString()
  });
});

// Webhook principal Twilio
app.post('/webhook', async (req, res) => {
  const requestId = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log('📨 [' + requestId + '] NUEVA PETICIÓN WEBHOOK');
  console.log('='.repeat(60));

  try {
    // 1. CAPTURAR DATOS BÁSICOS
    const incomingMessage = req.body.Body || '';
    const senderNumber = req.body.From || '';

    console.log(`📥 [${requestId}] De: ${senderNumber}`);
    console.log(`📥 [${requestId}] Mensaje: "${incomingMessage}"`);
    console.log(`📥 [${requestId}] Timestamp: ${new Date().toISOString()}`);

    // 2. VALIDAR DATOS
    if (!senderNumber) {
      console.error(`❌ [${requestId}] ERROR: No hay número de teléfono`);
      const errorResponse = generateTwiMLResponse('Error: número de teléfono faltante');
      res.type('text/xml');
      return res.send(errorResponse);
    }

    // 3. OBTENER CONVERSACIÓN
    console.log(`🔍 [${requestId}] Obteniendo conversación...`);
    const convBefore = conversationManager.getConversation(senderNumber);

    if (convBefore) {
      console.log(`📊 [${requestId}] Estado conversación:`);
      console.log(`   - Status: ${convBefore.status}`);
      console.log(`   - Stage: ${convBefore.stage}`);
      console.log(`   - LastPromptType: ${convBefore.lastPromptType}`);
      console.log(`   - Attempts: ${convBefore.attempts || 0}`);
    } else {
      console.log(`⚠️  [${requestId}] No hay conversación previa`);
    }

    // 4. VERIFICAR HORARIO
    console.log(`🕐 [${requestId}] Verificando horario...`);
    if (!isWithinSendWindow()) {
      console.log(`❌ [${requestId}] FUERA DE HORARIO`);
      const closedText = responses.closedMessage ||
        'Hola, ahora mismo estamos cerrados, te atenderemos entre las 8:00 am y las 21:00. Un saludo.';
      const twimlClosed = generateTwiMLResponse(closedText);
      res.type('text/xml');
      return res.send(twimlClosed);
    }
    console.log(`✅ [${requestId}] Dentro de horario`);

    // 5. PROCESAR MENSAJE
    console.log(`⚙️  [${requestId}] Procesando mensaje con messageHandler...`);
    let responseText;

    try {
      responseText = processMessage(incomingMessage, senderNumber);
      console.log(`✅ [${requestId}] Respuesta generada: "${responseText.substring(0, 100)}..."`);
    } catch (processError) {
      console.error(`❌ [${requestId}] ERROR en processMessage:`, processError);
      console.error(`   Stack:`, processError.stack);
      throw processError; // Re-lanzar para que lo capture el try-catch principal
    }

    // 6. OBTENER ESTADO ACTUALIZADO
    console.log(`🔍 [${requestId}] Obteniendo estado actualizado...`);
    const conversation = conversationManager.getConversation(senderNumber);

    if (conversation) {
      console.log(`📊 [${requestId}] Estado actualizado:`);
      console.log(`   - Status: ${conversation.status}`);
      console.log(`   - Stage: ${conversation.stage}`);
      console.log(`   - LastPromptType: ${conversation.lastPromptType}`);
    }

    // 7. VERIFICAR SI HAY QUE ENVIAR TEMPLATES
    console.log(`🔍 [${requestId}] Verificando si hay templates pendientes...`);

    // Template 0: Confirmación inicial
    if (conversation?.status === 'awaiting_initial_confirm_template' &&
      conversation?.stage === 'initial_confirm') {
      console.log(`🚀 [${requestId}] Enviando template confirmación inicial...`);

      const MENSAJE_CORREGIR_V5_SID = process.env.MENSAJE_CORREGIR_V5_SID;

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE_CORREGIR_V5_SID,
          variables: null
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          console.log(`📤 [${requestId}] Enviando template inicial...`);
          await sendInitialConfirmV5Template(senderNumber);
          conversationManager.recordResponse(senderNumber, '[Template: confirmación inicial datos]', 'bot');
          console.log(`✅ [${requestId}] Template inicial enviado`);
        } catch (error) {
          console.error(`❌ [${requestId}] Error en template inicial:`, error);
          console.error(`   Stack:`, error.stack);
        }
      }, 300);
    }

    // Template 1: Quién atenderá
    if (conversation?.status === 'awaiting_attendee' &&
      conversation?.stage === 'attendee_select') {
      console.log(`🚀 [${requestId}] Enviando template quién atenderá...`);

      const MENSAJE4_V2_SID = process.env.MENSAJE4_V2_SID;

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE4_V2_SID,
          variables: null
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          console.log(`📤 [${requestId}] Enviando template attendee...`);
          await sendAttendeeTemplate(senderNumber);
          conversationManager.recordResponse(senderNumber, '[Template: quién atenderá]', 'bot');
          console.log(`✅ [${requestId}] Template attendee enviado`);
        } catch (error) {
          console.error(`❌ [${requestId}] Error en template attendee:`, error);
          console.error(`   Stack:`, error.stack);
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      console.log(`✅ [${requestId}] Respondiendo con espacio vacío (template se envía aparte)`);
      return res.send(twiml);
    }

    // Template 2: Correcciones
    if (conversation?.status === 'awaiting_correction_confirmation' &&
      conversation?.stage === 'confirming_corrections') {
      console.log(`🚀 [${requestId}] Enviando template correcciones...`);

      const MENSAJE_CORREGIR_V5_SID = process.env.MENSAJE_CORREGIR_V5_SID;
      const vars = {
        direccion: conversation.correctedDireccion || '',
        fecha: conversation.correctedFecha || '',
        nombre: conversation.correctedNombre || ''
      };

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE_CORREGIR_V5_SID,
          variables: vars
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          console.log(`📤 [${requestId}] Enviando template correcciones...`);
          await sendCorrectionTemplate(senderNumber, vars);
          conversationManager.recordResponse(senderNumber, '[Template: correcciones]', 'bot');
          console.log(`✅ [${requestId}] Template correcciones enviado`);
        } catch (error) {
          console.error(`❌ [${requestId}] Error en template correcciones:`, error);
          console.error(`   Stack:`, error.stack);
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      console.log(`✅ [${requestId}] Respondiendo con espacio vacío`);
      return res.send(twiml);
    }

    // Template 3: Gravedad
    if (conversation?.status === 'awaiting_severity_template' &&
      conversation?.stage === 'awaiting_severity') {
      console.log(`🚀 [${requestId}] Enviando template gravedad...`);

      const MENSAJE_GRAVEDAD_SID = process.env.MENSAJE_GRAVEDAD_SID;

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE_GRAVEDAD_SID,
          variables: null
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      try {
        console.log(`📤 [${requestId}] Enviando template gravedad...`);
        const msg = await sendSeverityTemplate(senderNumber);
        console.log(`✅ [${requestId}] Template gravedad enviado. SID:`, msg.sid);
        conversationManager.recordResponse(senderNumber, '[Template: gravedad]', 'bot');
      } catch (err) {
        console.error(`❌ [${requestId}] Error en template gravedad:`, err);
        console.error(`   Stack:`, err.stack);
      }

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      console.log(`✅ [${requestId}] Respondiendo con espacio vacío`);
      return res.send(twiml);
    }

    // Template 4: Cita
    if (conversation?.status === 'awaiting_appointment' &&
      conversation?.stage === 'appointment_select') {
      console.log(`🚀 [${requestId}] Enviando template cita...`);

      const MENSAJE_CITA_SID = process.env.MENSAJE_CITA_SID;

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE_CITA_SID,
          variables: null
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          console.log(`📤 [${requestId}] Enviando template cita...`);
          await sendAppointmentTemplate(senderNumber);
          conversationManager.recordResponse(senderNumber, '[Template: cita]', 'bot');
          console.log(`✅ [${requestId}] Template cita enviado`);
        } catch (error) {
          console.error(`❌ [${requestId}] Error en template cita:`, error);
          console.error(`   Stack:`, error.stack);
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      console.log(`✅ [${requestId}] Respondiendo con espacio vacío`);
      return res.send(twiml);
    }

    // 8. RESPUESTA NORMAL
    console.log(`📤 [${requestId}] Generando respuesta TwiML normal...`);
    const twimlResponse = generateTwiMLResponse(responseText || ' ');
    res.type('text/xml');
    console.log(`✅ [${requestId}] Enviando respuesta TwiML`);
    console.log(`${'='.repeat(60)}`);
    return res.send(twimlResponse);

  } catch (error) {
    console.error(`\n${'❌'.repeat(30)}`);
    console.error(`💥 [${requestId}] ERROR CRÍTICO EN WEBHOOK`);
    console.error(`${'❌'.repeat(30)}`);
    console.error(`Tipo: ${error.constructor.name}`);
    console.error(`Mensaje: ${error.message}`);
    console.error(`Stack:`, error.stack);
    console.error(`${'❌'.repeat(30)}\n`);

    const errorResponse = generateTwiMLResponse('Lo siento, hubo un error. Por favor intenta de nuevo.');
    res.type('text/xml');
    return res.send(errorResponse);
  }
});

// ✅ Schedulers se inician UNA sola vez, fuera del webhook
startReminderScheduler();
startInactivityScheduler();

// Servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`\n⚠️  Recuerda: Necesitas ngrok para exponer este servidor a internet`);
});