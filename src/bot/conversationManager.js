const fs = require('fs');
const path = require('path');

const CONVERSATIONS_FILE = path.join(__dirname, '../../data/conversations.json');

/**
 * Estructura de una conversación:
 * {
 *   phoneNumber: string,
 *   status: 'pending' | 'responded' | 'completed' | 'escalated',
 *   attempts: number,
 *   lastMessageAt: timestamp,
 *   nextReminderAt: timestamp,
 *   stage: 'initial' | 'identity_confirmed' | 'understands_reason' | 'completed',
 *   responses: [{timestamp, message, type}]
 * }
 */

// Inicializar archivo si no existe
function initConversationsFile() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(CONVERSATIONS_FILE)) {
        fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify({}, null, 2));
    }
}

// Leer todas las conversaciones
function getConversations() {
    initConversationsFile();
    const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
    return JSON.parse(data);
}

// Guardar conversaciones
function saveConversations(conversations) {
    fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2));
}

// Crear o actualizar conversación
function createOrUpdateConversation(phoneNumber, data) {
    const conversations = getConversations();

    if (!conversations[phoneNumber]) {
        conversations[phoneNumber] = {
            phoneNumber,
            status: 'pending',
            attempts: 0,
            lastMessageAt: Date.now(),
            nextReminderAt: Date.now() + (1 * 60 * 1000), // 1 minuto
            stage: 'initial',
            responses: [],
            createdAt: Date.now()
        };
    }

    // Actualizar con nueva data - PERO mantener nextReminderAt si no viene en data
    const updatedData = { ...data };

    // Si data no incluye nextReminderAt, mantener el valor existente
    if (updatedData.nextReminderAt === undefined && conversations[phoneNumber].nextReminderAt !== undefined) {
        updatedData.nextReminderAt = conversations[phoneNumber].nextReminderAt;
    }

    conversations[phoneNumber] = {
        ...conversations[phoneNumber],
        ...updatedData,
        updatedAt: Date.now()
    };

    saveConversations(conversations);
    return conversations[phoneNumber];
}
// Obtener conversación
function getConversation(phoneNumber) {
    const conversations = getConversations();
    return conversations[phoneNumber] || null;
}

// Registrar respuesta del usuario
function recordResponse(phoneNumber, message, type = 'user') {
    const conversation = getConversation(phoneNumber);

    if (!conversation) {
        return null;
    }

    conversation.responses.push({
        timestamp: Date.now(),
        message,
        type // 'user' o 'bot'
    });

    conversation.lastMessageAt = Date.now();
    conversation.status = 'responded';

    return createOrUpdateConversation(phoneNumber, conversation);
}

// Incrementar intentos de contacto
function incrementAttempts(phoneNumber) {
    const conversation = getConversation(phoneNumber);

    if (!conversation) {
        return null;
    }

    const attempts = conversation.attempts + 1;
    const nextReminderAt = attempts < 3
        // ? Date.now() + (6 * 60 * 60 * 1000) // 6 horas
        ? Date.now() + (1 * 60 * 1000) // 1 minuto
        : null; // No más recordatorios

    return createOrUpdateConversation(phoneNumber, {
        attempts,
        nextReminderAt,
        lastMessageAt: Date.now()
    });
}

// Obtener conversaciones que necesitan recordatorio
function getConversationsNeedingReminder() {
    const conversations = getConversations();
    const now = Date.now();

    return Object.values(conversations).filter(conv =>
        conv.status === 'pending' &&
        conv.attempts < 3 &&
        conv.nextReminderAt &&
        conv.nextReminderAt <= now
    );
}

// Obtener conversaciones que necesitan escalación (3 intentos sin respuesta)
function getConversationsNeedingEscalation() {
    const conversations = getConversations();

    return Object.values(conversations).filter(conv =>
        conv.status === 'pending' &&
        conv.attempts >= 3 &&
        conv.stage !== 'escalated'
    );
}

// Marcar como escalada
function markAsEscalated(phoneNumber) {
    return createOrUpdateConversation(phoneNumber, {
        status: 'escalated',
        stage: 'escalated'
    });
}

// Avanzar a siguiente etapa
function advanceStage(phoneNumber, newStage) {
    return createOrUpdateConversation(phoneNumber, {
        stage: newStage
    });
}

module.exports = {
    createOrUpdateConversation,
    getConversation,
    recordResponse,
    incrementAttempts,
    getConversationsNeedingReminder,
    getConversationsNeedingEscalation,
    markAsEscalated,
    advanceStage
};