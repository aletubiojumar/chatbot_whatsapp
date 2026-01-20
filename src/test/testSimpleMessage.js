require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendTest() {
  try {
    console.log('📤 Enviando mensaje de texto simple...');
    
    const message = await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.argv[2],
      body: '🤖 Mensaje de prueba del bot. ¿Puedes verme?'
    });
    
    console.log('✅ Mensaje enviado:', message.sid);
    console.log('   Status:', message.status);
    
    // Esperar 5 segundos y verificar status actualizado
    setTimeout(async () => {
      try {
        const updated = await client.messages(message.sid).fetch();
        console.log('\n📊 Status actualizado después de 5s:');
        console.log('   Status:', updated.status);
        console.log('   Error Code:', updated.errorCode || 'ninguno');
        console.log('   Error Message:', updated.errorMessage || 'ninguno');
      } catch (e) {
        console.error('❌ Error al verificar status:', e.message);
      }
    }, 5000);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('   Código:', error.code);
    if (error.moreInfo) console.error('   Más info:', error.moreInfo);
  }
}

sendTest();