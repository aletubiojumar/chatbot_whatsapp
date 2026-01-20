require('dotenv').config();
const twilio = require('twilio');

const sid = process.argv[2];

if (!sid) {
  console.log('❌ Error: Debes proporcionar un MessageSid');
  console.log('\nUso: node checkMessageStatus.js <MessageSid>');
  process.exit(1);
}

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

(async () => {
  try {
    console.log(`🔍 Consultando mensaje: ${sid}\n`);
    
    const msg = await client.messages(sid).fetch();
    
    console.log('📊 INFORMACIÓN DEL MENSAJE:');
    console.log('─'.repeat(50));
    console.log('SID:           ', msg.sid);
    console.log('Status:        ', msg.status);
    console.log('Error Code:    ', msg.errorCode || 'ninguno');
    console.log('Error Message: ', msg.errorMessage || 'ninguno');
    console.log('From:          ', msg.from);
    console.log('To:            ', msg.to);
    console.log('Date Created:  ', msg.dateCreated);
    console.log('Date Sent:     ', msg.dateSent || 'pendiente');
    console.log('Price:         ', msg.price || 'pendiente');
    console.log('Direction:     ', msg.direction);
    console.log('─'.repeat(50));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('   Código:', error.code);
  }
})();