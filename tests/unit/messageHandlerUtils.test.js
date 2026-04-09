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
  canApplyStageTransition,
  getNonTerminalAiStateForStage,
  extractRelationship,
  normalizeSchedulePreference,
  shouldAssumeDigitalAcceptance,
  shouldBlockEarlyTerminalStage,
  hasMeaningfulAttendee,
  detectNextRequiredTask,
  looksLikeClosureMessage,
  isAllowedTerminalTurn,
  getFallbackAiStateForTask,
  buildSummaryFallbackMessage,
  buildForcedConsentConfirmationResponse,
  buildForcedAttendeeConfirmationResponse,
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

describe('looksLikeClosureMessage', () => {
  test('detecta cierre tipo "le contactaremos en breve"', () => {
    assert.equal(
      looksLikeClosureMessage('Su caso está siendo atendido por nuestro equipo. Le contactaremos en breve. Gracias por su paciencia.'),
      true
    );
  });

  test('no marca una pregunta normal como cierre', () => {
    assert.equal(
      looksLikeClosureMessage('Gracias. Según nuestros datos, la dirección del riesgo es Calle Río Genil 3. ¿Es correcto?'),
      false
    );
  });
});

describe('isAllowedTerminalTurn', () => {
  test('permite cierre definitivo tras confirmar resumen final y preferencia horaria', () => {
    assert.equal(isAllowedTerminalTurn({
      currentStage: 'agendando',
      nextStage: 'finalizado',
      userText: 'sí',
      lastBotResponseType: 'resumen_final',
      responseType: 'cierre_definitivo',
      preferredSchedule: 'Mañana',
    }), true);
  });

  test('bloquea texto de cierre sin resumen previo', () => {
    assert.equal(isAllowedTerminalTurn({
      currentStage: 'identification',
      nextStage: 'finalizado',
      userText: 'sí',
      lastBotResponseType: 'normal',
      responseType: 'normal',
    }), false);
  });

  test('bloquea cierre definitivo si falta preferencia horaria', () => {
    assert.equal(isAllowedTerminalTurn({
      currentStage: 'agendando',
      nextStage: 'finalizado',
      userText: 'sí',
      lastBotResponseType: 'resumen_final',
      responseType: 'cierre_definitivo',
      preferredSchedule: '',
    }), false);
  });

  test('permite escalado cuando el usuario pide una persona', () => {
    assert.equal(isAllowedTerminalTurn({
      currentStage: 'identification',
      nextStage: 'escalated',
      userText: 'Quiero hablar con una persona',
      lastBotResponseType: 'normal',
      responseType: 'cierre_definitivo',
    }), true);
  });
});

describe('hasMeaningfulAttendee', () => {
  test('true si ya hay AT. Perito guardado', () => {
    assert.equal(
      hasMeaningfulAttendee({ attPerito: 'Matilde - asegurada - 34600000000' }, {}),
      true
    );
  });

  test('true si el último mensaje preguntaba por AT. Perito y el usuario responde sí', () => {
    assert.equal(
      hasMeaningfulAttendee({}, {
        lastBotMessage: '¿Será usted misma quien atienda al perito en la vivienda?',
        userText: 'sí',
      }),
      true
    );
  });
});

describe('detectNextRequiredTask', () => {
  test('si falta AT. Perito, lo fuerza antes del cierre', () => {
    assert.equal(detectNextRequiredTask({
      conversation: {},
      lastBotMessage: 'Según nos consta, el siniestro es por daños por agua. ¿Es correcto?',
      userText: 'sí',
      estimateAlreadyKnown: false,
      extractedDigital: undefined,
      preferredSchedule: '',
      locationAlreadyShared: false,
      locationRequestCount: 0,
    }), 'confirmar_at_perito');
  });

  test('si AT. Perito ya está y falta estimación, fuerza estimación', () => {
    assert.equal(detectNextRequiredTask({
      conversation: { attPerito: 'Matilde - asegurada - 34600000000' },
      lastBotMessage: 'Según nos consta, el siniestro es por daños por agua. ¿Es correcto?',
      userText: 'sí',
      estimateAlreadyKnown: false,
      extractedDigital: undefined,
      preferredSchedule: '',
      locationAlreadyShared: false,
      locationRequestCount: 0,
    }), 'pedir_estimacion');
  });

  test('si falta ubicación tras completar lo demás, fuerza ubicación', () => {
    assert.equal(detectNextRequiredTask({
      conversation: {
        attPerito: 'Matilde - asegurada - 34600000000',
        danos: '200 €',
        digital: 'No',
        horario: 'Mañana',
      },
      lastBotMessage: 'Gracias',
      userText: 'ok',
      estimateAlreadyKnown: true,
      extractedDigital: false,
      preferredSchedule: 'Mañana',
      locationAlreadyShared: false,
      locationRequestCount: 0,
    }), 'pedir_ubicacion');
  });

  test('si falta preferencia horaria no permite resumir aunque la visita sea presencial', () => {
    assert.equal(detectNextRequiredTask({
      conversation: { attPerito: 'Matilde - asegurada - 34600000000', danos: '200 €', digital: 'No' },
      lastBotMessage: 'Gracias',
      userText: 'ok',
      estimateAlreadyKnown: true,
      extractedDigital: false,
      preferredSchedule: '',
      locationAlreadyShared: true,
      locationRequestCount: 0,
    }), 'pedir_preferencia_horaria');
  });
});

describe('canApplyStageTransition', () => {
  test('permite consent → identification', () => {
    assert.equal(canApplyStageTransition('consent', 'identification'), true);
  });

  test('permite identification → valoracion', () => {
    assert.equal(canApplyStageTransition('identification', 'valoracion'), true);
  });

  test('permite mantener el mismo stage', () => {
    assert.equal(canApplyStageTransition('identification', 'identification'), true);
  });

  test('bloquea saltos inválidos', () => {
    assert.equal(canApplyStageTransition('consent', 'finalizado'), false);
  });
});

describe('getNonTerminalAiStateForStage', () => {
  test('consent → identificacion', () => {
    assert.equal(getNonTerminalAiStateForStage('consent'), 'identificacion');
  });

  test('identification → identificacion', () => {
    assert.equal(getNonTerminalAiStateForStage('identification'), 'identificacion');
  });

  test('valoracion → valoracion', () => {
    assert.equal(getNonTerminalAiStateForStage('valoracion'), 'valoracion');
  });

  test('agendando → agendando', () => {
    assert.equal(getNonTerminalAiStateForStage('agendando'), 'agendando');
  });
});

describe('getFallbackAiStateForTask', () => {
  test('resumen final desde identification avanza a valoracion', () => {
    assert.equal(getFallbackAiStateForTask('identification', 'resumen_final'), 'valoracion');
  });

  test('otras tareas conservan el estado no terminal actual', () => {
    assert.equal(getFallbackAiStateForTask('identification', 'pedir_estimacion'), 'identificacion');
  });
});

describe('buildSummaryFallbackMessage', () => {
  test('construye un resumen final con los datos conocidos y pide confirmación', () => {
    const message = buildSummaryFallbackMessage({
      conversation: {
        attPerito: 'Matilde Ascension Linares Ales - asegurada - 34600000000',
        danos: '2000 €',
        digital: 'No',
      },
      valoresExcel: {
        direccion: 'RIO GENIL 3, 2ºD',
        municipio: 'Vélez-Málaga',
        causa: 'Daños por agua',
        nombre: 'Matilde Ascension Linares Ales',
      },
      locationAlreadyShared: false,
    });

    assert.match(message, /Dirección del siniestro: RIO GENIL 3, 2ºD, Vélez-Málaga\./);
    assert.match(message, /Causa del siniestro: Daños por agua\./);
    assert.match(message, /Persona que atenderá al perito: Matilde Ascension Linares Ales \(asegurada\)\./);
    assert.match(message, /Estimación aproximada de daños: 2000 €\./);
    assert.match(message, /Modalidad prevista: visita presencial\./);
    assert.match(message, /Ubicación del riesgo: pendiente de envío\./);
    assert.match(message, /responda "sí"/);
  });
});

describe('buildForcedAttendeeConfirmationResponse', () => {
  test('tras confirmar AT. Perito fuerza la petición de estimación y rellena el contacto', () => {
    const response = buildForcedAttendeeConfirmationResponse({
      valoresExcel: { nombre: 'Matilde Ascension Linares Ales' },
      waId: '34674742564',
      relation: 'asegurada',
    });

    assert.equal(
      response.mensaje_para_usuario,
      '¿Podría indicarnos una estimación aproximada del importe de los daños?'
    );
    assert.equal(response.datos_extraidos.estado_expediente, 'valoracion');
    assert.equal(response.datos_extraidos.nombre_contacto, 'Matilde Ascension Linares Ales');
    assert.equal(response.datos_extraidos.relacion_contacto, 'asegurada');
    assert.equal(response.datos_extraidos.telefono_contacto, '34674742564');
  });
});

describe('buildForcedConsentConfirmationResponse', () => {
  test('tras confirmar consentimiento fuerza la pregunta de identidad', () => {
    const response = buildForcedConsentConfirmationResponse({
      valoresExcel: { nombre: 'LINARES ALES, MATILDE ASCENSION' },
    });

    assert.equal(response.mensaje_para_usuario, '¿Hablo con LINARES ALES, MATILDE ASCENSION?');
    assert.equal(response.datos_extraidos.estado_expediente, 'identificacion');
    assert.equal(response.datos_extraidos.tipo_respuesta, 'pregunta_identidad');
  });
});
