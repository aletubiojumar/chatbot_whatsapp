const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const { processMessage, generateTwiMLResponse } = require('./messageHandler');

const app = express();
const PORT = process.env.PORT || 3000;

const { startReminderScheduler } = require('./reminderScheduler');

// Iniciar el scheduler de recordatorios
startReminderScheduler();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Ruta de salud (health check)
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'WhatsApp Bot está funcionando',
    timestamp: new Date().toISOString()
  });
});

// Webhook principal para recibir mensajes de Twilio
app.post('/webhook', (req, res) => {
  try {
    const incomingMessage = req.body.Body || '';
    const senderNumber = req.body.From || '';
    
    // Procesar el mensaje
    const responseText = processMessage(incomingMessage, senderNumber);
    
    // Generar respuesta TwiML
    const twimlResponse = generateTwiMLResponse(responseText);
    
    // Enviar respuesta
    res.type('text/xml');
    res.send(twimlResponse);
    
  } catch (error) {
    console.error('Error procesando mensaje:', error);
    
    const errorResponse = generateTwiMLResponse('Lo siento, hubo un error. Por favor intenta de nuevo.');
    res.type('text/xml');
    res.send(errorResponse);
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`\n⚠️  Recuerda: Necesitas ngrok para exponer este servidor a internet`);
});