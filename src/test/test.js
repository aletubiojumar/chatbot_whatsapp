#!/usr/bin/env node
/**
 * 🧪 SUITE COMPLETA DE TESTING Y DIAGNÓSTICO
 * 
 * Uso:
 *   node test.js                    # Menú interactivo
 *   node test.js --config           # Verificar configuración
 *   node test.js --conv             # Ver estado de conversaciones
 *   node test.js --send             # Enviar mensaje de prueba
 *   node test.js --templates        # Verificar templates de Twilio
 *   node test.js --inactivity       # Probar sistema de inactividad
 *   node test.js --admin            # Probar oferta de administración
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PHONE_TEST = process.env.TEST_PHONE_NUMBER || 'whatsapp:+34681218907';

// ============================================================================
// UTILIDADES
// ============================================================================

function printHeader(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

function printSection(title) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

// ============================================================================
// TEST 1: CONFIGURACIÓN DE TWILIO
// ============================================================================

function testConfig() {
  printHeader('🔍 VERIFICACIÓN DE CONFIGURACIÓN');

  const requiredVars = {
    'TWILIO_ACCOUNT_SID': 'Account SID de Twilio',
    'TWILIO_AUTH_TOKEN': 'Auth Token de Twilio',
    'TWILIO_FROM_NUMBER': 'Número de WhatsApp de origen'
  };

  const contentSids = {
    'CONTENT_SID': 'mensaje1_v2 (inicial)',
    'MENSAJE2_SID': 'mensaje2 (verificación)',
    'MENSAJE4_SID': 'mensaje4 (quién atenderá)',
    'MENSAJE_CORREGIR_SID': 'mensaje_corregir (correcciones)',
    'MENSAJE_CITA_SID': 'mensaje_cita (tipo de cita)',
    'MENSAJE_AUSENCIA_SID': 'mensaje_ausencia (continuación)',
    'MENSAJE_GRAVEDAD_SID': 'mensaje_gravedad (nivel gravedad)'
  };

  let errores = 0;

  printSection('📋 Variables Requeridas');
  for (const [varName, description] of Object.entries(requiredVars)) {
    const value = process.env[varName];
    if (!value) {
      console.log(`❌ ${varName}: NO CONFIGURADA`);
      console.log(`   → ${description}`);
      errores++;
    } else {
      const masked = varName.includes('TOKEN')
        ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`✅ ${varName}: ${masked}`);
    }
  }

  printSection('📬 Content SIDs (Templates)');
  for (const [varName, description] of Object.entries(contentSids)) {
    const value = process.env[varName];
    if (!value) {
      console.log(`⚠️  ${varName}: NO CONFIGURADO`);
      console.log(`   → ${description}`);
    } else if (!value.startsWith('HX')) {
      console.log(`❌ ${varName}: INVÁLIDO (debe empezar con HX)`);
      console.log(`   Valor actual: ${value}`);
      errores++;
    } else {
      console.log(`✅ ${varName}: ${value}`);
      console.log(`   → ${description}`);
    }
  }

  printSection('📞 Formato de Número');
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (fromNumber && fromNumber.startsWith('whatsapp:')) {
    console.log(`✅ Formato correcto: ${fromNumber}`);
  } else {
    console.log(`❌ Debe empezar con "whatsapp:" - Valor: ${fromNumber}`);
    errores++;
  }

  console.log('\n' + '='.repeat(70));
  if (errores === 0) {
    console.log('✅ CONFIGURACIÓN CORRECTA');
  } else {
    console.log(`❌ SE ENCONTRARON ${errores} ERROR(ES)`);
  }
  console.log('='.repeat(70) + '\n');

  return errores === 0;
}

// ============================================================================
// TEST 2: ESTADO DE CONVERSACIONES
// ============================================================================

function testConversations() {
  printHeader('📊 ESTADO DE CONVERSACIONES');

  const conversationsFile = path.join(__dirname, '../../data/conversations.json');
  
  if (!fs.existsSync(conversationsFile)) {
    console.log('⚠️  No existe archivo conversations.json');
    console.log('   Ubicación esperada:', conversationsFile);
    return;
  }

  const data = JSON.parse(fs.readFileSync(conversationsFile, 'utf8'));
  const conversations = Object.values(data);

  console.log(`Total de conversaciones: ${conversations.length}\n`);

  if (conversations.length === 0) {
    console.log('ℹ️  No hay conversaciones registradas');
    return;
  }

  // Mostrar conversación de test
  const testConv = data[PHONE_TEST];
  
  if (testConv) {
    printSection(`📱 Conversación de Test: ${PHONE_TEST}`);
    console.log('Estado:', testConv.status);
    console.log('Etapa:', testConv.stage);
    console.log('Intentos:', testConv.attempts || 0);
    console.log('Último prompt:', testConv.lastPromptType || 'N/A');

    if (testConv.continuationAskedAt) {
      console.log('⚠️  Esperando continuación desde:', new Date(testConv.continuationAskedAt).toLocaleString());
    }

    if (testConv.inactivityCheckAt) {
      console.log('⏰ Próxima verificación inactividad:', new Date(testConv.inactivityCheckAt).toLocaleString());
    }

    if (testConv.responses && testConv.responses.length > 0) {
      const userMessages = testConv.responses.filter(r => r.type === 'user');
      if (userMessages.length > 0) {
        const lastUserMsg = userMessages[userMessages.length - 1];
        const timeSince = Math.floor((Date.now() - lastUserMsg.timestamp) / 1000);
        const minutes = Math.floor(timeSince / 60);
        
        console.log(`\n⏱️  Último mensaje del usuario:`);
        console.log(`   Hace: ${minutes} minutos (${timeSince} segundos)`);
        console.log(`   Mensaje: "${lastUserMsg.message.substring(0, 50)}..."`);
        console.log(`   Fecha: ${new Date(lastUserMsg.timestamp).toLocaleString()}`);

        // Análisis de inactividad
        const INACTIVITY_TIMEOUT = 1 * 60 * 1000; // 1 minuto
        const isInactive = timeSince * 1000 >= INACTIVITY_TIMEOUT;
        const canDetect = testConv.status !== 'completed' &&
                         testConv.status !== 'escalated' &&
                         testConv.status !== 'awaiting_continuation' &&
                         testConv.status !== 'pending';

        console.log(`\n🔍 Análisis de Inactividad:`);
        console.log(`   ¿Inactivo? ${isInactive ? '✅ SÍ' : '❌ NO'} (timeout: 1 min)`);
        console.log(`   ¿Se detectaría? ${canDetect ? '✅ SÍ' : '❌ NO'} (estado permite detección)`);
      }

      console.log(`\n📝 Últimos 5 mensajes:`);
      const last5 = testConv.responses.slice(-5);
      last5.forEach(r => {
        const time = new Date(r.timestamp).toLocaleTimeString();
        const tipo = r.type === 'user' ? '👤 Usuario' : '🤖 Bot';
        const msg = r.message.length > 50 ? r.message.substring(0, 50) + '...' : r.message;
        console.log(`   [${time}] ${tipo}: ${msg}`);
      });
    }
  } else {
    console.log(`⚠️  No existe conversación para ${PHONE_TEST}`);
  }

  // Resumen general
  printSection('📈 Resumen General');
  const byStatus = {};
  conversations.forEach(c => {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  });

  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });
}

// ============================================================================
// TEST 3: ENVÍO DE TEMPLATE
// ============================================================================

async function testSendTemplate() {
  printHeader('📤 TEST DE ENVÍO DE TEMPLATE');

  const { sendTemplateMessage } = require('../bot/sendMessage');
  const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
  const CONTENT_SID = process.env.CONTENT_SID;

  if (!CONTENT_SID) {
    console.log('❌ Error: CONTENT_SID no configurado en .env');
    return false;
  }

  console.log('Enviando mensaje inicial...');
  console.log('   De:', FROM_NUMBER);
  console.log('   Para:', PHONE_TEST);
  console.log('   ContentSid:', CONTENT_SID);
  console.log('');

  try {
    const result = await sendTemplateMessage(PHONE_TEST, FROM_NUMBER, CONTENT_SID);
    console.log('✅ Template enviado correctamente');
    console.log('   Message SID:', result.sid || result.body?.sid);
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code) console.error('   Código Twilio:', error.code);
    if (error.moreInfo) console.error('   Más info:', error.moreInfo);
    return false;
  }
}

// ============================================================================
// TEST 4: VERIFICAR TEMPLATES EN TWILIO
// ============================================================================

async function testTemplates() {
  printHeader('📋 VERIFICACIÓN DE TEMPLATES EN TWILIO');

  const twilio = require('twilio');
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid, authToken);

  const templates = {
    'CONTENT_SID': 'mensaje1_v2',
    'MENSAJE2_SID': 'mensaje2',
    'MENSAJE4_SID': 'mensaje4',
    'MENSAJE_CORREGIR_SID': 'mensaje_corregir',
    'MENSAJE_CITA_SID': 'mensaje_cita',
    'MENSAJE_AUSENCIA_SID': 'mensaje_ausencia',
    'MENSAJE_GRAVEDAD_SID': 'mensaje_gravedad'
  };

  for (const [envVar, name] of Object.entries(templates)) {
    const sid = process.env[envVar];
    
    if (!sid) {
      console.log(`⚠️  ${name}: No configurado (${envVar})`);
      continue;
    }

    try {
      const content = await client.content.v1.contents(sid).fetch();
      console.log(`✅ ${name} (${envVar})`);
      console.log(`   SID: ${content.sid}`);
      console.log(`   Nombre: ${content.friendlyName}`);
      console.log(`   Tipos: ${Object.keys(content.types).join(', ')}`);
    } catch (error) {
      console.log(`❌ ${name} (${envVar})`);
      console.log(`   SID: ${sid}`);
      console.log(`   Error: ${error.message}`);
    }
    console.log('');
  }
}

// ============================================================================
// TEST 5: SISTEMA DE INACTIVIDAD
// ============================================================================

async function testInactivity() {
  printHeader('⏰ TEST DE SISTEMA DE INACTIVIDAD');

  const { processInactiveConversations } = require('../bot/inactivityHandler');
  const conversationManager = require('../bot/conversationManager');

  console.log('Forzando procesamiento de conversaciones inactivas...\n');

  try {
    await processInactiveConversations();
    console.log('\n✅ Procesamiento completado');
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    return false;
  }
}

// ============================================================================
// TEST 6: OFERTA DE ADMINISTRACIÓN
// ============================================================================

function testAdminOffer() {
  printHeader('🤝 TEST DE OFERTA DE ADMINISTRACIÓN');

  const conversationManager = require('../bot/conversationManager');
  const { processMessage } = require('../bot/messageHandler');

  // Caso 1: Venimos de botones y usuario escribe algo raro
  printSection('Caso 1: BOTONES + texto no válido (debe ofrecer admin)');
  
  conversationManager.createOrUpdateConversation(PHONE_TEST, {
    stage: 'attendee_select',
    status: 'responded',
    lastPromptType: 'buttons',
    responses: []
  });

  const r1 = processMessage('Hola, necesito ayuda urgente', PHONE_TEST);
  const c1 = conversationManager.getConversation(PHONE_TEST);

  console.log('Respuesta:', r1);
  console.log('Estado:', c1.status, '| Etapa:', c1.stage);

  // Normalizar para quitar tildes al buscar
  const r1Normalized = r1.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const ok1 = r1Normalized.includes('administracion') && 
              c1.status === 'awaiting_admin_offer';
  console.log(ok1 ? '✅ CORRECTO' : '❌ FALLO');

  // Caso 2: Pedimos texto libre, no debe ofrecer admin
  printSection('Caso 2: TEXTO LIBRE esperado (NO debe ofrecer admin)');
  
  conversationManager.createOrUpdateConversation(PHONE_TEST, {
    stage: 'awaiting_corrections',
    status: 'responded',
    lastPromptType: 'text',
    responses: []
  });

  const r2 = processMessage('Dirección: Calle Nueva 123', PHONE_TEST);
  const c2 = conversationManager.getConversation(PHONE_TEST);

  console.log('Respuesta:', r2);
  console.log('Estado:', c2.status, '| Etapa:', c2.stage);

  const r2Normalized = r2.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const ok2 = !r2Normalized.includes('administracion');
  console.log(ok2 ? '✅ CORRECTO' : '❌ FALLO');

  console.log('\n' + '='.repeat(70));
  console.log(ok1 && ok2 ? '✅ TODOS LOS TESTS PASARON' : '❌ ALGUNOS TESTS FALLARON');
  console.log('='.repeat(70) + '\n');

  return ok1 && ok2;
}

// ============================================================================
// UTILIDAD: LIMPIAR CONVERSACIÓN
// ============================================================================

function clearConversation() {
  printHeader('🧹 LIMPIAR CONVERSACIÓN DE TEST');

  const conversationsFile = path.join(__dirname, '../../data/conversations.json');
  
  if (!fs.existsSync(conversationsFile)) {
    console.log('⚠️  No existe archivo conversations.json');
    return;
  }

  const data = JSON.parse(fs.readFileSync(conversationsFile, 'utf8'));

  if (data[PHONE_TEST]) {
    delete data[PHONE_TEST].continuationAskedAt;
    delete data[PHONE_TEST].continuationTimeoutAt;
    delete data[PHONE_TEST].inactivityCheckAt;
    data[PHONE_TEST].status = 'responded';

    fs.writeFileSync(conversationsFile, JSON.stringify(data, null, 2));
    
    console.log('✅ Conversación limpiada');
    console.log('   Teléfono:', PHONE_TEST);
    console.log('   Estado:', data[PHONE_TEST].status);
    console.log('   Etapa:', data[PHONE_TEST].stage);
  } else {
    console.log('❌ Conversación no encontrada');
  }
}

// ============================================================================
// MENÚ INTERACTIVO
// ============================================================================

async function showMenu() {
  printHeader('🧪 SUITE DE TESTING - CHATBOT WHATSAPP');

  console.log('Opciones disponibles:\n');
  console.log('  1. Verificar configuración (--config)');
  console.log('  2. Ver estado de conversaciones (--conv)');
  console.log('  3. Enviar mensaje de prueba (--send)');
  console.log('  4. Verificar templates Twilio (--templates)');
  console.log('  5. Probar sistema de inactividad (--inactivity)');
  console.log('  6. Probar oferta de administración (--admin)');
  console.log('  7. Limpiar conversación de test (--clear)');
  console.log('  8. Ejecutar TODOS los tests (--all)');
  console.log('\nUso: node test.js <opción>\n');
  console.log('Ejemplo: node test.js --config\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await showMenu();
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case '--config':
        testConfig();
        break;

      case '--conv':
        testConversations();
        break;

      case '--send':
        await testSendTemplate();
        break;

      case '--templates':
        await testTemplates();
        break;

      case '--inactivity':
        await testInactivity();
        break;

      case '--admin':
        testAdminOffer();
        break;

      case '--clear':
        clearConversation();
        break;

      case '--all':
        printHeader('🚀 EJECUTANDO TODOS LOS TESTS');
        
        console.log('\n📍 Test 1/6: Configuración');
        const config = testConfig();
        
        console.log('\n📍 Test 2/6: Estado de conversaciones');
        testConversations();
        
        if (config) {
          console.log('\n📍 Test 3/6: Templates en Twilio');
          await testTemplates();
          
          console.log('\n📍 Test 4/6: Envío de mensaje');
          await testSendTemplate();
          
          console.log('\n📍 Test 5/6: Sistema de inactividad');
          await testInactivity();
          
          console.log('\n📍 Test 6/6: Oferta de administración');
          testAdminOffer();
        } else {
          console.log('\n⚠️  Configuración incorrecta, saltando tests que requieren Twilio');
        }
        
        printHeader('✅ SUITE COMPLETADA');
        break;

      default:
        console.log(`❌ Opción no reconocida: ${command}`);
        await showMenu();
    }
  } catch (error) {
    console.error('\n❌ Error ejecutando test:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================================
// EJECUTAR
// ============================================================================

if (require.main === module) {
  main().then(() => process.exit(0));
}

module.exports = {
  testConfig,
  testConversations,
  testSendTemplate,
  testTemplates,
  testInactivity,
  testAdminOffer,
  clearConversation
};