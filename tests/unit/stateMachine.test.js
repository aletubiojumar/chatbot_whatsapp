// tests/unit/stateMachine.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { canProcess, isValidTransition, TERMINAL_STAGES } = require('../../src/bot/stateMachine');

// ── canProcess ───────────────────────────────────────────────────────────────

describe('canProcess', () => {
  test('null → bloqueado', () => {
    const r = canProcess(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_conversation');
  });

  test('status=escalated → bloqueado con respuesta IA diferida', () => {
    const r = canProcess({ status: 'escalated', stage: 'consent' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'terminal_status');
    assert.equal(r.aiBehavior, 'reply_once_then_close');
  });

  test('stage=cerrado → bloqueado en silencio', () => {
    const r = canProcess({ status: 'pending', stage: 'cerrado' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'terminal_stage');
    assert.equal(r.aiBehavior, 'silent');
  });

  test('stage=finalizado → bloqueado con una última respuesta IA', () => {
    const r = canProcess({ status: 'pending', stage: 'finalizado' });
    assert.equal(r.ok, false);
    assert.equal(r.aiBehavior, 'reply_once_then_close');
  });

  test('stage=consent, status=pending → permitido', () => {
    const r = canProcess({ status: 'pending', stage: 'consent' });
    assert.equal(r.ok, true);
  });

  test('stage=valoracion, status=pending → permitido', () => {
    const r = canProcess({ status: 'pending', stage: 'valoracion' });
    assert.equal(r.ok, true);
  });

  test('stage=agendando, status=pending → permitido', () => {
    const r = canProcess({ status: 'pending', stage: 'agendando' });
    assert.equal(r.ok, true);
  });
});

// ── isValidTransition ────────────────────────────────────────────────────────

describe('isValidTransition', () => {
  test('consent → identification válido', () => {
    assert.equal(isValidTransition('consent', 'identification'), true);
  });

  test('consent → escalated válido', () => {
    assert.equal(isValidTransition('consent', 'escalated'), true);
  });

  test('consent → agendando inválido', () => {
    assert.equal(isValidTransition('consent', 'agendando'), false);
  });

  test('finalizado → cerrado válido', () => {
    assert.equal(isValidTransition('finalizado', 'cerrado'), true);
  });

  test('cerrado → cualquier cosa inválido', () => {
    assert.equal(isValidTransition('cerrado', 'consent'), false);
    assert.equal(isValidTransition('cerrado', 'finalizado'), false);
  });

  test('escalated → cualquier cosa inválido', () => {
    assert.equal(isValidTransition('escalated', 'consent'), false);
  });

  test('valoracion → finalizado válido (siniestro sin cita)', () => {
    assert.equal(isValidTransition('valoracion', 'finalizado'), true);
  });
});

// ── TERMINAL_STAGES ──────────────────────────────────────────────────────────

describe('TERMINAL_STAGES', () => {
  test('cerrado, finalizado, escalated son terminales', () => {
    assert.ok(TERMINAL_STAGES.has('cerrado'));
    assert.ok(TERMINAL_STAGES.has('finalizado'));
    assert.ok(TERMINAL_STAGES.has('escalated'));
  });

  test('consent y agendando no son terminales', () => {
    assert.equal(TERMINAL_STAGES.has('consent'), false);
    assert.equal(TERMINAL_STAGES.has('agendando'), false);
  });
});
