import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,copyFileSync,existsSync,readFileSync,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store} from './storage/store.ts';
import {Ledger} from './ledger/service.ts';
import {writeJson} from './files.ts';
import {ROOT} from './config.ts';

async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

export async function backupRuntime(directory:string,reportsDirectory:string) {
  const target=join(directory,'backups',`${new Date().toISOString().replaceAll(':','-')}-${randomUUID().slice(0,8)}`);
  mkdirSync(target,{recursive:true});const files:any[]=[];
  // Copiar referencias antes de la base: el archivo es append-only y conservará sus capturas.
  for(const name of ['snapshot.json','model-state.json','evaluation.json','preferences.json','latest-odds.json','odds-usage.json','news-analysis.json','decisions.json','odds-requests.json','odds-scopes.json','odds-retry.json','price-changes.json','acceptance-status.json','acceptance-controlled.json','acceptance-controlled.tap','bet365-comparisons.json','champions-snapshot.json','champions-model-state.json','champions-evaluation.json']){
    const source=join(directory,name);if(!existsSync(source))continue;
    copyFileSync(source,join(target,name));files.push({name,sha256:await hashFile(join(target,name))});
  }
  if(existsSync(join(directory,'acceptance-controlled.json'))){
    const proof=JSON.parse(readFileSync(join(directory,'acceptance-controlled.json'),'utf8'));
    const name=String(proof.evidenceRef?.captureId??'').replace('file:data/','');
    if(/^acceptance-controlled-[a-f0-9]{64}\.tap$/.test(name)&&existsSync(join(directory,name))){copyFileSync(join(directory,name),join(target,name));files.push({name,sha256:await hashFile(join(target,name))});}
  }
  if(existsSync(join(reportsDirectory,'latest.html')))copyFileSync(join(reportsDirectory,'latest.html'),join(target,'latest-report.html'));
  mkdirSync(join(target,'config'),{recursive:true});
  for(const name of ['champions-teams.json','champions-market-catalog.json','settings.json','sources.json','team-aliases.json','region-audit.json','market-catalog.json','progress.json'])if(existsSync(join(ROOT,'config',name)))copyFileSync(join(ROOT,'config',name),join(target,'config',name));
  for(const name of ['laliga.sqlite','ledger.sqlite']){
    if(!existsSync(join(directory,name)))continue;
    const db=new DatabaseSync(join(directory,name),{readOnly:true});
    try {await backup(db,join(target,name));}finally{db.close();}
    files.push({name,sha256:await hashFile(join(target,name))});
  }
  let sourceChecks:any=null,ledgerChecks:any=null;
  if(existsSync(join(target,'laliga.sqlite'))){
    const restored=new Store(join(target,'laliga.sqlite'),{readOnly:true});
    try {
      sourceChecks=restored.summary();
      if(sourceChecks.integrity!=='ok'||sourceChecks.foreignKeyErrors!==0)throw new Error('La copia no supera la comprobación de integridad.');
      for(const snapshotName of ['snapshot.json','champions-snapshot.json'])if(existsSync(join(target,snapshotName))){
        const snapshot=JSON.parse(readFileSync(join(target,snapshotName),'utf8'));
        for(const id of new Set([...snapshot.matches.map((m:any)=>m.captureId),...snapshot.news.map((n:any)=>n.captureId)]))restored.evidence(String(id));
      }
    }finally{restored.close();}
  }
  if(existsSync(join(target,'ledger.sqlite'))){const restored=new Ledger(join(target,'ledger.sqlite'));try{const s=restored.snapshot();ledgerChecks={events:s.events.length,manual:s.manual,simulation:s.simulation};}finally{restored.close();}}
  const manifest={createdAt:new Date().toISOString(),files,sourceChecks,ledgerChecks,recoveryCheckedInIsolatedDirectory:true,note:'Copia SQLite coherente, incluidos datos todavía presentes en WAL. No se ha sustituido ningún archivo de uso diario.'};
  writeJson(join(target,'manifest.json'),manifest);
  return {message:'Copia creada y recuperación comprobada en una carpeta aislada.',directory:target,manifest};
}
