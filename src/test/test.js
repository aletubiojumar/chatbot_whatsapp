#!/usr/bin/env node

/**
 * Script de Diagnóstico Automático
 * Verifica la configuración del bot y detecta problemas comunes
 */

const path = require('path');
const fs = require('fs');

// Ruta al directorio raíz del proyecto
const PROJECT_ROOT = path.resolve(__dirname, '../..');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
const twilio = require('twilio');

(async () => {
console.log('\n🔍 DIAGNÓSTICO DEL BOT DE WHATSAPP\n');
console.log('═'.repeat(80));

let errorsFound = 0;
let warningsFound = 0;

// ==========================================
// 1. VERIFICAR VARIABLES DE ENTORNO
// ==========================================
console.log('\n📋 1. Verificando variables de entorno...\n');

const requiredVars = {
  'TWILIO_ACCOUNT_SID': 'Credencial de cuenta Twilio',
  'TWILIO_AUTH_TOKEN': 'Token de autenticación Twilio',
  'TWILIO_FROM_NUMBER': 'Número de origen WhatsApp'
};

const optionalVars = {
  'CONTENT_SID': 'Template mensaje inicial',
  'MENSAJE4_V2_SID': 'Template quién atenderá',
  'MENSAJE_CORREGIR_V5_SID': 'Template confirmación/corrección',
  'MENSAJE_GRAVEDAD_SID': 'Template gravedad siniestro',
  'MENSAJE_CITA_SID': 'Template selección cita',
  'MENSAJE_AUSENCIA_SID': 'Template ausencia/continuación'
};

// Verificar variables requeridas
for (const [varName, description] of Object.entries(requiredVars)) {
  const value = process.env[varName];
  if (!value) {
    console.log(`❌ ${varName}: NO CONFIGURADA`);
    console.log(`   → ${description}`);
    errorsFound++;
  } else {
    // Verificar formato básico
    if (varName === 'TWILIO_ACCOUNT_SID' && !value.startsWith('AC')) {
      console.log(`⚠️  ${varName}: Formato sospechoso (debe empezar con 'AC')`);
      warningsFound++;
    } else if (varName === 'TWILIO_FROM_NUMBER' && !value.startsWith('whatsapp:')) {
      console.log(`⚠️  ${varName}: Debe empezar con 'whatsapp:' (ej: whatsapp:+14155238886)`);
      warningsFound++;
    } else {
      console.log(`✅ ${varName}: Configurada`);
    }
  }
}

console.log('');

// Verificar variables opcionales
for (const [varName, description] of Object.entries(optionalVars)) {
  const value = process.env[varName];
  if (!value) {
    console.log(`⚠️  ${varName}: NO CONFIGURADA (opcional)`);
    console.log(`   → ${description}`);
    warningsFound++;
  } else if (!value.startsWith('HX')) {
    console.log(`⚠️  ${varName}: Formato incorrecto (debe empezar con 'HX')`);
    console.log(`   → Valor actual: ${value}`);
    warningsFound++;
  } else {
    console.log(`✅ ${varName}: Configurada (${value})`);
  }
}

// ==========================================
// 2. VERIFICAR CONEXIÓN CON TWILIO
// ==========================================
console.log('\n📡 2. Verificando conexión con Twilio...\n');

if (errorsFound > 0) {
  console.log('❌ No se puede verificar conexión: faltan credenciales requeridas');
} else {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // Intentar obtener información de la cuenta
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    
    console.log('✅ Conexión exitosa con Twilio');
    console.log(`   Cuenta: ${account.friendlyName || 'Sin nombre'}`);
    console.log(`   Status: ${account.status}`);
    console.log(`   Tipo: ${account.type}`);

    if (account.status !== 'active') {
      console.log('\n⚠️  Tu cuenta Twilio NO está activa');
      console.log('   → Revisa el estado en: https://console.twilio.com/');
      warningsFound++;
    }

  } catch (error) {
    console.log('❌ Error de conexión con Twilio');
    console.log(`   Mensaje: ${error.message}`);
    if (error.code) console.log(`   Código: ${error.code}`);
    errorsFound++;
  }
}

// ==========================================
// 3. VERIFICAR NÚMERO DE WHATSAPP
// ==========================================
console.log('\n📱 3. Verificando número de WhatsApp...\n');

const fromNumber = process.env.TWILIO_FROM_NUMBER;

if (!fromNumber) {
  console.log('❌ TWILIO_FROM_NUMBER no configurado');
  errorsFound++;
} else {
  if (fromNumber === 'whatsapp:+14155238886') {
    console.log('ℹ️  Usando Twilio Sandbox (modo pruebas)');
    console.log('   → Los destinatarios deben registrarse primero');
    console.log('   → Enviar: "join [código]" al número sandbox');
    console.log('   → Más info: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn');
  } else if (fromNumber.startsWith('whatsapp:+')) {
    console.log('✅ Número de producción configurado');
    console.log(`   → ${fromNumber}`);
  } else {
    console.log('❌ Formato de número inválido');
    console.log(`   → Actual: ${fromNumber}`);
    console.log('   → Debe ser: whatsapp:+[código país][número]');
    errorsFound++;
  }
}

// ==========================================
// 4. VERIFICAR TEMPLATES
// ==========================================
console.log('\n📝 4. Verificando templates de contenido...\n');

if (errorsFound > 0) {
  console.log('⏭️  Saltando verificación de templates (corrige errores primero)');
} else {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const contents = await client.content.v1.contents.list({ limit: 100 });
    
    if (contents.length === 0) {
      console.log('⚠️  No se encontraron templates');
      console.log('   → Debes crear templates en Twilio Console');
      console.log('   → https://console.twilio.com/us1/develop/sms/content-editor');
      warningsFound++;
    } else {
      console.log(`✅ Se encontraron ${contents.length} template(s)\n`);
      
      // Verificar cada template configurado
      for (const [varName, description] of Object.entries(optionalVars)) {
        const sid = process.env[varName];
        if (sid && sid.startsWith('HX')) {
          const template = contents.find(c => c.sid === sid);
          if (template) {
            console.log(`✅ ${varName}:`);
            console.log(`   Nombre: ${template.friendlyName}`);
            console.log(`   SID: ${template.sid}`);
          } else {
            console.log(`❌ ${varName}: Template no encontrado`);
            console.log(`   SID configurado: ${sid}`);
            console.log(`   → Este template no existe en tu cuenta`);
            errorsFound++;
          }
        }
      }
      
      console.log('\n💡 Templates disponibles en tu cuenta:');
      console.log('─'.repeat(80));
      contents.forEach(t => {
        console.log(`   ${t.friendlyName} → ${t.sid}`);
      });
    }

  } catch (error) {
    console.log('❌ Error al verificar templates');
    console.log(`   Mensaje: ${error.message}`);
    errorsFound++;
  }
}

// ==========================================
// 5. VERIFICAR ARCHIVOS DEL PROYECTO
// ==========================================
console.log('\n📂 5. Verificando estructura del proyecto...\n');

const requiredFiles = [
  'src/bot/index.js',
  'src/bot/messageHandler.js',
  'src/bot/sendMessage.js',
  'src/bot/conversationManager.js',
  'package.json'
];

for (const file of requiredFiles) {
  const fullPath = path.join(PROJECT_ROOT, file);
  if (fs.existsSync(fullPath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - NO ENCONTRADO`);
    errorsFound++;
  }
}

// Verificar node_modules
if (fs.existsSync(path.join(PROJECT_ROOT, 'node_modules'))) {
  console.log('✅ node_modules (dependencias instaladas)');
} else {
  console.log('⚠️  node_modules - NO ENCONTRADO');
  console.log('   → Ejecuta: npm install');
  warningsFound++;
}

// ==========================================
// RESUMEN FINAL
// ==========================================
console.log('\n' + '═'.repeat(80));
console.log('\n📊 RESUMEN DEL DIAGNÓSTICO\n');

if (errorsFound === 0 && warningsFound === 0) {
  console.log('🎉 ¡TODO PERFECTO! No se encontraron problemas\n');
  console.log('✅ Tu bot debería funcionar correctamente');
  console.log('\n🚀 Pasos siguientes:');
  console.log('   1. Inicia el servidor: node src/bot/index.js');
  console.log('   2. Expón con ngrok: ngrok http 3000');
  console.log('   3. Configura el webhook en Twilio Console');
} else {
  if (errorsFound > 0) {
    console.log(`❌ ERRORES CRÍTICOS: ${errorsFound}`);
    console.log('   → El bot NO funcionará hasta corregir estos errores\n');
  }
  
  if (warningsFound > 0) {
    console.log(`⚠️  ADVERTENCIAS: ${warningsFound}`);
    console.log('   → El bot puede funcionar parcialmente\n');
  }
  
  console.log('🔧 ACCIONES RECOMENDADAS:\n');
  
  if (errorsFound > 0) {
    console.log('1. Completa las variables de entorno en .env');
    console.log('2. Verifica tus credenciales de Twilio');
    console.log('3. Revisa que los Content SIDs sean correctos');
  }
  
  if (warningsFound > 0) {
    console.log('4. Instala dependencias: npm install');
    console.log('5. Crea los templates faltantes en Twilio Console');
    console.log('6. Solicita aprobación de Meta para los templates');
  }
}

console.log('\n' + '═'.repeat(80) + '\n');

process.exit(errorsFound > 0 ? 1 : 0);
})();