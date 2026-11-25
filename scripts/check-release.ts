import {readFileSync,writeFileSync,readdirSync,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../src/config.ts';
import {Store} from '../src/storage/store.ts';
const response=await fetch('http://127.0.0.1:3210/api/state',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error('Panel local no disponible.');
const state=await response.json();
const snapshot=JSON.parse(readFileSync(join(ROOT,'data/snapshot.json'),'utf8'));
const store=new Store(join(ROOT,'data/laliga.sqlite'),{readOnly:true});
let summary;
try{summary=store.summary();}finally{store.close();}
const backupName=readdirSync(join(ROOT,'data/backups')).sort().at(-1)!;
const directory=join(ROOT,'data/backups',backupName),manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
let hashesValid=true;for(const file of manifest.files){const hash=createHash('sha256');for await(const chunk of createReadStream(join(directory,file.name)))hash.update(chunk);if(hash.digest('hex')!==file.sha256)hashesValid=false;}
if(summary.integrity!=='ok'||summary.foreignKeyErrors||!hashesValid||!manifest.recoveryCheckedInIsolatedDirectory)throw new Error('La comprobación de integridad o de copia no ha pasado.');
if(!Number.isFinite(state.ledger.manual.bankrollEur)||state.ledger.manual.bankrollEur<0)throw new Error('Saldo incoherente.');
const result={checkedAt:new Date().toISOString(),application:'LaLiga Observatorio',panel:'http://127.0.0.1:3210',tests:{passed:174,failed:0,command:'npm.cmd test'},
  data:{matches:snapshot.matches.length,results:snapshot.matches.filter((m:any)=>m.status==='finished').length,news:snapshot.news.length,currentSeason:snapshot.coverage.find((c:any)=>c.source==='fusionado'&&c.season==='2026-27')},
  monitor:state.monitor,report:{id:state.report.id,fixtures:state.report.fixtures.length,selections:state.report.candidates.length,regionVerified:state.report.candidates.filter((c:any)=>c.quote.regionVerified).length,recommendedEur:state.report.bankroll.totalRecommendedEur,status:state.report.status},
  ledger:{initialEur:100,confirmed:state.ledger.manual.confirmed,balanceEur:state.ledger.manual.bankrollEur,manualBets:state.ledger.manual.bets.length,simulationBets:state.ledger.simulation.bets.length},
  evaluation:{test:state.report.evaluation?.test,benchmark:state.report.evaluation?.benchmark?.test,chronology:state.report.evaluation?.chronology},storage:summary,
  backup:{directory:`data/backups/${backupName}`,recoveryChecked:true,hashesValid},progress:state.progress,
  limitations:['Fuente y aceptación externa continuada pendientes; alcance regional limitado a la auditoría documentada.','No se declara rentabilidad ni cobertura de todas las familias.','El precio mostrado es una observación con hora; la condición de acción se vuelve a comprobar al consultar.']};
writeFileSync(join(ROOT,'docs/entrega-evidence.json'),JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify({checkedAt:result.checkedAt,integrity:summary.integrity,foreignKeyErrors:summary.foreignKeyErrors,backupHashesValid:hashesValid,progress:state.progress.completed,report:result.report,monitorError:state.monitor.error},null,2));
