const conversationManager = require('../bot/conversationManager');

const phoneNumber = process.argv[2] || 'whatsapp:+34681218907';

console.log('\n📊 Estado de la conversación para:', phoneNumber);
console.log('='.repeat(60));

const conv = conversationManager.getConversation(phoneNumber);

if (!conv) {
  console.log('❌ No existe conversación para este número');
  process.exit(0);
}

console.log('\n📱 Información básica:');
console.log('   Estado:', conv.status);
console.log('   Etapa:', conv.stage);
console.log('   Intentos:', conv.attempts || 0);

if (conv.responses && conv.responses.length > 0) {
  const userMessages = conv.responses.filter(r => r.type === 'user');
  if (userMessages.length > 0) {
    const lastUserMsg = userMessages[userMessages.length - 1];
    const timeSince = Math.floor((Date.now() - lastUserMsg.timestamp) / 1000);
    console.log('   Último mensaje del USUARIO hace:', timeSince, 'segundos');
    console.log('   Fecha:', new Date(lastUserMsg.timestamp).toLocaleString());
  }
  
  console.log('\n📝 Últimos 3 mensajes:');
  const last3 = conv.responses.slice(-3);
  last3.forEach(r => {
    const tipo = r.type === 'user' ? '👤 Usuario' : '🤖 Bot';
    const time = new Date(r.timestamp).toLocaleTimeString();
    console.log(`   [${time}] ${tipo}: ${r.message.substring(0, 50)}...`);
  });
}