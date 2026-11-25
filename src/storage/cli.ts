import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertRuntime, ROOT } from '../config.ts';
import { Store } from './store.ts';
import { registerObservedSources } from './import-board.ts';

function main() {
  assertRuntime();
  const [command,...args] = process.argv.slice(2);
  const validation = args.includes('--validation');
  const values = args.filter(x => x !== '--validation');
  if (!['init','status','evidence'].includes(command) || args.filter(x => x === '--validation').length>1 ||
      (command === 'init' && validation) || (command !== 'evidence' && values.length) ||
      (command === 'evidence' && (values.length !== 1 || !/^[0-9a-f-]{36}$/.test(values[0])))) {
    throw new Error('Uso: storage:init | storage:status [-- --validation] | storage:evidence -- ID [--validation]');
  }
  const path = join(ROOT,'data',validation?'storage-validation.sqlite':'laliga.sqlite');
  if (command !== 'init' && !existsSync(path)) throw new Error('La base todavía no existe. Ejecuta storage:init o storage:check para la comprobación aislada.');
  const store = new Store(path,{readOnly:command !== 'init'});
  try {
    if (command === 'init') registerObservedSources(store);
    console.log(validation?'ARCHIVO DE COMPROBACIÓN — capturas antiguas, sin recomendaciones':'ALMACENAMIENTO DEL BOT DE LALIGA');
    console.log(`Archivo: ${path}`);
    console.log(JSON.stringify(command === 'evidence'?store.evidence(values[0]):store.summary(),null,2));
    if (command === 'init') console.log('Base preparada. Históricos, vigilancia de cuotas y modelos pendientes de sus próximas tareas.');
  } finally { store.close(); }
}
try { main(); }
catch (error) { console.error(`ERROR: ${error instanceof Error?error.message:String(error)}`); process.exitCode=1; }
