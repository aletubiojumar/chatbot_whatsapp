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

  test('status=escalated legacy → permitido', () => {
    const r = canProcess({ status: 'escalated', stage: 'consent' });
    assert.equal(r.ok, true);
  });

  test('stage=cerrado legacy → permitido', () => {
    const r = canProcess({ status: 'pending', stage: 'cerrado' });
    assert.equal(r.ok, true);
  });

  test('stage=finalizado legacy → permitido', () => {
    const r = canProcess({ status: 'pending', stage: 'finalizado' });
    assert.equal(r.ok, true);
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

  test('consent → escalated inválido', () => {
    assert.equal(isValidTransition('consent', 'escalated'), false);
  });

  test('consent → agendando inválido', () => {
    assert.equal(isValidTransition('consent', 'agendando'), false);
  });

  test('finalizado legacy → agendando válido para recuperar conversación', () => {
    assert.equal(isValidTransition('finalizado', 'agendando'), true);
  });

  test('cerrado → cualquier cosa inválido', () => {
    assert.equal(isValidTransition('cerrado', 'consent'), false);
    assert.equal(isValidTransition('cerrado', 'finalizado'), false);
  });

  test('escalated legacy → valoracion válido para recuperar conversación', () => {
    assert.equal(isValidTransition('escalated', 'valoracion'), true);
  });

  test('valoracion → finalizado inválido', () => {
    assert.equal(isValidTransition('valoracion', 'finalizado'), false);
  });
});

// ── TERMINAL_STAGES ──────────────────────────────────────────────────────────

describe('TERMINAL_STAGES', () => {
  test('no hay stages terminales activos', () => {
    assert.equal(TERMINAL_STAGES.has('cerrado'), false);
    assert.equal(TERMINAL_STAGES.has('finalizado'), false);
    assert.equal(TERMINAL_STAGES.has('escalated'), false);
  });

  test('consent y agendando no son terminales', () => {
    assert.equal(TERMINAL_STAGES.has('consent'), false);
    assert.equal(TERMINAL_STAGES.has('agendando'), false);
  });
});
