// debug_inactividad.js
require('dotenv').config();
const conversationManager = require('../bot/conversationManager');

const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // 1 minuto

function isInactivityEligible(conv) {
  if (!conv) return false;
  if (!conv.lastMessageAt) return false;

  if (conv.status === 'completed' || conv.status === 'escalated') return false;
  if (conv.status === 'awaiting_continuation') return false;
  if (conv.status === 'awaiting_admin_offer') return false;

  return true;
}

console.log('🔍 DEBUG DE INACTIVIDAD');
console.log('======================\n');

const all = conversationManager.getConversations();
const conversations = Object.values(all);

console.log(`Total de conversaciones: ${conversations.length}\n`);

for (const conv of conversations) {
  console.log(`📱 Conversación: ${conv.phoneNumber}`);
  console.log(`   Estado: ${conv.status}`);
  console.log(`   Etapa: ${conv.stage}`);
  console.log(`   lastMessageAt: ${conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString() : 'NO DEFINIDO'}`);
  
  if (conv.lastMessageAt) {
    const elapsed = Date.now() - conv.lastMessageAt;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`   Tiempo transcurrido: ${seconds} segundos`);
    console.log(`   ¿Mayor a 60s?: ${elapsed >= INACTIVITY_TIMEOUT ? 'SÍ' : 'NO'}`);
  }
  
  const eligible = isInactivityEligible(conv);
  console.log(`   ¿Es elegible?: ${eligible ? 'SÍ' : 'NO'}`);
  
  if (!eligible) {
    if (!conv.lastMessageAt) console.log(`   → Razón: No tiene lastMessageAt`);
    if (conv.status === 'completed') console.log(`   → Razón: Estado 'completed'`);
    if (conv.status === 'escalated') console.log(`   → Razón: Estado 'escalated'`);
    if (conv.status === 'awaiting_continuation') console.log(`   → Razón: Estado 'awaiting_continuation'`);
    if (conv.status === 'awaiting_admin_offer') console.log(`   → Razón: Estado 'awaiting_admin_offer'`);
  }
  
  console.log('');
}

// Filtrar inactivas
const now = Date.now();
const inactive = conversations.filter(conv => {
  if (!isInactivityEligible(conv)) return false;
  if (!conv.lastMessageAt) return false;
  const elapsed = now - conv.lastMessageAt;
  return elapsed >= INACTIVITY_TIMEOUT;
});

console.log(`\n📊 RESULTADO:`);
console.log(`   Conversaciones inactivas detectadas: ${inactive.length}`);

if (inactive.length > 0) {
  console.log('\n✅ Estas conversaciones DEBERÍAN recibir mensaje de ausencia:');
  inactive.forEach(c => {
    console.log(`   - ${c.phoneNumber} (${c.status} / ${c.stage})`);
  });
} else {
  console.log('\n❌ No se detectaron conversaciones inactivas');
  console.log('\nPosibles razones:');
  console.log('   1. lastMessageAt se actualizó hace menos de 60 segundos');
  console.log('   2. El estado no es elegible (completed, escalated, etc.)');
  console.log('   3. lastMessageAt no está definido');
}