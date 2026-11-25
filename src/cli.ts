import { assertRuntime, loadSettings, ROOT } from './config.ts';
import { checkAi } from './doctor.ts';
import { readFileSync } from 'node:fs';

async function main() {
  assertRuntime();
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';
  if (!['status', 'sources', 'doctor', 'help'].includes(command) || args.slice(1).some(arg => arg !== '--probe') || args.length > 2 ||
      (command !== 'doctor' && args.length > 1)) {
    throw new Error('Uso: npm.cmd run status | npm.cmd run sources | npm.cmd run doctor [-- --probe]');
  }
  if (command === 'help') {
    console.log('Estado: npm.cmd run status\nFuentes: npm.cmd run sources\nArchivo de datos: npm.cmd run storage:status\nComprobar almacenamiento: npm.cmd run storage:check\nComprobar conexión: npm.cmd run doctor\nProbar respuesta de Qwen: npm.cmd run doctor -- --probe');
    return;
  }
  const settings = loadSettings();
  console.log('ASISTENTE DE LALIGA — BASE DEL PROYECTO');
  console.log(`Carpeta: ${ROOT}`);
  console.log(`Competición: ${settings.competition} | Casa: Bet365 | Moneda: ${settings.currency}`);
  console.log(`Presupuesto inicial configurado: ${settings.initialBudgetEur.toFixed(2)} € (saldo actual pendiente de registrar)`);
  console.log(`Hora local: ${new Date().toLocaleString('es-ES', { timeZone: settings.timezone })} (${settings.timezone})`);
  console.log('Funcionamiento: recomendaciones; todas las apuestas y movimientos los realiza el usuario.');
  const progress=JSON.parse(readFileSync(new URL('../config/progress.json',import.meta.url),'utf8'));
  console.log(`Estado: ${progress.completed} de ${progress.total} tareas comprobadas. Detalle en PROGRESO.md y en el panel.`);
  console.log('Cuotas: conector gratuito probado; contraste Bet365 España pendiente. Presupuesto de datos: 0 €.');
  if (command === 'sources') {
    const catalog = JSON.parse(readFileSync(new URL('../config/sources.json', import.meta.url), 'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.sources) || catalog.oddsMode !== 'automatic-bet365-required' || catalog.paidServicesActivated !== false || catalog.freeOnly !== true || catalog.monthlyDataBudgetEur !== 0) {
      throw new Error('Catálogo de fuentes ausente o incompatible con el alcance actual.');
    }
    console.log(`\nFUENTES — revisión ${catalog.reviewedOn}`);
    for (const source of catalog.sources) {
      console.log(`\n${source.role}: ${source.status}\n${source.url}\nAcceso: ${source.access}\nCoste: ${source.cost}\nLimitaciones: ${source.limitations}`);
    }
    console.log('\nDetalle y muestras: docs/FUENTES.md. Esto no descarga datos ni activa proveedores.');
    return;
  }
  if (command === 'status') {
    console.log('Panel continuo: http://127.0.0.1:3210. Abre Iniciar bot.cmd o ejecuta npm.cmd start.');
    console.log('Históricos, modelo, noticias, registro manual e informe integrados. Las limitaciones de datos siguen visibles.');
    console.log('Lista visual: PROGRESO.md | Consultar el archivo: npm.cmd run storage:status');
    console.log('IA configurada: Qwen3 8B local mediante Ollama; conexión no comprobada en este comando.');
    return;
  }
  const ai = await checkAi(settings, args.includes('--probe'));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ai }, null, 2));
  if (ai.status !== 'available') process.exitCode = 2;
}

main().catch(error => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
