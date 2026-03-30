const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../src/ai/aiModel');
const {
  getGeminiModelList,
  getOpenAIModelList,
  isJsonParseError,
  tryOpenAIWithFallbacks,
  parseModelJsonResponse,
  resetModelFallbackState,
} = _test;

function restoreEnvVar(key, value) {
  if (typeof value === 'undefined') delete process.env[key];
  else process.env[key] = value;
}

describe('parseModelJsonResponse', () => {
  test('parsea JSON puro', () => {
    const out = parseModelJsonResponse('{"mensaje_para_usuario":"ok","mensaje_entendido":true,"datos_extraidos":{}}');
    assert.equal(out.mensaje_para_usuario, 'ok');
    assert.equal(out.mensaje_entendido, true);
  });

  test('parsea JSON dentro de bloque markdown', () => {
    const out = parseModelJsonResponse('```json\n{"mensaje_para_usuario":"hola","mensaje_entendido":true,"datos_extraidos":{}}\n```');
    assert.equal(out.mensaje_para_usuario, 'hola');
  });

  test('parsea JSON con texto envolvente', () => {
    const out = parseModelJsonResponse('Respuesta:\n{"mensaje_para_usuario":"vale","mensaje_entendido":true,"datos_extraidos":{}}\nGracias');
    assert.equal(out.mensaje_para_usuario, 'vale');
  });

  test('lanza error con JSON truncado', () => {
    assert.throws(
      () => parseModelJsonResponse('{"mensaje_para_usuario":"hola"'),
      /SyntaxError|JSON|No se pudo parsear JSON/
    );
  });
});

describe('isJsonParseError', () => {
  test('detecta SyntaxError como parse error', () => {
    assert.equal(isJsonParseError(new SyntaxError('Unexpected end of JSON input')), true);
  });

  test('no marca errores genéricos no JSON', () => {
    assert.equal(isJsonParseError(new Error('network timeout')), false);
  });
});

describe('model lists', () => {
  test('getGeminiModelList devuelve principal + fallbacks únicos', () => {
    const prevPrimary = process.env.GEMINI_MODEL;
    const prevFallbacks = process.env.GEMINI_MODEL_FALLBACKS;

    try {
      process.env.GEMINI_MODEL = 'gemini-main';
      process.env.GEMINI_MODEL_FALLBACKS = 'gemini-fallback-1, gemini-fallback-2, gemini-main';
      assert.deepEqual(getGeminiModelList(), ['gemini-main', 'gemini-fallback-1', 'gemini-fallback-2']);
    } finally {
      restoreEnvVar('GEMINI_MODEL', prevPrimary);
      restoreEnvVar('GEMINI_MODEL_FALLBACKS', prevFallbacks);
      resetModelFallbackState();
    }
  });

  test('getOpenAIModelList devuelve principal + fallbacks únicos', () => {
    const prevPrimary = process.env.OPENAI_MODEL;
    const prevFallbacks = process.env.OPENAI_MODEL_FALLBACKS;

    try {
      process.env.OPENAI_MODEL = 'gpt-main';
      process.env.OPENAI_MODEL_FALLBACKS = 'gpt-fallback-1, gpt-fallback-2, gpt-main';
      assert.deepEqual(getOpenAIModelList(), ['gpt-main', 'gpt-fallback-1', 'gpt-fallback-2']);
    } finally {
      restoreEnvVar('OPENAI_MODEL', prevPrimary);
      restoreEnvVar('OPENAI_MODEL_FALLBACKS', prevFallbacks);
      resetModelFallbackState();
    }
  });

  test('getOpenAIModelList usa fallback por defecto si no hay OPENAI_MODEL_FALLBACKS', () => {
    const prevPrimary = process.env.OPENAI_MODEL;
    const prevFallbacks = process.env.OPENAI_MODEL_FALLBACKS;

    try {
      process.env.OPENAI_MODEL = 'gpt-5-mini';
      delete process.env.OPENAI_MODEL_FALLBACKS;
      assert.deepEqual(getOpenAIModelList(), ['gpt-5-mini', 'gpt-5-pro']);
    } finally {
      restoreEnvVar('OPENAI_MODEL', prevPrimary);
      restoreEnvVar('OPENAI_MODEL_FALLBACKS', prevFallbacks);
      resetModelFallbackState();
    }
  });
});

describe('tryOpenAIWithFallbacks', () => {
  test('salta al siguiente modelo OpenAI si el principal responde 429', async () => {
    const prevEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL: process.env.OPENAI_MODEL,
      OPENAI_MODEL_FALLBACKS: process.env.OPENAI_MODEL_FALLBACKS,
      OPENAI_FALLBACK_ENABLED: process.env.OPENAI_FALLBACK_ENABLED,
      OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS,
      OPENAI_JSON_RETRIES_PER_MODEL: process.env.OPENAI_JSON_RETRIES_PER_MODEL,
    };
    const prevFetch = global.fetch;
    const seenModels = [];

    try {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.OPENAI_MODEL = 'gpt-main';
      process.env.OPENAI_MODEL_FALLBACKS = 'gpt-fallback-1,gpt-fallback-2';
      process.env.OPENAI_FALLBACK_ENABLED = 'true';
      process.env.OPENAI_TIMEOUT_MS = '1000';
      process.env.OPENAI_JSON_RETRIES_PER_MODEL = '0';
      resetModelFallbackState();

      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        seenModels.push(body.model);

        if (body.model === 'gpt-main') {
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: { message: 'rate limit exceeded' } }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: '{"mensaje_para_usuario":"ok","mensaje_entendido":true,"datos_extraidos":{}}',
              },
            }],
          }),
        };
      };

      const data = await tryOpenAIWithFallbacks({
        validHistory: [],
        promptFinal: 'prompt',
        contextoExtra: 'contexto',
        mensajeUsuario: 'hola',
      });

      assert.equal(data?.mensaje_para_usuario, 'ok');
      assert.deepEqual(seenModels, ['gpt-main', 'gpt-fallback-1']);
    } finally {
      global.fetch = prevFetch;
      for (const [key, value] of Object.entries(prevEnv)) restoreEnvVar(key, value);
      resetModelFallbackState();
    }
  });
});
