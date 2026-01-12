require('dotenv').config();
const conversationManager = require('../bot/conversationManager');

const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // 1 minuto

console.log('🔍 DEBUG - Buscando conversaciones inactivas\n');

const conversations = conversationManager.getInactiveConversations(INACTIVITY_TIMEOUT);

console.log('Conversaciones encontradas:', conversations.length);

if (conversations.length === 0) {
  console.log('\n⚠️  No se encontraron conversaciones inactivas');
  console.log('Verificando manualmente...\n');
  
  const allConvs = Object.values(conversationManager.getConversations());
  console.log('Total de conversaciones:', allConvs.length);
  
  allConvs.forEach(conv => {
    console.log('\n📱', conv.phoneNumber);
    console.log('   status:', conv.status);
    console.log('   stage:', conv.stage);
    console.log('   continuationAskedAt:', conv.continuationAskedAt);
    console.log('   inactivityCheckAt:', conv.inactivityCheckAt);
    
    if (conv.responses) {
      const userMsgs = conv.responses.filter(r => r.type === 'user');
      if (userMsgs.length > 0) {
        const last = userMsgs[userMsgs.length - 1];
        const diff = Date.now() - last.timestamp;
        console.log('   Último msg usuario hace:', Math.floor(diff / 1000), 'seg');
        console.log('   ¿Inactivo?:', diff >= INACTIVITY_TIMEOUT);
      }
    }
  });
} else {
  console.log('\n✅ Conversaciones inactivas:');
  conversations.forEach(c => console.log('  -', c.phoneNumber));
}