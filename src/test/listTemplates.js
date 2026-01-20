const { listContentTemplates } = require('../bot/sendMessage');
require('dotenv').config();

console.log('🔍 Buscando Content Templates...\n');

listContentTemplates({ pageSize: 50, limit: 200 })
  .then(() => {
    console.log('\n✅ Listado completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('   Código Twilio:', error.code);
    if (error.moreInfo) console.error('   Más info:', error.moreInfo);
    process.exit(1);
  });
