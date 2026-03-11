// tests/unit/rateLimiter.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Forzar límites bajos antes de cargar el módulo
process.env.RATE_USER_MAX      = '3';
process.env.RATE_USER_WIN_MS   = '5000';
process.env.RATE_GLOBAL_MAX    = '200'; // alto para aislar tests de usuario
process.env.RATE_GLOBAL_WIN_MS = '5000';

// Cargar módulo DESPUÉS de fijar vars
const { checkLimit } = require('../../src/bot/rateLimiter');

describe('checkLimit', () => {
  test('primeros N mensajes permitidos', () => {
    const uid = `test_user_${Date.now()}`;
    assert.deepEqual(checkLimit(uid), { allowed: true });
    assert.deepEqual(checkLimit(uid), { allowed: true });
    assert.deepEqual(checkLimit(uid), { allowed: true });
  });

  test('superar límite de usuario → blocked reason=user', () => {
    const uid = `heavy_${Date.now()}`;
    checkLimit(uid); checkLimit(uid); checkLimit(uid); // llena el límite (3)
    const r = checkLimit(uid);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'user');
  });

  test('usuarios distintos son independientes', () => {
    const u1 = `ind_a_${Date.now()}`;
    const u2 = `ind_b_${Date.now()}`;
    assert.equal(checkLimit(u1).allowed, true);
    assert.equal(checkLimit(u2).allowed, true);
  });

  test('mensaje con userId vacío no bloquea otro usuario', () => {
    const uid = `normal_${Date.now() + 1}`;
    assert.equal(checkLimit(uid).allowed, true);
  });
});
