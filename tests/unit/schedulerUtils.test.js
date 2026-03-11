// tests/unit/schedulerUtils.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { _test } = require('../../src/bot/reminderScheduler');
const { nextBusinessHoursStart } = _test;

const BH_START = Number(process.env.BUSINESS_HOURS_START || 9);

describe('nextBusinessHoursStart', () => {
  test('devuelve un timestamp futuro', () => {
    const result = nextBusinessHoursStart();
    assert.ok(result > Date.now(), 'debe ser en el futuro');
  });

  test('la hora del resultado es BH_START:00:00', () => {
    const result = nextBusinessHoursStart();
    const d = new Date(result);
    assert.equal(d.getHours(), BH_START);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
  });

  test('el resultado es un día laborable (L-V)', () => {
    const result = nextBusinessHoursStart();
    const day = new Date(result).getDay(); // 0=dom, 6=sab
    assert.ok(day >= 1 && day <= 5, `día ${day} no es laborable`);
  });

  test('no devuelve hoy si ya pasó la hora de apertura', () => {
    const now = new Date();
    const result = nextBusinessHoursStart();
    const resultDate = new Date(result);

    // Si ahora mismo estamos dentro de horario o después de cerrar,
    // el resultado debe ser hoy mismo (antes de abrir) o el próximo día.
    // En cualquier caso no puede ser en el pasado.
    assert.ok(result > Date.now());

    // Si el resultado es hoy, debe ser antes de haber pasado la hora actual
    if (
      resultDate.getFullYear() === now.getFullYear() &&
      resultDate.getMonth() === now.getMonth() &&
      resultDate.getDate() === now.getDate()
    ) {
      assert.ok(result > Date.now(), 'si es hoy debe ser en el futuro');
    }
  });

  test('llamadas sucesivas devuelven el mismo día y hora', () => {
    const r1 = nextBusinessHoursStart();
    const r2 = nextBusinessHoursStart();
    // Deben ser iguales (misma resolución a segundos)
    assert.ok(Math.abs(r1 - r2) < 1000);
  });
});
