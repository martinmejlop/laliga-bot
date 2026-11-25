import {join} from 'node:path';
import {ROOT} from '../config.ts';
import {readJson} from '../files.ts';
import {evaluateAcceptance} from './acceptance.ts';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

function currentSourceSamples(directory:string,fallback:any[]) {
  const path=join(directory,'laliga.sqlite');if(!existsSync(path))return fallback;
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(path,{readOnly:true});
    return [['history','openfootball'],['calendar','espn-experimental'],['news','mundodeportivo:rss'],['odds','moviodds:com']].flatMap(([role,source])=>{
      const row=db!.prepare("SELECT c.id,c.received_at,p.sha256 FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.source_id=? AND (?<>'odds' OR p.format IN ('moviodds-laliga-extract-v1','moviodds-live-fixture-v1')) ORDER BY c.received_at DESC LIMIT 1").get(source,role);
      return row?[{role,captureId:row.id,sha256:row.sha256,receivedAt:Number(row.received_at),free:true}]:[];
    });
  }catch{return [];}finally{db?.close();}
}

/** Re-check time-sensitive acceptance against today's configuration on every read. */
export function loadAcceptance(directory:string,now=Date.now(),options:{catalog?:unknown;regionalAudit?:unknown}={}) {
  const saved=readJson<any>(join(directory,'acceptance-status.json'),null);
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return null;
  const inputs=saved.inputs&&typeof saved.inputs==='object'&&!Array.isArray(saved.inputs)?saved.inputs:{};
  const catalog=options.catalog!==undefined?options.catalog:readJson(join(ROOT,'config/market-catalog.json'),null);
  const regionalAudit=options.regionalAudit!==undefined?options.regionalAudit:readJson(join(ROOT,'config/region-audit.json'),null);
  const evaluated=evaluateAcceptance({now,catalog,regionalAudit,
    sourceSamples:currentSourceSamples(directory,Array.isArray(inputs.sourceSamples)?inputs.sourceSamples:[]),
    monitorEvidence:inputs.monitorEvidence??null,controlledChecks:inputs.controlledChecks??null});
  const {inputs:unusedInputs,...publicEvidence}=saved;
  // checkedAt is when the evidence was compiled; evaluatedAt is the current gate check.
  return {...publicEvidence,...evaluated,checkedAt:saved.checkedAt??null,evaluatedAt:now};
}
