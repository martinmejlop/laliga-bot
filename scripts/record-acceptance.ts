// Captura acotada de respuestas públicas, sin realizar apuestas ni guardar cabeceras.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT} from '../src/config.ts';
import {readPublicText} from '../src/net.ts';
import {authenticatedOddsRequest} from '../src/odds/auth.ts';
const ids=process.argv[2]?.split(',').filter(id=>/^\d+$/.test(id))??[];
const rounds=Number(process.argv[3]??6);
if(!ids.length||ids.length>3||!Number.isSafeInteger(rounds)||rounds<1||rounds>70)throw Error('Indica 1–3 partidos y 1–70 rondas.');
const directory=join(ROOT,'data'),run=join(directory,'acceptance',new Date().toISOString().replaceAll(':','-'));
mkdirSync(run,{recursive:true});
const request=authenticatedOddsRequest(directory,fetch),records:any[]=[];
for(let round=0;round<rounds;round++){
 const start=Date.now();
 for(const eventId of ids){
  const path=join(directory,'odds-usage.json'),usage=JSON.parse(readFileSync(path,'utf8')),month=new Date().toISOString().slice(0,7);
  if(usage.month!==month||!Number.isSafeInteger(usage.used)||usage.used<0||usage.used>=4800)throw Error('No se puede reservar cuota gratuita.');
  writeFileSync(path,JSON.stringify({...usage,used:usage.used+1}));
  try {
   const capture=await readPublicText(`https://moviodds.com/quotes?fi=${eventId}&site=com`,{request});
   const file=`${String(round).padStart(3,'0')}-${eventId}.json`,data=JSON.parse(capture.raw);
   writeFileSync(join(run,file),JSON.stringify(capture));
   records.push({file,eventId,requestedAt:capture.requestedAt,receivedAt:capture.receivedAt,sha256:createHash('sha256').update(capture.raw).digest('hex'),source:data.source,count:data.count,serverTime:data.server_time});
   console.log(JSON.stringify({round,eventId,source:data.source,count:data.count,httpMs:capture.receivedAt-capture.requestedAt}));
  }catch(error){records.push({round,eventId,failedAt:Date.now(),error:error instanceof Error?error.message:String(error)});console.log(JSON.stringify(records.at(-1)));}
 }
 writeFileSync(join(run,'manifest.json'),JSON.stringify({purpose:'bounded-acceptance-public-read',rounds,ids,records},null,2));
 if(round<rounds-1)await new Promise(resolve=>setTimeout(resolve,Math.max(0,20000-(Date.now()-start))));
}
console.log(JSON.stringify({completed:true,directory:run,requests:records.length}));
