import {createHash} from 'node:crypto';
import type {HistoricalMatch} from '../domain.ts';
import {championsTeamName} from './champions-identity.ts';
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24);
export function parseChampionsText(raw:string,season:string,availableAt:number,captureId:string) {
 if(!raw.startsWith('= UEFA Champions League')||!/^\d{4}-\d{2}$/.test(season))throw Error('Histórico de Champions incompatible.');
 const start=Number(season.slice(0,4));let date:string|null=null,stage='';const matches:HistoricalMatch[]=[],warnings:string[]=[];
 for(const line of raw.split(/\r?\n/)){
   if(line.startsWith('▪')){stage=line.slice(1).trim();continue;}
   const day=line.trim().match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(?: (\d{4}))?$/);
   if(day){const month=months.indexOf(day[1]),year=day[3]?Number(day[3]):month>=6?start:start+1;date=`${year}-${String(month+1).padStart(2,'0')}-${day[2].padStart(2,'0')}`;if(![start,start+1].includes(year)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Fecha histórica de Champions inválida.');continue;}
   const row=line.trim().replace(/^\d{1,2}:\d{2}\s+/,'').match(/^(.+?)\s+\([A-Z]{3}\)\s+v\s+(.+?)\s+\([A-Z]{3}\)\s+(.+)$/);
   if(!row)continue;
   const home=championsTeamName(row[1]),away=championsTeamName(row[2]);if(!home||!away||home===away||!date){warnings.push(`Partido omitido por identidad o fecha: ${row[1]} — ${row[2]}.`);continue;}
   const score=/a\.e\.t\./i.test(row[3])?row[3].match(/a\.e\.t\.\s*\((\d{1,2})-(\d{1,2}),/i):row[3].match(/^(\d{1,2})-(\d{1,2})(?:\s|$)/);
   if(!score||/pen\./i.test(row[3])&&!/a\.e\.t\./i.test(row[3])){warnings.push(`Marcador reglamentario no identificado: ${home} — ${away}.`);continue;}
   if(Date.parse(date+'T23:59:59Z')>=availableAt)continue;
   matches.push({id:'ucl:'+hash(JSON.stringify([season,date,home,away])),competition:'Champions',season,date,kickoffAt:null,home,away,homeGoals:Number(score[1]),awayGoals:Number(score[2]),status:'finished',source:'openfootball:champions',captureId,availableAt,stage,neutral:/(?:^|, )Final$/.test(stage)});
 }
 if(matches.length<80)throw Error(`Histórico de Champions incompleto: ${matches.length} marcadores reglamentarios.`);
 return {matches,warnings};
}
export function parseChampionsEspn(raw:string,availableAt:number,captureId:string){
 const data=JSON.parse(raw);if(!Array.isArray(data.events)||!data.leagues?.some((l:any)=>l.slug==='uefa.champions'))throw Error('El calendario no confirma la UEFA Champions League.');
 const matches:HistoricalMatch[]=[],warnings:string[]=[];
 for(const event of data.events){try{
  const c=event.competitions?.[0],teams=c?.competitors;if(typeof event.id!=='string'||!Array.isArray(teams)||teams.length!==2)throw Error('Identidad ambigua.');
  const h=teams.find((t:any)=>t.homeAway==='home'),a=teams.find((t:any)=>t.homeAway==='away'),home=championsTeamName(h?.team?.displayName),away=championsTeamName(a?.team?.displayName);
  const kickoffAt=typeof event.date==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(event.date)?Date.parse(event.date):NaN;
  if(!home||!away||home===away||!Number.isFinite(kickoffAt))throw Error('Equipos u hora no identificados.');
  const status=event.status?.type??c.status?.type,completed=status?.completed===true,postponed=/postpon|delay|cancel/i.test(status?.name??'');
  let score:(number|null)[]=[null,null];
  if(completed){
   if(kickoffAt>availableAt)throw Error('Resultado futuro.');
   const extra=(event.status?.period??c.status?.period??0)>2||/extra|penalt/i.test(status?.name??'');
   if(extra){score=[h,a].map(t=>{const lines=t.linescores;if(!Array.isArray(lines))return null;const periods=[1,2].map(p=>lines.find((x:any)=>x.period===p));return periods.every(x=>x&&Number.isSafeInteger(x.value)&&x.value>=0)?periods.reduce((s,x)=>s+x.value,0):null;});}
   else score=[h.score,a.score].map(v=>/^\d{1,2}$/.test(String(typeof v==='object'?v?.value:v))?Number(typeof v==='object'?v.value:v):null);
   if(score.some(s=>s===null)){warnings.push(`Marcador de 90 minutos desconocido: ${home} — ${away}.`);}
  }
  const year=new Date(kickoffAt).getUTCFullYear()-(new Date(kickoffAt).getUTCMonth()<6?1:0),date=new Date(kickoffAt).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
  matches.push({id:'espn-ucl:'+event.id,competition:'Champions',season:`${year}-${String((year+1)%100).padStart(2,'0')}`,date,kickoffAt,home,away,homeGoals:score[0],awayGoals:score[1],status:completed&&score[0]!==null?'finished':postponed?'postponed':kickoffAt>availableAt?'scheduled':'unknown',source:'espn:champions',captureId,availableAt,stage:c.altGameNote??'',neutral:c.neutralSite===true||/^UEFA Champions League, Final$/i.test(c.altGameNote??'')});
 }catch(error){warnings.push(`Evento ${event.id??'?'} omitido: ${error instanceof Error?error.message:String(error)}`);}}
 return {matches,warnings};
}
