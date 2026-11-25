import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../src/config.ts';
import {Store} from '../src/storage/store.ts';
import {MOVIODDS_SOURCE,registerObservedSources} from '../src/storage/import-board.ts';
import {capturedFrames} from './acceptance-evidence.ts';
const directory=process.argv[2];if(!directory)throw Error('Directorio de captura requerido.');
const store=new Store(join(ROOT,'data/laliga.sqlite'));let count=0;
try {
 registerObservedSources(store);
 for(const frame of capturedFrames(directory).frames){
  const server=Date.parse(frame.raw.server_time);
  const originalRaw=JSON.parse(readFileSync(join(directory,frame.id.split(':')[1]),'utf8')).raw;
  if(createHash('sha256').update(originalRaw).digest('hex')!==frame.sha256)throw Error('Captura alterada durante la importación.');
  store.capture({sourceId:MOVIODDS_SOURCE,ingestionKey:`acceptance:${frame.sha256}`,url:frame.url,format:frame.format,rawText:originalRaw,requestedAt:frame.requestedAt,receivedAt:frame.receivedAt,sourceAsOf:Number.isFinite(server)&&server<=frame.receivedAt?server:null});count++;
 }
 const publicSource='bet365:es:public-comparison';
 store.registerSource(publicSource,'Bet365 España: contraste público','https://www.bet365.es/','Página pública consultada sin sesión. Comprobación local; no es un feed de cuotas ni licencia de redistribución.');
 const folder=join(ROOT,'data/regional-evidence/2026-11-22'),refs=new Map<string,{captureId:string;sha256:string}>();
 for(const file of readdirSync(folder).filter(name=>/^\d+\.json$/.test(name))){
  const raw=readFileSync(join(folder,file),'utf8'),value=JSON.parse(raw),sha256=createHash('sha256').update(raw).digest('hex');
  const captureId=store.capture({sourceId:publicSource,ingestionKey:sha256,url:value.url,format:'bet365-public-ui-text-v1',rawText:raw,receivedAt:value.checkedAt,sourceAsOf:null});
  refs.set(file.replace('.json',''),{captureId,sha256});
 }
 const profilePath=join(ROOT,'config/region-audit.json'),profile=JSON.parse(readFileSync(profilePath,'utf8'));
 for(const entry of profile.coverage)if(refs.has(entry.eventId))entry.publicCapture=refs.get(entry.eventId);
 writeFileSync(profilePath,JSON.stringify(profile,null,2));
 console.log(JSON.stringify({importedSourceCaptures:count,publicComparisons:refs.size}));
}finally{store.close();}
