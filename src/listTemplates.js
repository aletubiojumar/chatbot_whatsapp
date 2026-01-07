const { listContentTemplates } = require('./bot/sendMessage');
require('dotenv').config();

console.log('🔍 Buscando Content Templates...\n');

listContentTemplates()
  .then(() => {
    console.log('\n✅ Listado completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });