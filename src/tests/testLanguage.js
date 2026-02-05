// src/tests/testLanguage.js
// Script para probar diferentes códigos de idioma
require('dotenv').config();
const { sendTemplateMessage, normalizePhoneNumber } = require('../bot/sendMessage');

const TO_NUMBER = process.argv[2] || '34674742564';
const TEMPLATE_NAME = 'saludo';

// Códigos de idioma posibles para Spanish
const LANGUAGE_CODES = [
  'es',
  'es_ES',
  'es_MX',
  'es_AR',
  'es_CO',
  'spanish',
  'Spanish',
  'SPANISH'
];

async function testLanguageCodes() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║    PROBAR CÓDIGOS DE IDIOMA PARA TEMPLATE "saludo"        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const to = normalizePhoneNumber(TO_NUMBER);
  console.log(`📱 Número: ${to}`);
  console.log(`📨 Template: ${TEMPLATE_NAME}`);
  console.log(`🧪 Probando ${LANGUAGE_CODES.length} códigos de idioma...\n`);

  for (const langCode of LANGUAGE_CODES) {
    console.log(`\n🔍 Intentando con: "${langCode}"`);
    
    try {
      await sendTemplateMessage(to, TEMPLATE_NAME, langCode, []);
      
      console.log(`✅ ¡ÉXITO! El código correcto es: "${langCode}"`);
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║                    ✅ CÓDIGO ENCONTRADO                     ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`💡 Actualiza templateSender.js para usar: languageCode = "${langCode}"`);
      console.log('');
      console.log('📝 En la línea donde llamas sendTemplateMessage, cambia:');
      console.log(`   return sendTemplateMessage(to, template, '${langCode}', components);`);
      console.log('');
      process.exit(0);
      
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.log(`   ❌ Falló: ${errorMsg.substring(0, 80)}...`);
    }
    
    // Esperar 1 segundo entre intentos para no saturar la API
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              ❌ NINGÚN CÓDIGO FUNCIONÓ                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('💡 Esto significa que el template "saludo" aún no está disponible');
  console.log('   en la API de WhatsApp Business.');
  console.log('');
  console.log('🔧 Soluciones:');
  console.log('   1. Espera 24-48 horas y vuelve a intentar');
  console.log('   2. Verifica que el template esté en estado "Aprobado"');
  console.log('   3. Contacta soporte de Meta WhatsApp');
  console.log('   4. Prueba con otro template que ya tengas funcionando');
  console.log('');
  
  process.exit(1);
}

testLanguageCodes().catch(error => {
  console.error('\n💥 Error inesperado:', error.message);
  process.exit(1);
});