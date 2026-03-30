// tests/unit/messageHandlerUtils.test.js
// Prueba las funciones helper puras exportadas desde messageHandler
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Necesitamos dotenv para que los requires internos no fallen
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { _test } = require('../../src/bot/messageHandler');
const {
  detectEconomicEstimate,
  hasSharedLocation,
  normalizeContactPhone,
  isAffirmativeAck,
  extractRelationship,
} = _test;

// ── detectEconomicEstimate ───────────────────────────────────────────────────

describe('detectEconomicEstimate', () => {
  test('importe con "euros" → detectado', () => {
    assert.equal(detectEconomicEstimate('Serán unos 2000 euros aproximadamente'), '2000 €');
  });

  test('importe con "€" sin espacio antes de texto → detectado', () => {
    assert.equal(detectEconomicEstimate('Calculo unos 500 euros'), '500 €');
  });

  test('rango con guión → detectado', () => {
    assert.equal(detectEconomicEstimate('Entre 1000-3000 euros'), '1000 - 3000 €');
  });

  test('solo número corto → detectado', () => {
    assert.equal(detectEconomicEstimate('200'), '200 €');
  });

  test('texto sin importe → null', () => {
    assert.equal(detectEconomicEstimate('No tengo ni idea'), null);
  });

  test('texto vacío → null', () => {
    assert.equal(detectEconomicEstimate(''), null);
  });

  test('número grande con punto de miles → detectado', () => {
    assert.equal(detectEconomicEstimate('Unos 15.000 euros'), '15000 €');
  });
});

// ── normalizeContactPhone ────────────────────────────────────────────────────

describe('normalizeContactPhone', () => {
  test('número español de 9 dígitos → añade prefijo 34', () => {
    assert.equal(normalizeContactPhone('674742564'), '34674742564');
  });

  test('número con prefijo 34 → sin cambios', () => {
    assert.equal(normalizeContactPhone('34674742564'), '34674742564');
  });

  test('número con 0034 → normalizado', () => {
    assert.equal(normalizeContactPhone('0034674742564'), '34674742564');
  });

  test('número con espacios y guiones → solo dígitos', () => {
    assert.equal(normalizeContactPhone('674 742 564'), '34674742564');
  });

  test('undefined → cadena vacía', () => {
    assert.equal(normalizeContactPhone(undefined), '');
  });

  test('cadena vacía → cadena vacía', () => {
    assert.equal(normalizeContactPhone(''), '');
  });
});

describe('hasSharedLocation', () => {
  test('true si el mensaje actual trae coordenadas', () => {
    assert.equal(hasSharedLocation({}, '36.72,-4.42'), true);
  });

  test('true si ya había coordenadas guardadas', () => {
    assert.equal(hasSharedLocation({ coordenadas: '36.72,-4.42' }, ''), true);
  });

  test('false si no hay coordenadas ni actuales ni guardadas', () => {
    assert.equal(hasSharedLocation({}, ''), false);
  });
});

// ── isAffirmativeAck ─────────────────────────────────────────────────────────

describe('isAffirmativeAck', () => {
  for (const input of ['si', 'sí', 'ok', 'vale', 'perfecto', 'correcto', 'de acuerdo', 'confirmado']) {
    test(`"${input}" → true`, () => assert.equal(isAffirmativeAck(input), true));
  }

  test('texto largo no es ack', () => {
    assert.equal(isAffirmativeAck('sí, pero tengo dudas sobre la cobertura'), false);
  });

  test('vacío → false', () => {
    assert.equal(isAffirmativeAck(''), false);
  });
});

// ── extractRelationship ──────────────────────────────────────────────────────

describe('extractRelationship', () => {
  test('detecta "mi marido"', () => {
    assert.equal(extractRelationship('El piso es de mi marido'), 'marido');
  });

  test('detecta "mi madre"', () => {
    assert.equal(extractRelationship('Llamo en nombre de mi madre'), 'madre');
  });

  test('detecta "mi inquilino"', () => {
    assert.ok(extractRelationship('Es el piso de mi inquilino').includes('inquilin'));
  });

  test('sin relación → cadena vacía', () => {
    assert.equal(extractRelationship('Hola, soy el titular'), '');
  });

  test('texto vacío → cadena vacía', () => {
    assert.equal(extractRelationship(''), '');
  });
});
