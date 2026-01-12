const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../data/conversations.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const conv = data['whatsapp:+34681218907'];

console.log('\n🔍 DEBUG - Estado completo de la conversación:\n');
console.log('phoneNumber:', conv.phoneNumber);
console.log('status:', conv.status);
console.log('stage:', conv.stage);
console.log('lastMessageAt:', conv.lastMessageAt, '→', new Date(conv.lastMessageAt).toLocaleString());
console.log('continuationAskedAt:', conv.continuationAskedAt);
console.log('inactivityCheckAt:', conv.inactivityCheckAt);

if (conv.responses) {
  console.log('\n📝 Mensajes (últimos 5):');
  const last5 = conv.responses.slice(-5);
  last5.forEach(r => {
    const time = new Date(r.timestamp).toLocaleTimeString();
    const tipo = r.type === 'user' ? '👤' : '🤖';
    console.log(`  [${time}] ${tipo} ${r.message.substring(0, 40)}`);
  });
  
  const userMsgs = conv.responses.filter(r => r.type === 'user');
  if (userMsgs.length > 0) {
    const last = userMsgs[userMsgs.length - 1];
    const diff = Date.now() - last.timestamp;
    console.log('\n⏱️  Último mensaje del USUARIO:');
    console.log('   Hace:', Math.floor(diff / 1000), 'segundos');
    console.log('   Timestamp:', last.timestamp);
  }
}