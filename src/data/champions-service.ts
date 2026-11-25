import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {DataSnapshot,HistoricalMatch} from '../domain.ts';
import {readJson,writeJson} from '../files.ts';
import {readPublicText} from '../net.ts';
import {Store} from '../storage/store.ts';
import {parseChampionsText,parseChampionsEspn} from './champions-parsers.ts';
import {scoreboardCacheTtl,type Resource} from './fetch.ts';
import {parseRss} from '../news/rss.ts';
import {championsTeamsInText} from './champions-identity.ts';
const SEASONS=['2021-22','2022-23','2023-24','2024-25','2025-26'];
export function loadChampionsData(directory:string):DataSnapshot|null {
 const data=readJson<any>(join(directory,'champions-snapshot.json'),null);
 return data?.version===1&&data.competition==='Champions'&&Number.isSafeInteger(data.updatedAt)&&Array.isArray(data.matches)&&data.matches.every((m:any)=>m.competition==='Champions')&&Array.isArray(data.coverage)&&Array.isArray(data.news)&&data.newsAnalysis&&Array.isArray(data.errors)?data:null;
}
export async function refreshChampionsData(directory:string,request:typeof fetch=fetch):Promise<DataSnapshot>{
 const cache=join(directory,'champions-cache');mkdirSync(cache,{recursive:true});
 const store=new Store(join(directory,'laliga.sqlite')),matches:HistoricalMatch[]=[],coverage:DataSnapshot['coverage']=[],errors:string[]=[],warnings:string[]=[];
 let freshCurrent=0;
 async function resource(key:string,url:string,ttl:number|((r:Resource)=>number)){
   const path=join(cache,key+'.json');let old=readJson<Resource|null>(path,null);
   if(!old&&existsSync(join(directory,'champions-sources',key+'.json'))){const seed=JSON.parse(readFileSync(join(directory,'champions-sources',key+'.json'),'utf8'));old={...seed,sha256:createHash('sha256').update(seed.raw).digest('hex'),archived:true};}
   if(old&&(old.url!==url||createHash('sha256').update(old.raw).digest('hex')!==old.sha256||old.receivedAt>Date.now()))old=null;
   if(old&&Date.now()-old.receivedAt<(typeof ttl==='function'?ttl(old):ttl))return old;
   try{const capture=await readPublicText(url,{request,maxBytes:3000000,timeoutMs:12000});const r:Resource={...capture,sha256:createHash('sha256').update(capture.raw).digest('hex'),archived:false};writeJson(path,r);return r;}
   catch(error){if(old){warnings.push(`${key}: fuente no actualizada; conserva su fecha ${new Date(old.receivedAt).toISOString()}.`);return {...old,archived:true};}throw error;}
 }
 function capture(sourceId:string,r:Resource,format:string){return store.capture({sourceId,ingestionKey:`${r.url}:${r.receivedAt}:${r.sha256}`,url:r.url,format,rawText:r.raw,requestedAt:r.requestedAt,receivedAt:r.receivedAt});}
 try{
  store.registerSource('openfootball:champions','OpenFootball — Champions League','https://github.com/openfootball/champions-league','CC0. Marcadores de 90 minutos; prórrogas y penaltis no se usan como resultado reglamentario.');
  store.registerSource('espn:champions','ESPN — Champions League','https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard','Consulta pública experimental, sin SLA ni licencia abierta declarada.');
  for(const result of await Promise.allSettled(SEASONS.map(async season=>({season,r:await resource('openfootball-'+season,`https://raw.githubusercontent.com/openfootball/champions-league/master/${season}/cl.txt`,7*86400000)})))){
    if(result.status==='rejected'){errors.push('Histórico Champions: '+String(result.reason));continue;}
    const {season,r}=result.value;try{const parsed=parseChampionsText(r.raw,season,r.receivedAt,capture('openfootball:champions',r,'openfootball-champions-txt-v1'));matches.push(...parsed.matches);warnings.push(...parsed.warnings);coverage.push({source:'openfootball:champions',season,matches:parsed.matches.length,scored:parsed.matches.length,missingPastResults:0,missingKickoff:parsed.matches.length,latestResult:parsed.matches.map(m=>m.date).sort().at(-1)??null,warnings:parsed.warnings});}catch(e){errors.push(`Histórico ${season}: ${String(e)}`);}
  }
  const now=Date.now(),today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'}),startYear=Number(today.slice(0,4))-(Number(today.slice(5,7))<7?1:0),start=Date.parse(`${startYear}-08-01T12:00:00Z`),end=Date.parse(today+'T12:00:00Z')+15*86400000;
  const dates:string[]=[];for(let d=start;d<=end;d+=86400000)dates.push(new Date(d).toISOString().slice(0,10).replaceAll('-',''));
  const current:HistoricalMatch[]=[];let failed=0;
  for(let i=0;i<dates.length;i+=4){const group=await Promise.allSettled(dates.slice(i,i+4).map(async date=>({date,r:await resource('espn-'+date,`https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=${date}`,r=>scoreboardCacheTtl(r,date,Date.now()))})));
   for(const result of group){if(result.status==='rejected'){failed++;continue;}const {r}=result.value;try{const parsed=parseChampionsEspn(r.raw,r.receivedAt,capture('espn:champions',r,'espn-champions-scoreboard-v1'));current.push(...parsed.matches.filter(m=>!/(?:Qualif|Qualifying)/i.test(m.stage??'')));warnings.push(...parsed.warnings);if(Date.now()-r.receivedAt<86400000)freshCurrent=Math.max(freshCurrent,r.receivedAt);}catch(e){failed++;warnings.push(String(e));}}
  }
  if(failed)errors.push(`Actualización de Champions incompleta: ${failed} consultas de calendario o resultados no verificadas.`);
  matches.push(...current);
  coverage.push({source:'espn:champions',season:`${startYear}-${String((startYear+1)%100).padStart(2,'0')}`,matches:current.length,scored:current.filter(m=>m.status==='finished').length,missingPastResults:current.filter(m=>m.status==='unknown').length,missingKickoff:0,latestResult:current.filter(m=>m.status==='finished').map(m=>m.date).sort().at(-1)??null,warnings:[...new Set(warnings)].slice(0,30)});
  const unique=new Map<string,HistoricalMatch>();for(const row of matches){const key=JSON.stringify([row.season,row.date,row.home,row.away]),old=unique.get(key);if(old&&old.homeGoals!==null&&row.homeGoals!==null&&(old.homeGoals!==row.homeGoals||old.awayGoals!==row.awayGoals))errors.push(`Resultados discrepantes ${row.home} — ${row.away}.`);if(!old||row.availableAt>old.availableAt)unique.set(key,row);}
  let news:DataSnapshot['news']=[];
  try{const url='https://www.mundodeportivo.com/rss/futbol/champions-league.xml',r=await resource('champions-rss',url,30*60000);store.registerSource('mundodeportivo:champions','Mundo Deportivo — RSS Champions',url,'Solo titulares y resúmenes recibidos; derechos reservados.');const id=capture('mundodeportivo:champions',r,'champions-rss-v1');news=parseRss(r.raw,r.receivedAt,id).news.map(n=>({...n,source:'mundodeportivo:champions',teams:championsTeamsInText(n.title+' '+n.text)}));}catch{warnings.push('Noticias de Champions no disponibles; no confirma ausencia de bajas.');}
  const snapshot:DataSnapshot={version:1,competition:'Champions',updatedAt:freshCurrent||0,matches:[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),coverage,news,newsAnalysis:{status:'unavailable',checkedAt:Date.now(),model:'',facts:[],warnings:['Contexto sin extracción verificada de lesiones; no altera las probabilidades.']},errors:[...new Set(errors)]};
  writeJson(join(directory,'champions-snapshot.json'),snapshot);return snapshot;
 }finally{store.close();}
}
