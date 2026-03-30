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
  isNegativeAck,
  isExplicitHumanEscalationIntent,
  extractRelationship,
  normalizeSchedulePreference,
  shouldAssumeDigitalAcceptance,
  shouldBlockEarlyTerminalStage,
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

describe('isNegativeAck', () => {
  for (const input of ['no', 'negativo', 'prefiero no', 'rechazo']) {
    test(`"${input}" → true`, () => assert.equal(isNegativeAck(input), true));
  }

  test('"sí" → false', () => {
    assert.equal(isNegativeAck('sí'), false);
  });
});

describe('isExplicitHumanEscalationIntent', () => {
  test('detecta petición explícita de llamada', () => {
    assert.equal(isExplicitHumanEscalationIntent('Prefiero que me llamen por teléfono'), true);
  });

  test('detecta petición de hablar con una persona', () => {
    assert.equal(isExplicitHumanEscalationIntent('Quiero hablar con una persona'), true);
  });

  test('respuesta neutra → false', () => {
    assert.equal(isExplicitHumanEscalationIntent('sí'), false);
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

describe('normalizeSchedulePreference', () => {
  test('"mañana" → "Mañana"', () => {
    assert.equal(normalizeSchedulePreference('mañana'), 'Mañana');
  });

  test('"tarde" → "Tarde"', () => {
    assert.equal(normalizeSchedulePreference('tarde'), 'Tarde');
  });

  test('valor vacío → cadena vacía', () => {
    assert.equal(normalizeSchedulePreference(''), '');
  });
});

describe('shouldAssumeDigitalAcceptance', () => {
  test('si la IA marca acepta_videollamada=true, devuelve true', () => {
    assert.equal(shouldAssumeDigitalAcceptance({
      extractedDigital: true,
      existingDigital: '',
      preferredSchedule: 'Mañana',
    }), true);
  });

  test('si hay preferencia horaria y no existe rechazo previo, asume aceptación', () => {
    assert.equal(shouldAssumeDigitalAcceptance({
      extractedDigital: undefined,
      existingDigital: '',
      preferredSchedule: 'Tarde',
    }), true);
  });

  test('si existe rechazo previo, no fuerza digital sí', () => {
    assert.equal(shouldAssumeDigitalAcceptance({
      extractedDigital: undefined,
      existingDigital: 'No',
      preferredSchedule: 'Mañana',
    }), false);
  });

  test('sin preferencia horaria, no asume aceptación', () => {
    assert.equal(shouldAssumeDigitalAcceptance({
      extractedDigital: undefined,
      existingDigital: '',
      preferredSchedule: '',
    }), false);
  });
});

describe('shouldBlockEarlyTerminalStage', () => {
  test('bloquea finalizado en consent', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'consent',
      nextStage: 'finalizado',
      userText: 'sí',
      hasOutgoingMessage: true,
    }), true);
  });

  test('bloquea escalated en identification si no hay motivo explícito', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'identification',
      nextStage: 'escalated',
      userText: 'sí',
      hasOutgoingMessage: true,
    }), true);
  });

  test('permite escalated en consent si el usuario rechaza continuar', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'consent',
      nextStage: 'escalated',
      userText: 'no',
      hasOutgoingMessage: true,
    }), false);
  });

  test('permite escalated en stage temprano si pide atención humana', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'identification',
      nextStage: 'escalated',
      userText: 'Prefiero hablar con una persona',
      hasOutgoingMessage: true,
    }), false);
  });

  test('no bloquea escalado técnico sin mensaje saliente', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'consent',
      nextStage: 'escalated',
      userText: 'sí',
      hasOutgoingMessage: false,
    }), false);
  });

  test('no bloquea finalizado fuera de stages tempranos', () => {
    assert.equal(shouldBlockEarlyTerminalStage({
      currentStage: 'agendando',
      nextStage: 'finalizado',
      userText: 'mañana',
      hasOutgoingMessage: true,
    }), false);
  });
});
