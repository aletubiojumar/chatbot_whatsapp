// index.js - META WHATSAPP API (Sin Twilio, Sin schedulers)
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

const conversationManager = require('./conversationManager');
const { processMessage } = require('./messageHandler');
const { sendTextMessage, markMessageAsRead } = require('./sendMessage');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WhatsApp Bot with Gemini AI - Meta API',
    version: '3.0',
    timestamp: new Date().toISOString(),
    mode: process.env.BOT_MODE || 'ai',
    provider: 'Meta WhatsApp Business API'
  });
});

// Debug endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    gemini: {
      model: process.env.GEMINI_MODEL || 'not configured',
      apiKeyConfigured: !!process.env.GEMINI_API_KEY
    },
    meta: {
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || 'not configured',
      apiVersion: process.env.META_API_VERSION || 'not configured',
      accessTokenConfigured: !!process.env.META_ACCESS_TOKEN
    }
  });
});

/**
 * Webhook GET - Verificación de Meta WhatsApp
 * Meta envía esta petición para verificar tu webhook
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('\n🔐 Verificación de webhook recibida');
  console.log('   Mode:', mode);
  console.log('   Token recibido:', token);
  console.log('   Token esperado:', META_VERIFY_TOKEN);

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Token de verificación incorrecto');
    res.sendStatus(403);
  }
});

/**
 * Webhook POST - Procesar mensajes entrantes
 * Meta envía aquí todos los eventos de WhatsApp
 */
app.post('/webhook', async (req, res) => {
  const requestId = Date.now();

  try {
    console.log('\n============================================================');
    console.log(`📨 [${requestId}] WEBHOOK DE META WHATSAPP`);
    console.log('============================================================');

    const body = req.body;

    // Verificar que es una notificación de WhatsApp
    if (body.object !== 'whatsapp_business_account') {
      console.log('⚠️  No es una notificación de WhatsApp, ignorando');
      return res.sendStatus(200);
    }

    // Extraer información del mensaje
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) {
      console.log('⚠️  Sin datos en el webhook, ignorando');
      return res.sendStatus(200);
    }

    // Verificar que hay mensajes
    const messages = value.messages;
    if (!messages || messages.length === 0) {
      console.log('⚠️  Sin mensajes, probablemente es un estado de mensaje');
      return res.sendStatus(200);
    }

    // Procesar cada mensaje (usualmente es solo 1)
    for (const message of messages) {
      const messageId = message.id;
      const from = message.from; // Número del usuario (sin whatsapp:)
      const timestamp = message.timestamp;
      
      console.log(`📥 [${requestId}] Mensaje recibido`);
      console.log(`   From: ${from}`);
      console.log(`   Message ID: ${messageId}`);
      console.log(`   Timestamp: ${new Date(timestamp * 1000).toISOString()}`);

      // Marcar mensaje como leído
      try {
        await markMessageAsRead(messageId);
      } catch (error) {
        console.error('⚠️  Error marcando mensaje como leído:', error.message);
      }

      // Extraer el texto del mensaje
      let incomingText = '';
      
      if (message.type === 'text') {
        incomingText = message.text.body;
      } else if (message.type === 'button') {
        // Respuesta a un botón interactivo
        incomingText = message.button.text;
      } else if (message.type === 'interactive') {
        // Respuesta a un mensaje interactivo
        if (message.interactive.type === 'button_reply') {
          incomingText = message.interactive.button_reply.title;
        } else if (message.interactive.type === 'list_reply') {
          incomingText = message.interactive.list_reply.title;
        }
      } else {
        console.log(`⚠️  Tipo de mensaje no soportado: ${message.type}`);
        continue;
      }

      console.log(`💬 [${requestId}] Contenido: "${incomingText}"`);

      if (!incomingText || incomingText.trim().length === 0) {
        console.log(`⚠️  [${requestId}] Mensaje vacío, ignorando`);
        continue;
      }

      // Actualizar timestamp del último mensaje
      conversationManager.createOrUpdateConversation(from, {
        phoneNumber: from,
        lastMessageAt: Date.now(),
        lastUserMessageAt: Date.now()
      });

      // Procesar mensaje con IA
      console.log(`🤖 [${requestId}] Procesando con IA...`);
      const reply = await processMessage(incomingText, from);

      // Enviar respuesta
      console.log(`📤 [${requestId}] Enviando respuesta (${reply.length} chars)...`);
      await sendTextMessage(from, reply);

      console.log(`✅ [${requestId}] Respuesta enviada correctamente`);
    }

    console.log('============================================================\n');
    
    // IMPORTANTE: Responder 200 rápido a Meta
    res.sendStatus(200);

  } catch (error) {
    console.error(`❌ [${requestId}] Error en /webhook:`, error);
    console.error(`   Message:`, error.message);
    console.error(`   Stack:`, error.stack);
    
    // Siempre responder 200 a Meta para evitar reintentos
    res.sendStatus(200);
  }
});

// Endpoint para enviar mensajes manualmente (testing)
app.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({
        error: 'Faltan parámetros: to y message son requeridos'
      });
    }

    console.log('📤 Enviando mensaje manual...');
    console.log('   To:', to);
    console.log('   Message:', message);

    const result = await sendTextMessage(to, message);
    
    res.json({
      success: true,
      messageId: result.messages[0].id,
      to: to
    });

  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║     🤖 WhatsApp Bot with Gemini AI - Meta API v3.0        ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`🤖 Modo de operación: ${process.env.BOT_MODE || 'ai'}`);
  console.log(`🧠 Modelo Gemini: ${process.env.GEMINI_MODEL || 'gemini-3-flash-preview'}`);
  console.log(`📞 WhatsApp Phone ID: ${process.env.META_PHONE_NUMBER_ID || 'no configurado'}`);
  console.log(`🌐 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Verify token: ${META_VERIFY_TOKEN || 'no configurado'}`);
  console.log('');
  console.log('🔧 Provider: Meta WhatsApp Business API');
  console.log('📝 Sin schedulers - AWS Lambda maneja colas');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════\n');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('   Reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Manejo de señales de cierre
process.on('SIGTERM', () => {
  console.log('\n📴 Recibida señal SIGTERM, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n📴 Recibida señal SIGINT, cerrando servidor...');
  process.exit(0);
});

module.exports = app;