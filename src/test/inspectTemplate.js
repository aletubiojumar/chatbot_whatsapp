require('dotenv').config();
const twilio = require('twilio');
const util = require('util');

const sid = process.argv[2];

if (!sid) {
  console.log('❌ Error: Debes proporcionar un ContentSid');
  console.log('\nUso:');
  console.log('  node inspectTemplate.js <HX...>');
  console.log('\nEjemplo:');
  console.log('  node inspectTemplate.js HX464026c7dcfabe95ba69447b02ff598e');
  process.exit(1);
}

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

(async () => {
  try {
    console.log(`🔍 Inspeccionando template: ${sid}\n`);
    
    const content = await client.content.v1.contents(sid).fetch();

    console.log('📊 INFORMACIÓN GENERAL:');
    console.log('─'.repeat(50));
    console.log('SID:           ', content.sid);
    console.log('Friendly Name: ', content.friendlyName);
    console.log('Language:      ', content.language);
    console.log('Types:         ', Object.keys(content.types || {}).join(', '));
    console.log('─'.repeat(50));

    console.log('\n📋 CONTENIDO COMPLETO:');
    console.log('─'.repeat(50));
    console.log(util.inspect(content.types, { 
      depth: 20, 
      colors: true, 
      maxArrayLength: null 
    }));
    console.log('─'.repeat(50));
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    if (e.code) console.error('   Código:', e.code);
    if (e.moreInfo) console.error('   Más info:', e.moreInfo);
    if (e.status === 404) {
      console.error('\n💡 El template no existe o el SID es incorrecto');
    }
  }
})();