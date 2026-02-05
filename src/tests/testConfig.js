// test-config.js
// Script para verificar que la configuración está correcta
require('dotenv').config();
const conversationManager = require('../bot/conversationManager');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║           VERIFICACIÓN DE CONFIGURACIÓN                   ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// 1. Verificar variables de entorno
console.log('📋 VARIABLES DE ENTORNO:\n');

const requiredVars = [
  'GEMINI_API_KEY',
  'META_ACCESS_TOKEN',
  'META_PHONE_NUMBER_ID',
  'META_API_VERSION',
  'META_VERIFY_TOKEN',
  'WA_TPL_SALUDO'
];

const configVars = [
  'REMINDER_INTERVAL_HOURS',
  'MAX_REMINDER_ATTEMPTS',
  'SCHEDULER_CHECK_INTERVAL_HOURS',
  'INACTIVITY_TIMEOUT_HOURS',
  'INACTIVITY_SNOOZE_HOURS'
];

let allOk = true;

console.log('✓ Variables requeridas:');
requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    // Ocultar API keys
    const display = varName.includes('KEY') || varName.includes('TOKEN') || varName.includes('ACCESS')
      ? value.substring(0, 10) + '...' + value.substring(value.length - 4)
      : value;
    console.log(`  ✅ ${varName}: ${display}`);
  } else {
    console.log(`  ❌ ${varName}: NO CONFIGURADO`);
    allOk = false;
  }
});

console.log('\n✓ Variables de configuración de tiempos:');
configVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`  ✅ ${varName}: ${value}`);
  } else {
    console.log(`  ⚠️  ${varName}: NO CONFIGURADO (se usará valor por defecto)`);
  }
});

// 2. Verificar configuración calculada
console.log('\n\n📊 CONFIGURACIÓN CALCULADA:\n');

const config = conversationManager.getConfigStats();

console.log(`  ⏰ Intervalo entre recordatorios: ${config.reminderIntervalHours} horas`);
console.log(`  🔢 Intentos máximos: ${config.maxReminderAttempts}`);
console.log(`  📁 Archivo de conversaciones: ${config.conversationsFile}`);

const schedulerInterval = Number(process.env.SCHEDULER_CHECK_INTERVAL_HOURS || 6);
const inactivityTimeout = Number(process.env.INACTIVITY_TIMEOUT_HOURS || 1);
const inactivitySnooze = Number(process.env.INACTIVITY_SNOOZE_HOURS || 6);

console.log(`  🔄 Intervalo de verificación: ${schedulerInterval} horas`);
console.log(`  😴 Timeout de inactividad: ${inactivityTimeout} horas`);
console.log(`  💤 Snooze post-mensaje: ${inactivitySnooze} horas`);

// 3. Calcular timeline
console.log('\n\n📅 TIMELINE DE RECORDATORIOS:\n');

const totalTime = config.reminderIntervalHours * config.maxReminderAttempts;
console.log(`  T+0h      → Mensaje inicial`);

for (let i = 1; i <= config.maxReminderAttempts; i++) {
  const time = config.reminderIntervalHours * i;
  console.log(`  T+${time}h     → Recordatorio ${i}`);
}

console.log(`  T+${totalTime + config.reminderIntervalHours}h     → Escalación`);
console.log(`\n  Total: ~${totalTime + config.reminderIntervalHours} horas desde mensaje inicial hasta escalación`);

// 4. Verificar coherencia
console.log('\n\n🔍 VERIFICACIÓN DE COHERENCIA:\n');

let coherenceOk = true;

// Verificar que scheduler interval <= reminder interval
if (schedulerInterval > config.reminderIntervalHours) {
  console.log(`  ❌ ADVERTENCIA: SCHEDULER_CHECK_INTERVAL_HOURS (${schedulerInterval}h) es mayor que REMINDER_INTERVAL_HOURS (${config.reminderIntervalHours}h)`);
  console.log(`     Esto podría causar que se pierdan recordatorios.`);
  console.log(`     Recomendación: SCHEDULER_CHECK_INTERVAL_HOURS <= REMINDER_INTERVAL_HOURS`);
  coherenceOk = false;
} else {
  console.log(`  ✅ Intervalo de scheduler es correcto`);
}

// Verificar valores razonables
if (config.maxReminderAttempts < 1) {
  console.log(`  ❌ ERROR: MAX_REMINDER_ATTEMPTS debe ser al menos 1`);
  coherenceOk = false;
} else if (config.maxReminderAttempts > 10) {
  console.log(`  ⚠️  ADVERTENCIA: MAX_REMINDER_ATTEMPTS (${config.maxReminderAttempts}) es muy alto. ¿Seguro?`);
} else {
  console.log(`  ✅ Número de intentos es razonable`);
}

if (config.reminderIntervalHours < 0.25) {
  console.log(`  ⚠️  ADVERTENCIA: REMINDER_INTERVAL_HOURS (${config.reminderIntervalHours}h) es muy corto. ¿Es para testing?`);
} else if (config.reminderIntervalHours > 48) {
  console.log(`  ⚠️  ADVERTENCIA: REMINDER_INTERVAL_HOURS (${config.reminderIntervalHours}h) es muy largo. ¿Seguro?`);
} else {
  console.log(`  ✅ Intervalo de recordatorios es razonable`);
}

// 5. Verificar que NO existan archivos obsoletos
console.log('\n\n🗑️  VERIFICACIÓN DE ARCHIVOS OBSOLETOS:\n');

const fs = require('fs');
const path = require('path');

const obsoleteFiles = [
  'src/bot/timeWindow.js',
  'src/utils/timeWindow.js',
  'bot/timeWindow.js'
];

let obsoleteFound = false;
obsoleteFiles.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    console.log(`  ⚠️  ENCONTRADO: ${filePath} (debería eliminarse)`);
    obsoleteFound = true;
  }
});

if (!obsoleteFound) {
  console.log(`  ✅ No se encontraron archivos obsoletos`);
}

// 6. Resumen final
console.log('\n\n╔════════════════════════════════════════════════════════════╗');
console.log('║                    RESUMEN FINAL                           ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

if (allOk && coherenceOk && !obsoleteFound) {
  console.log('  🎉 TODO OK - La configuración es correcta\n');
  console.log('  Puedes ejecutar el servidor con: npm start\n');
  process.exit(0);
} else {
  console.log('  ⚠️  HAY PROBLEMAS - Revisa los errores anteriores\n');
  
  if (!allOk) {
    console.log('  🔧 Acción requerida: Configura las variables de entorno faltantes en .env\n');
  }
  
  if (!coherenceOk) {
    console.log('  🔧 Acción requerida: Ajusta los valores de configuración de tiempos\n');
  }
  
  if (obsoleteFound) {
    console.log('  🔧 Acción requerida: Elimina los archivos obsoletos\n');
  }
  
  process.exit(1);
}