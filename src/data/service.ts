import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CoverageRow, DataSnapshot, HistoricalMatch, NewsAnalysis, NewsItem } from '../domain.ts';
import { ROOT, loadSettings } from '../config.ts';
import { Store } from '../storage/store.ts';
import { NEWS_SOURCE, registerObservedSources } from '../storage/import-board.ts';
import { TEAM_CATALOG, canonicalTeamName } from './identity.ts';
import { archivedOpenFootball, publicResource, scoreboardCacheTtl, writeJsonAtomic, type Resource } from './fetch.ts';
import { parseEspn, parseOpenFootball } from './parsers.ts';
import { parseRss } from '../news/rss.ts';
import { analyzeNewsItems } from '../news/qwen.ts';
import { officialStatusReview } from './official-status.ts';

export { canonicalTeamName } from './identity.ts';
const SEASONS=['2021-22','2022-23','2023-24','2024-25','2025-26','2026-27'];
const SNAPSHOT=join(ROOT,'data/snapshot.json');
const ANALYSIS=join(ROOT,'data/news-analysis.json');
const sourceId=(name:string)=>name==='espn-experimental'?'espn-experimental':'openfootball';
export function loadData():DataSnapshot|null {
  try {
    const data=JSON.parse(readFileSync(SNAPSHOT,'utf8'));
    if (data.version!==1||!Number.isSafeInteger(data.updatedAt)||!Array.isArray(data.matches)||!Array.isArray(data.coverage)||!Array.isArray(data.news)||!data.newsAnalysis||!Array.isArray(data.errors)) return null;
    return data;
  } catch { return null; }
}
function register(store:Store) {
  registerObservedSources(store);
  store.registerSource('openfootball','OpenFootball — resultados y calendario','https://github.com/openfootball/football.json',
    'CC0-1.0. Datos comunitarios sin garantía de actualización; horas locales sin zona declarada.');
  store.registerSource('espn-experimental','ESPN — calendario público experimental','https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard',
    'Consulta pública experimental para uso personal; no se declara licencia abierta ni SLA.');
  for (const team of TEAM_CATALOG) {
    const id=store.ensureTeam(team.name);
    for (const source of ['openfootball','espn-experimental',NEWS_SOURCE]) {
      for (const name of [team.name,...team.aliases]) store.bindTeam(source,name,id);
      if (source==='espn-experimental') for (const name of team.espn??[]) store.bindTeam(source,name,id);
    }
  }
}
function saveMatches(store:Store,resource:Resource,rows:HistoricalMatch[],format:string):{captureId:string;matches:HistoricalMatch[]} {
  const source=sourceId(rows[0]?.source??(format==='espn-scoreboard-v1'?'espn-experimental':'openfootball'));
  return store.atomic(()=> {
    const captureId=store.capture({sourceId:source,ingestionKey:`${resource.url}:${resource.receivedAt}:${resource.sha256}`,
      url:resource.url,format,rawText:resource.raw,requestedAt:resource.requestedAt,receivedAt:resource.receivedAt});
    const matches=rows.map(row=> {
      const home=store.resolveTeam(source,row.home),away=store.resolveTeam(source,row.away);
      const id=store.ensureFixture(source,row.id,row.season,home,away);
      store.observeFixture({captureId,fixtureId:id,dateLabel:row.date,kickoffAt:row.kickoffAt,status:row.status,
        score:row.homeGoals===null||row.awayGoals===null?null:[row.homeGoals,row.awayGoals],details:{
          source,archived:resource.archived,timeInterpretation:row.kickoffAt===null?'Hora sin zona declarada; no convertida a UTC':'Hora explícita de la fuente experimental',
          availableAt:resource.receivedAt,pointInTimeArchive:false}});
      return {...row,id,captureId,availableAt:resource.receivedAt};
    });
    return {captureId,matches};
  });
}
function datesForCalendar(now:number):string[] {
  const dates:string[]=[];
  const today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
  const base=Date.parse(`${today}T12:00:00Z`);
  for(let day=0;day<15;day++) dates.push(new Date(base+day*86400000).toISOString().slice(0,10).replaceAll('-',''));
  return dates;
}
function archiveMetadata(store:Store):NewsItem[] {
  try {
    const audit=JSON.parse(readFileSync(join(ROOT,'docs/source-audit-t02.json'),'utf8'));
    const rss=audit.results.find((row:any)=>row.id==='mundodeportivo-rss'&&row.status==='sample-obtained');
    if (!rss?.summary?.sample) return [];
    const receivedAt=Date.parse(audit.collectedAt),publishedAt=Date.parse(rss.summary.sample.publishedAt);
    const captureId=store.capture({sourceId:NEWS_SOURCE,ingestionKey:`audit:${audit.collectedAt}`,url:rss.url,format:'rss-audit-record-v1',
      rawText:JSON.stringify(rss,null,2),requestedAt:Date.parse(rss.checkedAt),receivedAt,publishedAt});
    const item:NewsItem={id:`md:${createHash('sha256').update(rss.summary.sample.url).digest('hex').slice(0,24)}`,
      title:rss.summary.sample.title,text:'',url:rss.summary.sample.url,source:NEWS_SOURCE,publishedAt,receivedAt,captureId,
      teams:['FC Barcelona'],scope:'metadata'};
    store.article({captureId,url:item.url,title:item.title,publishedAt,teamIds:[store.resolveTeam(NEWS_SOURCE,'Barça')]});
    return [item];
  } catch { return []; }
}
async function newsAnalysis(items:NewsItem[],analyze:boolean,request:typeof fetch):Promise<NewsAnalysis> {
  const inputHash=createHash('sha256').update(JSON.stringify(items.map(item=>({id:item.id,title:item.title,text:item.text,publishedAt:item.publishedAt,teams:item.teams})))).digest('hex');
  try {
    const cached=JSON.parse(readFileSync(ANALYSIS,'utf8'));
    if (cached.inputHash===inputHash&&Date.now()-cached.analysis.checkedAt<6*3600000&&cached.analysis.status==='available') return cached.analysis;
  } catch {}
  if (!analyze) return {status:'unavailable',checkedAt:Date.now(),model:loadSettings().ollama.model,facts:[],warnings:['La extracción IA no se ha solicitado en esta actualización; no se presupone ausencia de bajas.']};
  const analysis=await analyzeNewsItems(items,request);
  writeJsonAtomic(ANALYSIS,{inputHash,analysis});return analysis;
}

let ongoing:Promise<DataSnapshot>|null=null;
export function mergeMatchObservations(rows:HistoricalMatch[],today:string):{matches:HistoricalMatch[];warnings:string[]} {
  const merged=new Map<string,HistoricalMatch>(),warnings:string[]=[];
  for(const row of rows){
    const key=JSON.stringify([row.season,row.home,row.away]),previous=merged.get(key);
    if(previous&&previous.homeGoals!==null&&row.homeGoals===null){
      if(previous.date!==row.date)warnings.push(`Calendarios discrepantes para ${row.home}–${row.away}; se mantiene el resultado histórico y se conserva el original de ambas fuentes.`);
      continue;
    }
    if(previous&&previous.homeGoals!==null&&row.homeGoals!==null&&(previous.homeGoals!==row.homeGoals||previous.awayGoals!==row.awayGoals))warnings.push(`Resultados discrepantes para ${row.home}–${row.away}; se muestra la observación más reciente, ambas conservadas en el archivo.`);
    // Un calendario descargado de nuevo no revoca una suspensión oficial ya documentada.
    if(row.source==='official:status-review'&&row.status==='postponed'){merged.set(key,row);continue;}
    if(previous?.source==='official:status-review'&&previous.status==='postponed'&&row.homeGoals===null)continue;
    if(!previous||row.availableAt>=previous.availableAt||row.kickoffAt!==null&&previous.kickoffAt===null)merged.set(key,row);
  }
  for(const [key,row] of merged)if(row.status==='scheduled'&&row.date<today)merged.set(key,{...row,status:'unknown'});
  return {matches:[...merged.values()],warnings};
}
export async function refreshData(options:{network?:boolean;analyzeNews?:boolean;request?:typeof fetch}={}):Promise<DataSnapshot> {
  if (ongoing) return ongoing;
  ongoing=runRefresh(options);
  try { return await ongoing; } finally { ongoing=null; }
}
async function runRefresh(options:{network?:boolean;analyzeNews?:boolean;request?:typeof fetch}):Promise<DataSnapshot> {
  const network=options.network!==false,request=options.request??fetch;
  mkdirSync(join(ROOT,'data'),{recursive:true});
  const store=new Store(join(ROOT,'data/laliga.sqlite'));
  const errors:string[]=[],coverage:CoverageRow[]=[],matches:HistoricalMatch[]=[];
  let news:NewsItem[]=[];
  try {
    register(store);
    for(let index=0;index<SEASONS.length;index+=3) {
      const group=await Promise.allSettled(SEASONS.slice(index,index+3).map(async season=> {
        const result=await publicResource(`openfootball-${season}`,`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/es.1.json`,{
          network,request,ttlMs:season==='2026-27'?4*3600000:7*86400000,fallback:()=>archivedOpenFootball(season)});
        return {season,...result};
      }));
      group.forEach(result=> {
        if(result.status==='rejected'){errors.push(String(result.reason?.message??result.reason));return;}
        try {
          const {season,resource,warning}=result.value;
          const parsed=parseOpenFootball(resource.raw,season,resource.receivedAt,'pending');
          const saved=saveMatches(store,resource,parsed.matches,'openfootball-json-v1');
          matches.push(...saved.matches);coverage.push({...parsed.coverage,warnings:[...parsed.coverage.warnings,...(warning?[warning]:[])]});
        } catch(error) {errors.push(`Histórico ${result.value.season}: ${error instanceof Error?error.message:'incompatible'}`);}
      });
    }
    // Fechas cercanas y fichas sin finalizar se vuelven a consultar; solo resultados antiguos usan caché semanal.
    if (network) {
      const now=Date.now(),today=new Date(now).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
      const base=Date.parse(`${today}T12:00:00Z`);
      const missingDates=matches.filter(row=>row.homeGoals===null&&row.date<today).map(row=>row.date.replaceAll('-',''));
      // Completar huecos y las ocho semanas recientes: el calendario comunitario puede ser provisional.
      const recentDates=Array.from({length:60},(_,index)=>new Date(base-(index+1)*86400000).toISOString().slice(0,10).replaceAll('-',''));
      const dates=[...new Set([...datesForCalendar(now),...missingDates,...recentDates])].sort();
      const calendarRows:HistoricalMatch[]=[],calendarWarnings:string[]=[];
      for(let index=0;index<dates.length;index+=3) {
        const group=await Promise.allSettled(dates.slice(index,index+3).map(async date=> {
          const result=await publicResource(`espn-${date}`,`https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=${date}`,{network,request,ttlMs:resource=>scoreboardCacheTtl(resource,date,Date.now())});
          return result;
        }));
        for(const result of group) {
          if(result.status==='rejected'){calendarWarnings.push(String(result.reason?.message??result.reason));continue;}
          try {
            const parsed=parseEspn(result.value.resource.raw,result.value.resource.receivedAt,'pending');
            const saved=saveMatches(store,result.value.resource,parsed.matches,'espn-scoreboard-v1');
            calendarRows.push(...saved.matches);calendarWarnings.push(...parsed.warnings,...(result.value.warning?[result.value.warning]:[]));
          } catch(error) {calendarWarnings.push(`Calendario no incorporado: ${error instanceof Error?error.message:'incompatible'}`);}
        }
      }
      matches.push(...calendarRows);
      const scored=calendarRows.filter(row=>row.status==='finished');
      coverage.push({source:'espn-experimental',season:'huecos históricos, ocho semanas recientes y próximos 15 días',matches:calendarRows.length,scored:scored.length,
        missingPastResults:calendarRows.filter(row=>row.kickoffAt!<Date.now()&&row.status==='unknown').length,
        missingKickoff:calendarRows.filter(row=>row.kickoffAt===null).length,latestResult:scored.map(row=>row.date).sort().at(-1)??null,
        warnings:['Calendario público experimental sin SLA ni licencia abierta confirmada; horas y cambios son los comunicados por esta fuente.',...calendarWarnings]});
      if(!calendarRows.length) errors.push('No se han obtenido próximos partidos con hora confirmada por la fuente experimental.');
    } else {
      const previous=loadData();
      if(previous) {
        matches.push(...previous.matches.filter(row=>row.source==='espn-experimental'));
        coverage.push(...previous.coverage.filter(row=>row.source==='espn-experimental').map(row=>({...row,warnings:[...row.warnings,'Calendario archivado: no se ha consultado la red en esta actualización.']})));
      }
      errors.push('Sin consulta de calendario experimental: se conservan datos archivados con su fecha, si existen.');
    }
    try {
      const result=await publicResource('mundodeportivo-rss','https://www.mundodeportivo.com/rss/futbol/laliga.xml',{network,request,ttlMs:30*60000});
      news=store.atomic(()=> {
        const captureId=store.capture({sourceId:NEWS_SOURCE,ingestionKey:`rss:${result.resource.receivedAt}:${result.resource.sha256}`,
          url:result.resource.url,format:'rss-xml-v1',rawText:result.resource.raw,requestedAt:result.resource.requestedAt,receivedAt:result.resource.receivedAt});
        const parsed=parseRss(result.resource.raw,result.resource.receivedAt,captureId);
        errors.push(...parsed.warnings);if(result.warning)errors.push(result.warning);
        for(const item of parsed.news) store.article({captureId,url:item.url,title:item.title,excerpt:item.text,publishedAt:item.publishedAt,
          teamIds:item.teams.map(team=>store.resolveTeam(NEWS_SOURCE,team))});
        return parsed.news;
      });
    } catch(error) {
      errors.push(`Noticias: ${error instanceof Error?error.message:'no disponibles'}. Se conserva metadato archivado si existe.`);
      news=archiveMetadata(store);
    }
    try {
      const reviewed=await officialStatusReview(store,network,request);
      if(reviewed.match)matches.push(reviewed.match);
      coverage.push({source:'official:status-review',season:'2026-27',matches:reviewed.match?1:0,scored:0,missingPastResults:0,
        missingKickoff:reviewed.match?1:0,latestResult:null,warnings:reviewed.warnings});
    } catch(error) {errors.push(`Revisión oficial no disponible: ${error instanceof Error?error.message:'sin datos'}`);}
    // Una pareja local/visitante por temporada: ESPN puede actualizar fecha y hora de la ficha provisional.
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
    const mergedResult=mergeMatchObservations(matches,today);errors.push(...mergedResult.warnings);
    const merged=mergedResult.matches;
    for(const season of SEASONS) {
      const rows=merged.filter(row=>row.season===season),finished=rows.filter(row=>row.status==='finished');
      const missing=rows.filter(row=>row.date<today&&row.homeGoals===null&&row.status!=='postponed').length;
      coverage.push({source:'fusionado',season,matches:rows.length,scored:finished.length,missingPastResults:missing,
        missingKickoff:rows.filter(row=>row.kickoffAt===null).length,latestResult:finished.map(row=>row.date).sort().at(-1)??null,
        warnings:[...(missing?[`${missing} encuentros pasados sin resultado; no se tratan como 0-0.`]:[]),
          'Reconstrucción a partir de fuentes consultadas ahora; no demuestra disponibilidad histórica de nuestras capturas.']});
    }
    const analysis=await newsAnalysis(news,options.analyzeNews!==false,request);
    const snapshot:DataSnapshot={version:1,updatedAt:Date.now(),matches:merged.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),
      coverage,news,newsAnalysis:analysis,errors:[...new Set(errors)]};
    writeJsonAtomic(SNAPSHOT,snapshot);return snapshot;
  } finally {store.close();}
}
