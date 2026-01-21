// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const conversationManager = require('./conversationManager');
const { processMessage } = require('./messageHandler');
const { handleContinuationResponse, startInactivityScheduler } = require('./inactivityHandler');
const { startReminderScheduler } = require('./reminderScheduler');
const { isWithinSendWindow } = require('./timeWindow');

// ✅ CORREGIDO: importar desde utils/phone en lugar de sendMessage
const { normalizeWhatsAppNumber } = require('./utils/phone');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const TEMPLATE_1_SID = process.env.TEMPLATE_1_SID;
const TEMPLATE_2_SID = process.env.TEMPLATE_2_SID;
const TEMPLATE_3_SID = process.env.TEMPLATE_3_SID;
const TEMPLATE_4_SID = process.env.TEMPLATE_4_SID;

const MENSAJE_AUSENCIA_SID = process.env.MENSAJE_AUSENCIA_SID;

function respondTwiML(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  if (message && String(message).trim().length > 0) {
    twiml.message(message);
  }
  res.type('text/xml');
  res.send(twiml.toString());
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'WhatsApp Bot está funcionando',
    timestamp: new Date().toISOString()
  });
});

/**
 * Debug opcional: útil para comprobar si Twilio llega
 */
app.get('/webhook', (req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
  const requestId = Date.now();

  try {
    console.log('\n============================================================');
    console.log(`📨 [${requestId}] NUEVA PETICIÓN WEBHOOK`);
    console.log('============================================================');

    const rawFrom = req.body.From || '';
    const incomingMsg = req.body.Body || '';

    // Normalizar siempre a whatsapp:+E164
    const senderNumber = normalizeWhatsAppNumber(rawFrom);

    console.log(`📥 [${requestId}] From raw: "${rawFrom}"`);
    console.log(`📥 [${requestId}] From norm: "${senderNumber}"`);
    console.log(`📥 [${requestId}] Mensaje: "${incomingMsg}"`);
    console.log(`📥 [${requestId}] Timestamp: ${new Date().toISOString()}`);

    // Registrar el último mensaje del usuario (para inactividad)
    conversationManager.createOrUpdateConversation(senderNumber, {
      phoneNumber: senderNumber,
      lastMessageAt: Date.now()
    });

    // Si estamos esperando confirmación de continuación, interceptar aquí
    const continuationReply = handleContinuationResponse(incomingMsg, senderNumber);
    if (continuationReply !== null) {
      return respondTwiML(res, continuationReply);
    }

    // Procesamiento normal
    const reply = await processMessage(incomingMsg, senderNumber);

    return respondTwiML(res, reply);
  } catch (error) {
    console.error('❌ Error en /webhook:', error);
    // Respuesta segura para no romper Twilio
    return respondTwiML(res, 'Lo siento, hubo un error. Por favor intenta de nuevo.');
  }
});

app.listen(PORT, () => {
  console.log(`✅ Bot WhatsApp corriendo en puerto ${PORT}`);
  console.log(`🕐 Ventana envío activa: ${isWithinSendWindow() ? 'SI' : 'NO'}`);

  // Schedulers
  startReminderScheduler();
  startInactivityScheduler();
});