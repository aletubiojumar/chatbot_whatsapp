const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const { processMessage, generateTwiMLResponse } = require('./messageHandler');
const { startReminderScheduler } = require('./reminderScheduler');
const { startInactivityScheduler } = require('./inactivityHandler');
const conversationManager = require('./conversationManager');
const responses = require('./responses');

const { sendVerificationTemplate, sendAttendeeTemplate, sendCorrectionTemplate, sendAppointmentTemplate } = require('./templateSender');
const { isWithinSendWindow } = require('./timeWindow');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

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
      const closedText = responses.closedMessage ||
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
      status: conversation?.status
    });

    //Envío de template verificación (mensaje2)
    if (conversation && conversation.status === 'awaiting_verification' && conversation.stage === 'identity_confirmed') {
      console.log(`🚀 Condición cumplida. Enviando template de verificación...`);

      // Evitar dobles envíos por reintentos
      conversationManager.createOrUpdateConversation(senderNumber, { status: 'responded' });

      setTimeout(async () => {
        try {
          await sendVerificationTemplate(senderNumber);
        } catch (error) {
          console.error('❌ Error enviando template verificación:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_verification' });
        }
      }, 300);

      // Respondemos vacío para no mandar texto adicional
      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    //Envío de template quién atenderá (mensaje4)
    if (conversation && conversation.status === 'awaiting_attendee' && conversation.stage === 'attendee_select') {
      console.log(`🚀 Condición cumplida. Enviando template de quién atenderá al perito (mensaje4)...`);

      // Evitar dobles envíos por reintentos
      conversationManager.createOrUpdateConversation(senderNumber, { status: 'responded' });

      setTimeout(async () => {
        try {
          await sendAttendeeTemplate(senderNumber);
        } catch (error) {
          console.error('❌ Error enviando template mensaje4:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_attendee' });
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    //Envío de template pedir correcciones (mensaje_corregir)
    if (conversation && conversation.status === 'awaiting_correction_confirmation' && conversation.stage === 'confirming_corrections') {
      console.log(`🚀 Enviando template mensaje_corregir (confirmación datos corregidos)...`);

      // evitar dobles envíos por retries
      conversationManager.createOrUpdateConversation(senderNumber, { status: 'responded' });

      const vars = {
        direccion: conversation.correctedDireccion || '',
        fecha: conversation.correctedFecha || '',
        nombre: conversation.correctedNombre || ''
      };

      setTimeout(async () => {
        try {
          console.log('🧩 vars mensaje_corregir:', vars);
          await sendCorrectionTemplate(senderNumber, vars);
        } catch (error) {
          console.error('❌ Error enviando template mensaje_corregir:', error);
          conversationManager.createOrUpdateConversation(senderNumber, { status: 'awaiting_correction_confirmation' });
        }
      }, 300);

      const twiml = generateTwiMLResponse(' ');
      res.type('text/xml');
      return res.send(twiml);
    }

    if (conversation && conversation.status === 'awaiting_appointment' && conversation.stage === 'appointment_select') {
      console.log(`🚀 Condición cumplida. Enviando template mensaje_cita...`);

      // evitar doble envío por retries
      conversationManager.createOrUpdateConversation(senderNumber, { status: 'responded' });

      setTimeout(async () => {
        try {
          await sendAppointmentTemplate(senderNumber);
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