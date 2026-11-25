import type { Settings } from './config.ts';

type Request = (url: string, init?: RequestInit) => Promise<Response>;
export interface AiCheck {
  status: 'available' | 'unavailable';
  model: string;
  inferenceTested: boolean;
  detail: string;
  durationMs: number;
  digest?: string;
}

async function jsonResponse(response: Response): Promise<any> {
  if (!response.ok) throw new Error(`Ollama devolvió HTTP ${response.status}.`);
  // Limitar el tamaño también cuando no se anuncia Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Ollama devolvió una respuesta vacía.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 200000) throw new Error('Respuesta de Ollama demasiado grande.');
      chunks.push(result.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function checkAi(settings: Settings, probe = false, request: Request = fetch): Promise<AiCheck> {
  const started = Date.now();
  const { baseUrl, model, timeoutMs } = settings.ollama;
  // Un solo plazo para descubrimiento e inferencia; sin descargas ni reintentos.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const tags = await jsonResponse(await request(`${baseUrl}/api/tags`, { signal, redirect: 'error' }));
    const found = Array.isArray(tags.models) ? tags.models.find((item: any) => item.name === model) : null;
    if (!found || typeof found.digest !== 'string' || !found.digest || found.remote_model || found.remote_host) {
      throw new Error('Qwen3 8B local no aparece disponible. Abre Ollama y comprueba el modelo ya instalado.');
    }
    if (probe) {
      const result = await jsonResponse(await request(`${baseUrl}/api/chat`, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ model, stream: false, think: false, keep_alive: '5m',
          format: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } }, required: ['status'], additionalProperties: false },
          options: { temperature: 0, num_ctx: 4096, num_predict: 64 },
          messages: [{ role: 'user', content: 'Prueba de conexión local. Devuelve exactamente el objeto JSON {"status":"ok"}.' }] })
      }));
      if (result.done !== true || result.done_reason === 'length' || result.model !== model || result.message?.tool_calls?.length) {
        throw new Error('La respuesta de Qwen está incompleta o no corresponde al modelo esperado.');
      }
      const answer = JSON.parse(result.message?.content);
      if (!answer || Object.keys(answer).length !== 1 || answer.status !== 'ok') throw new Error('Qwen no devolvió la respuesta de prueba esperada.');
    }
    return { status: 'available', model, inferenceTested: probe, digest: found.digest,
      detail: probe ? 'Qwen respondió correctamente a la prueba local. No es una prueba de precisión deportiva.' : 'Modelo local encontrado; inferencia aún no comprobada.', durationMs: Date.now() - started };
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    return { status: 'unavailable', model, inferenceTested: false,
      detail: `No se pudo completar la comprobación: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ''}. Comprueba que Ollama esté abierto. No se ha generado análisis de IA.`, durationMs: Date.now() - started };
  }
}
