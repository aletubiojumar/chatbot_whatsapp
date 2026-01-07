const conversationManager = require('./conversationManager');
const { sendTemplateMessage, sendSimpleMessageWithText } = require('./sendMessage');
const responses = require('./responses');
require('dotenv').config();
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886';
const CONTENT_SID = process.env.CONTENT_SID || 'HX4a215fbd890a4cd18b04469a66da9c14'; // Pon tu SID real aquí

/**
 * Procesa recordatorios pendientes
 */
async function processReminders() {
    console.log('\n🔔 Verificando conversaciones que necesitan recordatorio...');

    const conversations = conversationManager.getConversationsNeedingReminder();

    if (conversations.length === 0) {
        console.log('✅ No hay recordatorios pendientes');
        return;
    }

    console.log(`📤 Enviando ${conversations.length} recordatorio(s)...`);

    for (const conv of conversations) {
        try {
            // Enviar recordatorio con botones
            await sendTemplateMessage(
                conv.phoneNumber,
                FROM_NUMBER,
                CONTENT_SID
            );

            // Incrementar contador de intentos
            conversationManager.incrementAttempts(conv.phoneNumber);

            console.log(`✅ Recordatorio enviado a ${conv.phoneNumber} (Intento ${conv.attempts + 1}/3)`);

        } catch (error) {
            console.error(`❌ Error enviando recordatorio a ${conv.phoneNumber}:`, error.message);
        }
    }
}

/**
 * Procesa conversaciones que necesitan escalación
 */
async function processEscalations() {
    console.log('\n⚠️  Verificando conversaciones para escalar...');

    const conversations = conversationManager.getConversationsNeedingEscalation();

    if (conversations.length === 0) {
        console.log('✅ No hay conversaciones para escalar');
        return;
    }

    console.log(`📞 Escalando ${conversations.length} conversación(es)...`);

    for (const conv of conversations) {
        try {
            // Enviar mensaje de escalación EN TEXTO SIMPLE (sin botones)
            const mensajeEscalacion = 'Debido a que no ha habido respuesta se procederá a la llamada al asegurado/a por parte del perito.\nUn saludo.';

            await sendSimpleMessageWithText(
                conv.phoneNumber,
                FROM_NUMBER,
                mensajeEscalacion
            );

            // Marcar como escalada
            conversationManager.markAsEscalated(conv.phoneNumber);

            console.log(`✅ Conversación escalada: ${conv.phoneNumber}`);

        } catch (error) {
            console.error(`❌ Error escalando conversación ${conv.phoneNumber}:`, error.message);
        }
    }
}

/**
 * Inicia el scheduler de recordatorios
 * Ejecuta cada 30 minutos
 */
function startReminderScheduler() {
    console.log('🚀 Iniciando scheduler de recordatorios...');
    console.log('⏰ Se ejecutará cada 1 minuto');

    // Ejecutar inmediatamente al iniciar
    console.log('\n🔄 Ejecutando verificación inicial...');
    processReminders().catch(console.error);
    processEscalations().catch(console.error);

    // Ejecutar cada 60 segundos (1 minuto) con setInterval
    setInterval(async () => {
        console.log(`\n⏰ [${new Date().toLocaleString()}] Ejecutando verificación de recordatorios...`);

        try {
            await processReminders();
            await processEscalations();
        } catch (error) {
            console.error('❌ Error en scheduler:', error);
        }
    }, 60000); // 60000 ms = 1 minuto
}

module.exports = {
    startReminderScheduler,
    processReminders,
    processEscalations
};