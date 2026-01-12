require('dotenv').config();
const { processInactiveConversations } = require('../bot/inactivityHandler');

console.log('🔍 Forzando procesamiento de conversaciones inactivas...\n');

// Verificar que las credenciales se cargaron
if (!process.env.TWILIO_ACCOUNT_SID) {
  console.error('❌ Error: No se cargaron las credenciales de Twilio');
  console.log('Verifica que el archivo .env existe en:', __dirname);
  process.exit(1);
}

console.log('✅ Credenciales cargadas correctamente\n');

processInactiveConversations()
  .then(() => {
    console.log('\n✅ Procesamiento completado');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });