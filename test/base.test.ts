import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadSettings, validateSettings, assertRuntime } from '../src/config.ts';
import { checkAi } from '../src/doctor.ts';

const settings = loadSettings();
const localModel = { name: 'qwen3:8b', digest: 'local-test-digest' };
const response = (data: unknown) => new Response(JSON.stringify(data));

test('El arranque encuentra su configuración incluso fuera de la carpeta del proyecto', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'status'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.match(output, /100\.00/);
  assert.match(output, /saldo actual pendiente/);
  assert.match(output, /Europe\/Madrid/);
  assert.match(output, /conexión no comprobada/);
});

test('Rechaza habilitar ejecución automática, otro servidor o cantidades inválidas', () => {
  assert.throws(() => validateSettings({ ...settings, execution: 'automatic' }));
  assert.throws(() => validateSettings({ ...settings, mode: 'live-trading' }));
  assert.throws(() => validateSettings({ ...settings, ollama: { ...settings.ollama, baseUrl: 'https://example.com' } }));
  for (const initialBudgetEur of [0, -1, Infinity, NaN, 1.001]) {
    assert.throws(() => validateSettings({ ...settings, initialBudgetEur }));
  }
  assert.throws(() => assertRuntime('22.0.0'));
});

test('La comprobación sin inferencia no afirma haber recibido una respuesta', async () => {
  let count = 0;
  const result = await checkAi(settings, false, async url => {
    count++;
    assert.match(url, /\/api\/tags$/);
    return response({ models: [localModel] });
  });
  assert.equal(count, 1);
  assert.equal(result.status, 'available');
  assert.equal(result.inferenceTested, false);
});

test('La prueba usa únicamente descubrimiento local y una inferencia limitada', async () => {
  const calls: string[] = [];
  const result = await checkAi(settings, true, async (url, init) => {
    calls.push(url);
    assert.equal(init?.redirect, 'error');
    if (url.endsWith('/api/tags')) return response({ models: [localModel] });
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.options.num_predict, 64);
    return response({ model: settings.ollama.model, done: true, message: { content: '{"status":"ok"}' } });
  });
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat']);
  assert.equal(result.status, 'available');
  assert.equal(result.inferenceTested, true);
});

test('No simula éxito si el servicio falla, no está el modelo o es remoto', async () => {
  const transport = await checkAi(settings, true, async () => { throw new Error('sin conexión'); });
  assert.equal(transport.status, 'unavailable');
  assert.match(transport.detail, /sin conexión/);
  assert.equal(transport.inferenceTested, false);
  for (const model of [null, { ...localModel, remote_host: 'remote' }]) {
    const result = await checkAi(settings, true, async () => response({ models: model ? [model] : [] }));
    assert.equal(result.status, 'unavailable');
  }
});

test('Respuestas incompletas, incorrectas o llamadas de herramientas no pasan la prueba', async () => {
  for (const envelope of [
    { model: settings.ollama.model, done: false, message: { content: '{"status":"ok"}' } },
    { model: settings.ollama.model, done: true, done_reason: 'length', message: { content: '{"status":"ok"}' } },
    { model: 'other', done: true, message: { content: '{"status":"ok"}' } },
    { model: settings.ollama.model, done: true, message: { content: '{"status":"ok","inventado":true}' } },
    { model: settings.ollama.model, done: true, message: { content: 'no es JSON' } },
    { model: settings.ollama.model, done: true, message: { content: '{"status":"ok"}', tool_calls: [{}] } }
  ]) {
    const result = await checkAi(settings, true, async url => response(url.endsWith('/api/tags') ? { models: [localModel] } : envelope));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.inferenceTested, false);
  }
});

test('HTTP inválido o respuesta desmesurada se muestra como fallo', async () => {
  for (const badResponse of [new Response('error', { status: 503 }), new Response('x'.repeat(200001))]) {
    const result = await checkAi(settings, false, async () => badResponse);
    assert.equal(result.status, 'unavailable');
  }
});
