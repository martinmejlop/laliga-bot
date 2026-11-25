import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../src/config.ts';
import {comparePublicMarkets} from '../src/odds/public-comparison.ts';
import {Store} from '../src/storage/store.ts';
import {registerObservedSources,MOVIODDS_SOURCE} from '../src/storage/import-board.ts';
import {allMatches} from '../src/odds/moviodds.ts';
const [id,run]=process.argv.slice(2);if(!/^\d+$/.test(id??'')||!run)throw Error('Indica partido y serie de lectura.');
const proofPath=join(ROOT,`data/regional-evidence/2026-11-23/${id}.json`),proofText=readFileSync(proofPath,'utf8'),proof=JSON.parse(proofText);
const capture=JSON.parse(readFileSync(join(run,`000-${id}.json`),'utf8'));
const board=JSON.parse(readFileSync(join(ROOT,'data/latest-odds.json'),'utf8')),event=allMatches(board).find(m=>m.id===id);if(!event)throw Error('Partido ausente del catálogo identificado.');
const comparison=comparePublicMarkets(proof,capture,event),store=new Store(join(ROOT,'data/laliga.sqlite'));
try{registerObservedSources(store);
 const captureId=store.capture({sourceId:MOVIODDS_SOURCE,ingestionKey:`current-comparison:${id}:${capture.receivedAt}`,url:capture.url,format:event.competition==='Champions'?'moviodds-champions-live-v1':'moviodds-live-fixture-v1',rawText:capture.raw,requestedAt:capture.requestedAt,receivedAt:capture.receivedAt});
 store.registerSource('bet365-es-public','Bet365 España — contraste público','https://www.bet365.es/','Lectura pública puntual; no acredita condiciones particulares de cuenta ni disponibilidad permanente.');
 const publicCaptureId=store.capture({sourceId:'bet365-es-public',ingestionKey:`current-comparison:${id}:${proof.checkedAt}`,url:proof.url,format:'bet365-es-public-dom-v1',rawText:proofText,receivedAt:proof.checkedAt});
 for(const entry of comparison.coverage)Object.assign(entry,{publicCaptureRef:{captureId:publicCaptureId,sha256:createHash('sha256').update(proofText).digest('hex')},providerCaptureRef:{captureId,sha256:createHash('sha256').update(capture.raw).digest('hex')}});
 const path=join(ROOT,'config/region-audit.json'),audit=JSON.parse(readFileSync(path,'utf8'));
 // Una observación nueva sustituye a la anterior también cuando discrepa; nunca recurrir a un precio antiguo conveniente.
 audit.coverage=audit.coverage.filter((e:any)=>e.eventId!==id||!['40','10114','10544'].includes(e.groupId));audit.coverage.push(...comparison.coverage);
 writeFileSync(path,JSON.stringify(audit,null,2)+'\n');
 writeFileSync(join(ROOT,`data/regional-evidence/2026-11-23/comparison-${id}.json`),JSON.stringify({...comparison,captureId,publicCaptureId},null,2)+'\n');
 const indexPath=join(ROOT,'data/bet365-comparisons.json'),index=existsSync(indexPath)?JSON.parse(readFileSync(indexPath,'utf8')):[];
 writeFileSync(indexPath,JSON.stringify([...index.filter((e:any)=>e.eventId!==id),{...comparison,captureId,publicCaptureId}],null,2)+'\n');
 console.log(JSON.stringify({event:comparison.eventName,markets:comparison.comparisons.map(c=>({name:c.heading,matched:c.matched})),selections:comparison.coverage.reduce((n,e)=>n+e.selections.length,0)}));
}finally{store.close();}
