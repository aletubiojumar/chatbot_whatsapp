const fs = require('fs');
const path = require('path');

const conversationsFile = path.join(__dirname, '../../data/conversations.json');
const data = JSON.parse(fs.readFileSync(conversationsFile, 'utf8'));

const phoneNumber = 'whatsapp:+34681218907';
const conv = data[phoneNumber];

if (!conv) {
  console.log('❌ No existe conversación');
  process.exit(0);
}

console.log('\n📊 Estado actual:');
console.log('   Estado:', conv.status);
console.log('   Etapa:', conv.stage);

if (conv.responses && conv.responses.length > 0) {
  const userMessages = conv.responses.filter(r => r.type === 'user');
  if (userMessages.length > 0) {
    const lastUserMsg = userMessages[userMessages.length - 1];
    const timeSinceSeconds = Math.floor((Date.now() - lastUserMsg.timestamp) / 1000);
    const timeSinceMinutes = Math.floor(timeSinceSeconds / 60);
    
    console.log('\n⏱️  Tiempo desde último mensaje del usuario:');
    console.log('   ', timeSinceSeconds, 'segundos (', timeSinceMinutes, 'minutos)');
    console.log('   Mensaje:', lastUserMsg.message.substring(0, 30));
    console.log('   Hora:', new Date(lastUserMsg.timestamp).toLocaleTimeString());
  }
}

// Verificar si debería detectarse como inactiva
const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // 1 minuto
const userMsgs = conv.responses?.filter(r => r.type === 'user') || [];
if (userMsgs.length > 0) {
  const lastMsg = userMsgs[userMsgs.length - 1];
  const isInactive = (Date.now() - lastMsg.timestamp) >= INACTIVITY_TIMEOUT;
  
  console.log('\n🔍 Análisis de inactividad:');
  console.log('   ¿Debería detectarse como inactiva?:', isInactive ? '✅ SÍ' : '❌ NO');
  console.log('   Estado actual:', conv.status);
  console.log('   ¿Estado permite detección?:', 
    conv.status !== 'completed' && 
    conv.status !== 'escalated' && 
    conv.status !== 'awaiting_continuation' &&
    conv.status !== 'pending' ? '✅ SÍ' : '❌ NO'
  );
}

console.log('\n');