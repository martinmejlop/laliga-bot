import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {ROOT} from '../src/config.ts';
import {readJson,writeJson} from '../src/files.ts';
import {authenticatedOddsRequest} from '../src/odds/auth.ts';
import {readPublicText} from '../src/net.ts';

// Ejecutar con el panel detenido para no competir por el contador del plan gratuito.
const running=await fetch('http://127.0.0.1:3210/api/health',{signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false);
if(running)throw new Error('Detén el panel antes de ejecutar esta comprobación aislada.');
const directory=join(ROOT,'data'),month=new Date().toISOString().slice(0,7);
const usage=readJson(join(directory,'odds-usage.json'),{month,used:0});
if(!Number.isSafeInteger(usage.used)||usage.used<0||!/^\d{4}-\d{2}$/.test(usage.month))throw new Error('Contador inválido.');
const used=usage.month===month?usage.used:0;
if(used>=4800)throw new Error('Límite gratuito alcanzado.');
writeJson(join(directory,'odds-usage.json'),{month,used:used+1});
const capture=await readPublicText('https://moviodds.com/catalog?sport=soccer&site=com',{request:authenticatedOddsRequest(directory,fetch)});
const data=JSON.parse(capture.raw),rows=data.matches??data.fixtures??[];
const output=join(directory,'champions-evidence');mkdirSync(output,{recursive:true});
writeJson(join(output,'catalog-capture.json'),capture);
console.log(JSON.stringify({site:data.site,rows:rows.length,champions:rows.filter((m:any)=>m.league==='UEFA Champions League').map((m:any)=>({id:m.id,league:m.league,home:m.home,away:m.away,kickoff:m.kickoff_utc}))},null,2));
