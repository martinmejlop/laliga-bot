import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchFreeBoard } from '../src/odds/moviodds.ts';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !/^--samples=[1-5]$/.test(args[0]))) throw new Error('Uso: npm.cmd run odds:check [-- --samples=1..5]');
const samples = args.length ? Number(args[0].split('=')[1]) : 1;
const directory = new URL(`../data/free-odds-checks/${new Date().toISOString().replaceAll(':','-')}/`, import.meta.url);
await mkdir(directory, { recursive: true });
let previous = new Map<string, number>();
for (let i = 0; i < samples; i++) {
  if (i) await delay(15000);
  try {
    const board = await fetchFreeBoard();
    await writeFile(new URL(`sample-${i + 1}.json`, directory), JSON.stringify(board, null, 2));
    const current = new Map<string, number>(); let changed = 0;
    for (const m of board.matches) for (const q of m.quotes) {
      const key = JSON.stringify([q.eventId, q.marketId, q.selectionId]);
      if (previous.has(key) && previous.get(key) !== q.price) changed++;
      current.set(key, q.price);
    }
    console.log(JSON.stringify({ sample: i + 1, capturedAt: new Date(board.receivedAt).toISOString(), matches: board.matches.length,
      selections: current.size, observedPriceChanges: changed,
      confirmationAgesSeconds: board.matches.slice(0, 2).map(m => ({ id: m.id, upstreamRefreshSeconds: m.refreshSeconds,
        marketAgeSeconds: m.quotes[0]?.sourceConfirmedAt ? (board.serverTime - m.quotes[0].sourceConfirmedAt) / 1000 : null })),
      regionVerified: false, recommendationsEnabled: false, evidence: directory.pathname }));
    previous = current;
  } catch (error) {
    previous.clear();
    console.error(error instanceof Error ? error.message : 'Comprobación fallida');
    process.exitCode = 2;
    break;
  }
}
