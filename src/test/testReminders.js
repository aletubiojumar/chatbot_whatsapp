const { processReminders, processEscalations } = require('../bot/reminderScheduler');

console.log('🧪 Probando sistema de recordatorios...\n');

async function test() {
  await processReminders();
  await processEscalations();
}

test().then(() => {
  console.log('\n✅ Test completado');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});