const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const { processMessage } = require('./messageHandler');
const { startReminderScheduler } = require('./reminderScheduler');
const { startInactivityScheduler } = require('./inactivityHandler');
const conversationManager = require('./conversationManager');
const responses = require('./responses');

const {
  sendAttendeeTemplate,
  sendCorrectionTemplate,
  sendAppointmentTemplate,
  sendSeverityTemplate
} = require('./templateSender');

const { isWithinSendWindow } = require('./timeWindow');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

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
  try {
    const incomingMessage = req.body.Body || '';
    const senderNumber = req.body.From || '';

    console.log(`📥 Procesando mensaje de ${senderNumber}: "${incomingMessage}"`);

    // ✅ Fuera de horario: responder SIEMPRE "cerrados" y NO procesar flujo
    if (!isWithinSendWindow()) {
      const closedText =
        responses.closedMessage ||
        'Hola, ahora mismo estamos cerrados, te atenderemos entre las 8:00 am y las 21:00. Un saludo.';
      const twimlClosed = generateTwiMLResponse(closedText);
      res.type('text/xml');
      return res.send(twimlClosed);
    }

    // ✅ Dentro de horario: procesar flujo normal
    const responseText = processMessage(incomingMessage, senderNumber);
    console.log(`💬 Respuesta generada: "${responseText}"`);

    const conversation = conversationManager.getConversation(senderNumber);
    console.log(`📊 Estado de conversación:`, {
      stage: conversation?.stage,
      status: conversation?.status,
      lastPromptType: conversation?.lastPromptType
    });

    // =========================
    // ENVÍO DE TEMPLATES (BOTONES)
    // =========================

    // 1) Template quién atenderá (mensaje4)
    if (conversation && conversation.status === 'awaiting_attendee' && conversation.stage === 'attendee_select') {
      console.log(`🚀 Condición cumplida. Enviando template de quién atenderá al perito (mensaje4)...`);

      const MENSAJE4_SID = process.env.MENSAJE4_SID;

      conversationManager.createOrUpdateConversation(senderNumber, {
        status: 'responded',
        lastPromptType: 'buttons',
        lastInteractive: {
          kind: 'template',
          sid: MENSAJE4_SID,
          variables: null
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          await sendAttendeeTemplate(senderNumber);
          conversationManager.recordResponse(senderNumber, '[Template: quién atenderá]', 'bot');
          console.log(`✅ Template mensaje4 enviado a ${senderNumber}`);
        } catch (error) {
          console.error('❌ Error enviando template mensaje4:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_attendee' });
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    // 2) Template confirmación correcciones (mensaje_corregir)
    if (
      conversation &&
      conversation.status === 'awaiting_correction_confirmation' &&
      conversation.stage === 'confirming_corrections'
    ) {
      console.log(`🚀 Enviando template mensaje_corregir (confirmación datos corregidos)...`);

      const MENSAJE_CORREGIR_SID = process.env.MENSAJE_CORREGIR_SID;

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
          sid: MENSAJE_CORREGIR_SID,
          variables: vars
        },
        lastMessageAt: Date.now(),
        inactivityCheckAt: null
      });

      setTimeout(async () => {
        try {
          console.log('🧩 vars mensaje_corregir:', vars);
          await sendCorrectionTemplate(senderNumber, vars);
          conversationManager.recordResponse(senderNumber, '[Template: correcciones]', 'bot');
        } catch (error) {
          console.error('❌ Error enviando template mensaje_corregir:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_correction_confirmation' });
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    // 3) Template gravedad (mensaje_gravedad)
    if (conversation && conversation.status === 'awaiting_severity_template' && conversation.stage === 'awaiting_severity') {
      console.log('🚀 Enviando template mensaje_gravedad...');

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
        const msg = await sendSeverityTemplate(senderNumber);
        console.log('✅ Enviado. SID:', msg.sid || msg?.sid || msg?.MessageSid);
        conversationManager.recordResponse(senderNumber, '[Template: gravedad]', 'bot');
      } catch (err) {
        console.error('❌ Error enviando template mensaje_gravedad:', err);
        conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_severity_template' });
      }

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    // 4) Template cita (mensaje_cita)
    if (conversation && conversation.status === 'awaiting_appointment' && conversation.stage === 'appointment_select') {
      console.log(`🚀 Condición cumplida. Enviando template mensaje_cita...`);

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
          await sendAppointmentTemplate(senderNumber);
          conversationManager.recordResponse(senderNumber, '[Template: cita]', 'bot');
        } catch (error) {
          console.error('❌ Error enviando template mensaje_cita:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_appointment' });
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    // ✅ Respuesta normal TwiML
    const twimlResponse = generateTwiMLResponse(responseText || ' ');
    res.type('text/xml');
    return res.send(twimlResponse);
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
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