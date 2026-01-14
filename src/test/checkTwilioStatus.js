require('dotenv').config();
const twilio = require('twilio');

const sid = process.argv[2];
if (!sid) {
  console.log('Uso: node src/test/checkTwilioStatus.js <MessageSid>');
  process.exit(1);
}

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

(async () => {
  const msg = await client.messages(sid).fetch();
  console.log({
    sid: msg.sid,
    status: msg.status,
    errorCode: msg.errorCode,
    errorMessage: msg.errorMessage,
    to: msg.to,
    from: msg.from,
    dateCreated: msg.dateCreated
  });
})();
