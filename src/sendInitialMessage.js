// src/sendInitialMessage.js
// Script para enviar mensaje inicial usando Meta WhatsApp API
const { sendInitialTemplate } = require('./bot/templateSender');
const conversationManager = require('./bot/conversationManager');
require('dotenv').config();

// 📌 CONFIGURACIÓN
const TO_NUMBER = process.argv[2];
const TEMPLATE_NAME = process.env.WA_TEMPLATE_INICIAL || process.env.WA_TPL_SALUDO;

// Datos del usuario (puedes pasarlos como argumentos también)
const USER_DATA = {
  direccion: process.argv[3] || process.env.DEFAULT_USER_DATA_DIRECCION || 'Calle Mayor 123, Madrid',
  fecha: process.argv[4] || process.env.DEFAULT_USER_DATA_FECHA || '15/01/2024',
  nombre: process.argv[5] || process.env.DEFAULT_USER_DATA_NOMBRE || 'Cliente'
};

// ✅ VALIDACIONES
if (!TO_NUMBER) {
  console.error('❌ Error: Debes proporcionar un número de teléfono');
  console.log('');
  console.log('📋 Uso:');
  console.log('   node src/sendInitialMessage.js <numero>');
  console.log('   node src/sendInitialMessage.js <numero> <direccion> <fecha> <nombre>');
  console.log('');
  console.log('📝 Ejemplos:');
  console.log('   node src/sendInitialMessage.js 34674742564');
  console.log('   node src/sendInitialMessage.js 34674742564 "Calle Mayor 5" "10/02/2024" "Juan Pérez"');
  console.log('');
  process.exit(1);
}

if (!TEMPLATE_NAME) {
  console.error('❌ Error: No se encontró nombre del template en .env');
  console.log('');
  console.log('💡 Agrega una de estas variables a tu .env:');
  console.log('   WA_TEMPLATE_INICIAL=saludo');
  console.log('   o');
  console.log('   WA_TPL_SALUDO=saludo');
  console.log('');
  process.exit(1);
}

// 📤 FUNCIÓN PRINCIPAL
async function send() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           ENVIAR MENSAJE INICIAL - META API                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log('📱 Número de teléfono:', TO_NUMBER);
  console.log('📨 Template:', TEMPLATE_NAME);
  console.log('');
  console.log('📋 Datos del usuario:');
  console.log('   📍 Dirección:', USER_DATA.direccion);
  console.log('   📅 Fecha:', USER_DATA.fecha);
  console.log('   👤 Nombre:', USER_DATA.nombre);
  console.log('');

  try {
    // Verificar si ya existe una conversación
    const existingConv = conversationManager.getConversation(TO_NUMBER);
    
    if (existingConv) {
      console.log('⚠️  ADVERTENCIA: Ya existe una conversación con este número');
      console.log('   Estado actual:', existingConv.status);
      console.log('   Etapa actual:', existingConv.stage);
      console.log('   Intentos:', existingConv.attempts || 0);
      console.log('');
    }

    console.log('📤 Enviando template inicial...');
    
    // Enviar template usando la función actualizada
    const result = await sendInitialTemplate(TO_NUMBER, TEMPLATE_NAME, USER_DATA);
    
    console.log('✅ Template enviado correctamente');
    console.log('   Message ID:', result.messages[0].id);
    console.log('');
    
    // Registrar conversación en el sistema
    console.log('💾 Registrando conversación...');
    conversationManager.createOrUpdateConversation(TO_NUMBER, {
      status: 'pending',
      stage: 'initial',
      attempts: 0,
      lastMessageAt: Date.now(),
      lastUserMessageAt: Date.now(),
      createdAt: Date.now(),
      userData: USER_DATA,
      history: [],
      nextReminderAt: Date.now() + (Number(process.env.REMINDER_INTERVAL_HOURS || 6) * 60 * 60 * 1000)
    });
    
    console.log('✅ Conversación registrada correctamente');
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ TODO LISTO                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('⏳ Esperando respuesta del usuario...');
    console.log('');
    console.log('📱 Cuando el usuario responda:');
    console.log('   → Gemini AI procesará el mensaje automáticamente');
    console.log('   → La conversación progresará según las respuestas');
    console.log('');
    console.log(`⏰ Si no responde en ${process.env.REMINDER_INTERVAL_HOURS || 6} horas:`);
    console.log('   → Se enviará un recordatorio automático');
    console.log('');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('');
    
    if (error.response?.data) {
      console.error('📄 Detalles del error de Meta API:');
      console.error(JSON.stringify(error.response.data, null, 2));
      console.log('');
    }
    
    console.log('💡 Posibles causas:');
    console.log('   1. El template no existe o no está aprobado en Meta');
    console.log('   2. El número no está registrado (modo prueba de Meta)');
    console.log('   3. El Access Token no es válido o expiró');
    console.log('   4. El formato del número es incorrecto');
    console.log('');
    console.log('🔧 Verificaciones:');
    console.log(`   - Template "${TEMPLATE_NAME}" existe en WhatsApp Manager`);
    console.log(`   - Número ${TO_NUMBER} está en formato: 34XXXXXXXXX (sin +)`);
    console.log('   - Access Token es válido en .env');
    console.log('   - Phone Number ID es correcto en .env');
    console.log('');
    
    throw error;
  }
}

// 🚀 EJECUCIÓN
send()
  .then(() => {
    console.log('🎉 Script finalizado exitosamente\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 El script finalizó con errores\n');
    process.exit(1);
  });