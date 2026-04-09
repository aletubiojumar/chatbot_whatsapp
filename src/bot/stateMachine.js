// src/bot/stateMachine.js — Máquina de estados de la conversación
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │  STAGES (etapa del proceso pericial)                                  │
// │                                                                        │
// │  consent ──► identification ──► valoracion ──► agendando              │
// │                                                                        │
// │  Los stages terminales legacy se conservan solo por compatibilidad,    │
// │  pero ya no bloquean ni cierran la conversación.                       │
// └──────────────────────────────────────────────────────────────────────┘
//
// STATUSES (estado operativo de la conversación):
//   pending               → activa, esperando respuesta del usuario
//   awaiting_continuation → inactividad detectada; esperando confirmación
//   paused                → abierta, sin recordatorios automáticos hasta que el usuario escriba

// ── Definición de stages ──────────────────────────────────────────────────

const STAGES = [
  'consent',          // Usuario confirma continuar por este medio
  'identification',   // Verificamos datos personales y del siniestro
  'valoracion',       // Recogemos datos del daño (tipo visita, urgencia, estimación)
  'agendando',        // Coordinamos fecha/hora de la visita pericial
  'finalizado',       // Legacy
  'cerrado',          // Legacy
  'escalated',        // Legacy
];

const TERMINAL_STAGES = new Set();

// ── Transiciones válidas ──────────────────────────────────────────────────

const TRANSITIONS = {
  consent:        ['identification'],
  identification: ['valoracion'],
  valoracion:     ['agendando'],
  agendando:      [],
  finalizado:     ['identification', 'valoracion', 'agendando'],
  cerrado:        ['identification', 'valoracion', 'agendando'],
  escalated:      ['identification', 'valoracion', 'agendando'],
};

// ── Comportamiento seguro para estados terminales ──────────────────────────

const TERMINAL_BEHAVIOR = {};

// ── API pública ───────────────────────────────────────────────────────────

/**
 * Determina si se puede procesar un mensaje entrante para esta conversación.
 *
 * @param {{ stage?: string, status?: string } | null} conversation
 * @returns {{ ok: boolean, reason?: string, aiBehavior?: string }}
 *   ok       = true si el mensaje puede procesarse
 *   reason   = por qué fue bloqueado (para logging)
 *   aiBehavior = comportamiento técnico esperado del handler
 */
function canProcess(conversation) {
  if (!conversation) {
    return { ok: false, reason: 'no_conversation' };
  }

  return { ok: true };
}

/**
 * Comprueba si una transición de stage es válida.
 * Útil para validar antes de llamar a conversationManager.createOrUpdateConversation.
 *
 * @param {string} from - stage actual
 * @param {string} to   - stage deseado
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

module.exports = {
  STAGES,
  TRANSITIONS,
  TERMINAL_STAGES,
  TERMINAL_BEHAVIOR,
  canProcess,
  isValidTransition,
};
