const fs = require('fs');
const path = require('path');

const conversationsFile = path.join(__dirname, '../../data/conversations.json');
const data = JSON.parse(fs.readFileSync(conversationsFile, 'utf8'));

const phoneNumber = 'whatsapp:+34681218907';

if (data[phoneNumber]) {
  // Limpiar campos de inactividad
  delete data[phoneNumber].continuationAskedAt;
  delete data[phoneNumber].continuationTimeoutAt;
  delete data[phoneNumber].inactivityCheckAt;
  
  // Mantener el estado actual
  data[phoneNumber].status = 'responded';
  
  fs.writeFileSync(conversationsFile, JSON.stringify(data, null, 2));
  console.log('✅ Conversación limpiada');
  console.log('Estado:', data[phoneNumber].status);
  console.log('Etapa:', data[phoneNumber].stage);
} else {
  console.log('❌ Conversación no encontrada');
}