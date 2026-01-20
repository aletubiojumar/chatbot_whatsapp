#!/usr/bin/env node

/**
 * Script de Prueba de Envío
 * Verifica que los mensajes se envían correctamente
 */

require('dotenv').config();
const twilio = require('twilio');

const NUMERO_DESTINO = process.argv[2];

if (!NUMERO_DESTINO) {
  console.log('❌ Error: Debes proporcionar un número de destino');
  console.log('\nUso:');
  console.log('  node test_envio.js whatsapp:+34XXXXXXXXX');
  console.log('\nEjemplo:');
  console.log('  node test_envio.js whatsapp:+34666555444');
  process.exit(1);
}

console.log('\n🧪 PRUEBA DE ENVÍO DE MENSAJES WHATSAPP\n');
console.log('═'.repeat(80));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

// ==========================================
// TEST 1: Mensaje de texto simple
// ==========================================
async function test1_mensajeTextoSimple() {
  console.log('\n📝 TEST 1: Mensaje de texto simple\n');
  
  try {
    const message = await client.messages.create({
      from: FROM_NUMBER,
      to: NUMERO_DESTINO,
      body: '🧪 Test 1: Mensaje de texto simple - Si recibes esto, la conexión funciona ✅'
    });
    
    console.log('✅ Mensaje enviado correctamente');
    console.log(`   SID: ${message.sid}`);
    console.log(`   Status: ${message.status}`);
    console.log(`   Fecha: ${message.dateCreated}`);
    
    // Esperar 3 segundos y verificar estado
    await new Promise(resolve => setTimeout(resolve, 3000));
    const updated = await client.messages(message.sid).fetch();
    
    console.log(`\n📊 Estado actualizado:`);
    console.log(`   Status: ${updated.status}`);
    console.log(`   Error Code: ${updated.errorCode || 'Ninguno'}`);
    console.log(`   Error Message: ${updated.errorMessage || 'Ninguno'}`);
    console.log(`   Price: ${updated.price || 'Pendiente'}`);
    
    if (updated.status === 'failed' || updated.errorCode) {
      console.log('\n❌ El mensaje FALLÓ');
      console.log(`   Razón: ${updated.errorMessage || 'Desconocida'}`);
      return false;
    } else if (updated.status === 'delivered') {
      console.log('\n✅ Mensaje ENTREGADO con éxito');
      return true;
    } else if (updated.status === 'sent' || updated.status === 'queued') {
      console.log('\n⏳ Mensaje enviado pero aún no entregado');
      console.log('   (Puede tardar unos segundos en llegar)');
      return true;
    }
    
    return true;
  } catch (error) {
    console.log('\n❌ Error en Test 1:');
    console.log(`   Mensaje: ${error.message}`);
    if (error.code) console.log(`   Código: ${error.code}`);
    if (error.moreInfo) console.log(`   Más info: ${error.moreInfo}`);
    return false;
  }
}

// ==========================================
// TEST 2: Template con botones
// ==========================================
async function test2_templateConBotones() {
  console.log('\n\n📋 TEST 2: Template con botones (mensaje_saludo_card)\n');
  
  try {
    const CONTENT_SID = process.env.CONTENT_SID;
    
    console.log(`   Usando template: ${CONTENT_SID}`);
    
    const message = await client.messages.create({
      from: FROM_NUMBER,
      to: NUMERO_DESTINO,
      contentSid: CONTENT_SID,
      contentVariables: '{}'
    });
    
    console.log('✅ Template enviado correctamente');
    console.log(`   SID: ${message.sid}`);
    console.log(`   Status: ${message.status}`);
    
    // Esperar 3 segundos y verificar estado
    await new Promise(resolve => setTimeout(resolve, 3000));
    const updated = await client.messages(message.sid).fetch();
    
    console.log(`\n📊 Estado actualizado:`);
    console.log(`   Status: ${updated.status}`);
    console.log(`   Error Code: ${updated.errorCode || 'Ninguno'}`);
    console.log(`   Error Message: ${updated.errorMessage || 'Ninguno'}`);
    
    if (updated.status === 'failed' || updated.errorCode) {
      console.log('\n❌ El template FALLÓ');
      console.log(`   Razón: ${updated.errorMessage || 'Desconocida'}`);
      
      if (updated.errorCode === '63016') {
        console.log('\n💡 POSIBLE CAUSA: Template no aprobado por Meta');
        console.log('   → Los templates con botones requieren aprobación (24-48h)');
        console.log('   → Verifica el estado en: https://business.facebook.com/');
      }
      
      return false;
    } else if (updated.status === 'delivered') {
      console.log('\n✅ Template ENTREGADO con éxito');
      return true;
    } else if (updated.status === 'sent' || updated.status === 'queued') {
      console.log('\n⏳ Template enviado pero aún no entregado');
      return true;
    }
    
    return true;
  } catch (error) {
    console.log('\n❌ Error en Test 2:');
    console.log(`   Mensaje: ${error.message}`);
    if (error.code) console.log(`   Código: ${error.code}`);
    if (error.moreInfo) console.log(`   Más info: ${error.moreInfo}`);
    
    if (error.code === 63016) {
      console.log('\n💡 Template no aprobado o pausado en Meta');
      console.log('   1. Ve a Meta Business Manager');
      console.log('   2. Busca tus templates de WhatsApp');
      console.log('   3. Verifica que estén en estado "Approved"');
    }
    
    return false;
  }
}

// ==========================================
// TEST 3: Verificar número de destino
// ==========================================
async function test3_verificarNumero() {
  console.log('\n\n🔍 TEST 3: Verificando número de destino\n');
  
  // Verificar formato
  if (!NUMERO_DESTINO.startsWith('whatsapp:+')) {
    console.log('⚠️  Formato de número sospechoso');
    console.log(`   Actual: ${NUMERO_DESTINO}`);
    console.log('   Esperado: whatsapp:+[código país][número]');
    console.log('   Ejemplo: whatsapp:+34666555444');
    return false;
  }
  
  console.log('✅ Formato del número correcto');
  console.log(`   Número: ${NUMERO_DESTINO}`);
  
  // Verificar si el número de origen requiere registro
  if (FROM_NUMBER === 'whatsapp:+14155238886') {
    console.log('\n⚠️  IMPORTANTE: Estás usando Twilio Sandbox');
    console.log('   El número destino DEBE estar registrado primero');
    console.log('\n📱 Para registrar el número:');
    console.log('   1. Desde WhatsApp, envía un mensaje a: +1 415 523 8886');
    console.log('   2. El mensaje debe ser: join [tu-código-sandbox]');
    console.log('   3. Espera confirmación de Twilio');
    console.log('\n💡 Encuentra tu código en:');
    console.log('   https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn');
  }
  
  return true;
}

// ==========================================
// TEST 4: Verificar aprobación de templates en Meta
// ==========================================
async function test4_verificarTemplatesAprobados() {
  console.log('\n\n📋 TEST 4: Verificando estado de templates en Meta\n');
  
  console.log('ℹ️  Los templates de WhatsApp tienen ciclo de vida:');
  console.log('   1. PENDING - En revisión por Meta (24-48h)');
  console.log('   2. APPROVED - Aprobado, listo para usar ✅');
  console.log('   3. REJECTED - Rechazado, necesita modificación ❌');
  console.log('   4. PAUSED - Pausado por bajo rendimiento');
  
  console.log('\n💡 Para verificar el estado real:');
  console.log('   1. Ve a: https://business.facebook.com/');
  console.log('   2. Selecciona tu cuenta de WhatsApp Business');
  console.log('   3. Busca "Message Templates"');
  console.log('   4. Verifica que todos estén "APPROVED"');
  
  console.log('\n⚠️  NOTA IMPORTANTE:');
  console.log('   Twilio muestra los templates aunque Meta los rechace.');
  console.log('   Debes verificar en Meta Business Manager el estado real.');
  
  return true;
}

// ==========================================
// EJECUTAR TESTS
// ==========================================
(async () => {
  console.log(`\n🎯 Número destino: ${NUMERO_DESTINO}`);
  console.log(`📤 Número origen: ${FROM_NUMBER}\n`);
  console.log('═'.repeat(80));
  
  const test1 = await test1_mensajeTextoSimple();
  
  if (!test1) {
    console.log('\n\n⛔ Test 1 FALLÓ - No se puede continuar');
    console.log('   → El problema está en la conexión básica con WhatsApp');
    process.exit(1);
  }
  
  const test2 = await test2_templateConBotones();
  const test3 = await test3_verificarNumero();
  const test4 = await test4_verificarTemplatesAprobados();
  
  // Resumen
  console.log('\n\n═'.repeat(80));
  console.log('\n📊 RESUMEN DE PRUEBAS\n');
  
  console.log(`Test 1 (Texto simple):    ${test1 ? '✅ PASÓ' : '❌ FALLÓ'}`);
  console.log(`Test 2 (Template):        ${test2 ? '✅ PASÓ' : '❌ FALLÓ'}`);
  console.log(`Test 3 (Número):          ${test3 ? '✅ PASÓ' : '⚠️  REVISAR'}`);
  console.log(`Test 4 (Aprobación Meta): ℹ️  VERIFICAR MANUALMENTE`);
  
  console.log('\n═'.repeat(80));
  
  if (test1 && test2) {
    console.log('\n🎉 ¡TODOS LOS TESTS PASARON!');
    console.log('   Tu bot debería funcionar correctamente');
    console.log('\n🚀 Siguiente paso:');
    console.log('   node src/bot/index.js');
  } else if (test1 && !test2) {
    console.log('\n⚠️  Los mensajes simples funcionan pero los templates fallan');
    console.log('\n🔍 CAUSA MÁS PROBABLE:');
    console.log('   → Los templates NO están aprobados por Meta');
    console.log('\n✅ SOLUCIÓN:');
    console.log('   1. Verifica en Meta Business Manager el estado');
    console.log('   2. Si están "PENDING", espera 24-48h');
    console.log('   3. Si están "REJECTED", modifícalos y reenvía');
    console.log('   4. Mientras tanto, usa solo mensajes de texto');
  } else {
    console.log('\n❌ HAY PROBLEMAS DE CONEXIÓN');
    console.log('\n🔍 REVISA:');
    console.log('   1. Que el número destino esté registrado (si usas Sandbox)');
    console.log('   2. Que tu cuenta de WhatsApp Business esté activa');
    console.log('   3. Que no hayas excedido los límites de envío');
  }
  
  console.log('\n═'.repeat(80) + '\n');
})();