import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ROOT} from '../src/config.ts';
import {evaluateAcceptance,REQUIRED_CONTROLLED_CASES} from '../src/odds/acceptance.ts';
import {auditDatabase} from './acceptance-evidence.ts';
const captureDirectory=process.argv.find(a=>a.startsWith('--captures='))?.slice(11);
const directory=join(ROOT,'data'),testPath=join(directory,'acceptance-controlled.tap'),proofPath=join(directory,'acceptance-controlled.json');
if(process.argv.includes('--test')){
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',join(ROOT,'test/*.test.ts')],{cwd:ROOT,encoding:'utf8',maxBuffer:8000000,timeout:120000});
 const output=(run.stdout??'')+(run.stderr??'');writeFileSync(testPath,output);
 const passed=Number(output.match(/# pass (\d+)/)?.[1]??0),failed=Number(output.match(/# fail (\d+)/)?.[1]??1);
 if(run.status!==0||failed||!passed)throw Error('Las comprobaciones controladas no han pasado; se conserva el resultado.');
 const caseTests:Record<string,string>={
  'price-change-recalculation':'Cambiar una cuota recalcula el valor y retira el importe si desaparece la ventaja',
  'suspension':'Una cuota sin región verificada, suspendida o caducada conserva su motivo y nunca recibe dinero',
  'withdrawal':'Un grupo entero ausente en la misma consulta se retira sin declarar un cierre del operador',
  'provider-failure':'Un fallo posterior a una respuesta válida retira las cuotas en vez de reutilizarlas',
  'retry-after':'Retry-After impide consultar de nuevo antes del plazo indicado por la fuente',
  'stale-response':'Recibir una cuota antigua ahora no la convierte en actual',
  'restart':'El plazo Retry-After y las métricas sobreviven al reinicio sin reutilizar el tablero',
  'budget-limit':'Los fallos consumen presupuesto y el tope conservador de 4800 persiste tras reiniciar'};
 const okNames=new Set([...output.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1].trim()));
 if(!REQUIRED_CONTROLLED_CASES.every(id=>okNames.has(caseTests[id])))throw Error('Falta una comprobación requerida con resultado ok, sin skip/TODO.');
 const sha256=createHash('sha256').update(output).digest('hex'),file=`acceptance-controlled-${sha256}.tap`;
 if(!existsSync(join(directory,file)))writeFileSync(join(directory,file),output);
 writeFileSync(proofPath,JSON.stringify({checkedAt:Date.now(),passed,failed,cases:[...REQUIRED_CONTROLLED_CASES],caseTests,evidenceRef:{captureId:`file:data/${file}`,sha256}},null,2));
}
let controlled=existsSync(proofPath)?JSON.parse(readFileSync(proofPath,'utf8')):null;
if(controlled){const file=String(controlled.evidenceRef?.captureId??'').replace('file:data/','');if(!/^acceptance-controlled-[a-f0-9]{64}\.tap$/.test(file)||!existsSync(join(directory,file))||createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')!==controlled.evidenceRef.sha256)controlled=null;}
const evidence=auditDatabase(join(directory,'laliga.sqlite'),captureDirectory,['40','10114','10544']);
writeFileSync(join(ROOT,'docs/acceptance-evidence-nov22.json'),JSON.stringify(evidence,null,2));
const db=new DatabaseSync(join(directory,'laliga.sqlite'),{readOnly:true});
const sourceSamples:any[]=[];
try{
 for(const [role,source] of [['history','openfootball'],['calendar','espn-experimental'],['news','mundodeportivo:rss'],['odds','moviodds:com']]){
  const row=role==='odds'?db.prepare("SELECT c.id,c.received_at,p.sha256 FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.source_id=? AND p.format IN ('moviodds-laliga-extract-v1','moviodds-live-fixture-v1') ORDER BY c.received_at DESC LIMIT 1").get(source):db.prepare('SELECT c.id,c.received_at,p.sha256 FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.source_id=? ORDER BY c.received_at DESC LIMIT 1').get(source);
  if(row)sourceSamples.push({role,captureId:row.id,sha256:row.sha256,receivedAt:Number(row.received_at),free:true});
 }
}finally{db.close();}
const result=evaluateAcceptance({now:Date.now(),catalog:JSON.parse(readFileSync(join(ROOT,'config/market-catalog.json'),'utf8')),regionalAudit:JSON.parse(readFileSync(join(ROOT,'config/region-audit.json'),'utf8')),sourceSamples,monitorEvidence:evidence.monitorEvidence,controlledChecks:controlled});
const m=evidence.monitorEvidence;
const status={...result,inputs:{sourceSamples,monitorEvidence:evidence.monitorEvidence,controlledChecks:controlled},metrics:{captures:m.captures,priceChanges:m.priceChanges,suspensions:m.explicitSuspensions,withdrawals:m.comparableWithdrawals,httpP95Ms:m.httpDurationMs.p95,confirmationP95Ms:m.confirmationAgeMs.p95},sourceSamples,controlledChecks:controlled};
writeFileSync(join(directory,'acceptance-status.json'),JSON.stringify(status,null,2));
writeFileSync(join(ROOT,'docs/acceptance-status-nov22.json'),JSON.stringify(status,null,2));
const progressPath=join(ROOT,'config/progress.json'),progress=JSON.parse(readFileSync(progressPath,'utf8'));
for(const [taskId,id] of [['T02','02'],['T05','05']]){
 const task=progress.tasks.find((t:any)=>t.id===id),accepted=(status.tasks as any)[taskId];
 task.status=accepted.status==='complete'?'done':'partial';
 task.detail=`${accepted.passed}/${accepted.total} criterios acreditados. ${taskId==='T02'?`${status.regionalSummary.selectionSamples} selecciones contrastadas; catálogo 1X2, doble oportunidad y sin empate.`:`${m.priceChanges} cambios, ${m.comparableWithdrawals} retiradas y ${m.explicitSuspensions} suspensiones explícitas de fuente.`} ${accepted.pending.length?'Pendiente: '+accepted.pending.join(', ')+'.':'Aceptación técnica del catálogo acotado superada.'}`;
}
progress.completed=progress.tasks.filter((t:any)=>t.status==='done').length;progress.updatedAt=new Date().toISOString().slice(0,10);writeFileSync(progressPath,JSON.stringify(progress,null,2));
console.log(JSON.stringify({tasks:status.tasks,regional:status.regionalSummary,metrics:status.metrics,tests:controlled?.passed,propagation:status.enhancements.bookmakerToProviderDelay}));
