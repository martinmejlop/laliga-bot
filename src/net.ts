export async function readPublicText(url: string, options: { request?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}) {
  const requestedAt = Date.now();
  const response = await (options.request ?? fetch)(url,{redirect:'error',signal:AbortSignal.timeout(options.timeoutMs ?? 20000),
    headers:{accept:'application/json, text/plain;q=0.9','accept-encoding':'gzip','user-agent':'LaLigaAdvisor/0.2 personal prototype'}});
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const error = new Error(`Fuente pública: HTTP ${response.status}`) as Error & {retryAfterMs:number};
    error.retryAfterMs = Math.max(30000,/^\d+$/.test(retry ?? '')?Number(retry)*1000:(Date.parse(retry ?? '')-Date.now()) || 30000);
    throw error;
  }
  const chunks: Uint8Array[] = []; let bytes=0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Respuesta vacía.');
  try {
    while (true) {
      const part=await reader.read(); if (part.done) break;
      bytes+=part.value.byteLength;
      if (bytes>(options.maxBytes ?? 16000000)) throw new Error('Respuesta demasiado grande.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  return {raw:Buffer.concat(chunks).toString('utf8'),requestedAt,receivedAt:Date.now(),url};
}
