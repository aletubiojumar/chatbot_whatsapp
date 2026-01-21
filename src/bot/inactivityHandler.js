const conversationManager = require('./conversationManager');
const { sendTemplate } = require('./templateSender');
const { normalizeWhatsAppNumber } = require('./utils/phone');

const INACTIVITY_MINUTES = 5;

function startInactivityScheduler() {
  console.log('🚀 Iniciando scheduler de inactividad...');
  console.log('⏰ Se ejecutará cada 1 minuto');

  setInterval(checkInactiveConversations, 60 * 1000);

  console.log('\n🔄 Ejecutando verificación inicial de inactividad...');
  checkInactiveConversations();
}

function checkInactiveConversations() {
  console.log('🔍 Verificando conversaciones inactivas...');

  const conversations = conversationManager.getAllConversations();
  console.log(`📊 Total de conversaciones: ${conversations.length}`);

  const now = Date.now();
  const inactive = conversations.filter(conv => {
    if (!conv.lastUserMessageAt) return false;
    if (conv.status !== 'pending') return false;

    const diffMinutes = (now - conv.lastUserMessageAt) / 60000;
    return diffMinutes >= INACTIVITY_MINUTES;
  });

  console.log(`📤 Conversaciones inactivas detectadas: ${inactive.length}`);

  inactive.forEach(conv => sendContinuation(conv));
}

async function sendContinuation(conversation) {
  const rawNumber = conversation.phone;
  const to = normalizeWhatsAppNumber(rawNumber);

  if (!to) {
    console.error(`❌ Número inválido para continuación: ${rawNumber}`);
    return;
  }

  console.log(`   📱 Enviando mensaje de continuación a: ${to}`);

  try {
    await sendTemplate({
      to,
      contentSid: process.env.TEMPLATE_INACTIVITY_SID
    });

    conversationManager.createOrUpdateConversation(rawNumber, {
      status: 'awaiting_continuation',
      continuationAskedAt: Date.now()
    });

    console.log(`✅ Continuación enviada correctamente a ${to}`);
  } catch (err) {
    console.error(`❌ Error enviando continuación a ${to}: ${err.message}`);
  }
}

module.exports = {
  startInactivityScheduler
};
