require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const MENSAJE_AUSENCIA_SID = 'HX2d68929c8110217410a2a83e05337c23';

console.log('🔍 Inspeccionando template mensaje_ausencia...\n');

client.content.v1.contents(MENSAJE_AUSENCIA_SID)
  .fetch()
  .then(content => {
    console.log('📋 Información del template:');
    console.log('   Nombre:', content.friendlyName);
    console.log('   SID:', content.sid);
    console.log('   Tipos:', Object.keys(content.types));
    console.log('\n📝 Estructura completa:');
    console.log(JSON.stringify(content.types, null, 2));
  })
  .catch(error => {
    console.error('❌ Error:', error.message);
  });