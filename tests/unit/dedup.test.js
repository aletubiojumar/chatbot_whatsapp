// tests/unit/dedup.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isDuplicate } = require('../../src/bot/dedup');

describe('isDuplicate', () => {
  test('primer mensaje → no es duplicado', () => {
    assert.equal(isDuplicate('whatsapp', 'user1', 'msg001'), false);
  });

  test('mismo mensaje segunda vez → es duplicado', () => {
    isDuplicate('whatsapp', 'user2', 'msg002');
    assert.equal(isDuplicate('whatsapp', 'user2', 'msg002'), true);
  });

  test('mismo msgId, distinto canal → no duplicado', () => {
    isDuplicate('whatsapp', 'user3', 'msg003');
    assert.equal(isDuplicate('telegram', 'user3', 'msg003'), false);
  });

  test('mismo msgId, distinto userId → no duplicado', () => {
    isDuplicate('whatsapp', 'userA', 'msg004');
    assert.equal(isDuplicate('whatsapp', 'userB', 'msg004'), false);
  });

  test('messageId null → nunca duplicado (no se puede deduplicar)', () => {
    assert.equal(isDuplicate('whatsapp', 'user5', null), false);
    assert.equal(isDuplicate('whatsapp', 'user5', null), false);
  });
});
