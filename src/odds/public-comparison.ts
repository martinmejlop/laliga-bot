import {canonicalTeamName} from '../data/identity.ts';
import {championsTeamName} from '../data/champions-identity.ts';
import {mapMarket} from './markets.ts';
const norm=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const epoch=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
const GROUPS=[['40','Resultado final',3],['10114','Doble oportunidad',3],['10544','Resultado sin empate',2]] as const;
type ResolveTeam=(s:string)=>string|null;
function sameTeam(a:string,b:string,resolve:ResolveTeam){return resolve(a)!==null&&resolve(a)===resolve(b);}
function sideFor(label:string,home:string,away:string,resolve:ResolveTeam):string|null {
 if(['empate','draw'].includes(norm(label)))return 'draw';if(sameTeam(label,home,resolve))return 'home';if(sameTeam(label,away,resolve))return 'away';
 const parts=label.split(/\s+(?:o|or)\s+/i);if(parts.length!==2)return null;
 const sides=parts.map(p=>sideFor(p,home,away,resolve)).sort().join(',');
 return ({'draw,home':'home_draw','away,home':'home_away','away,draw':'draw_away'} as any)[sides]??null;
}
export function comparePublicMarkets(proof:any,capture:any,event:{id:string;home:string;away:string;kickoffAt:number;competition?:'LaLiga'|'Champions'},now=Date.now()) {
 const competition=event.competition??'LaLiga',resolve=competition==='Champions'?championsTeamName:canonicalTeamName;
 const url=`https://www.bet365.es/#/AC/B1/C1/D8/E${event.id}/F3/G40/`;
 if(proof?.url!==url||!Number.isSafeInteger(proof.checkedAt)||proof.checkedAt>now||typeof proof.text!=='string'||!Array.isArray(proof.blocks))throw Error('El contraste público no tiene identidad, hora y texto verificables.');
 const text=norm(proof.text),date=norm(new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(event.kickoffAt)).replaceAll(',','');
 if(!text.includes(date)||event.kickoffAt<=proof.checkedAt)throw Error('El inicio público no coincide con el partido previo esperado.');
 // El encabezado debe identificar ambos equipos, además de la URL. No basta con que aparezcan en una noticia.
 const main=proof.text.split('\n- main:\n')[1];
 const header=main?.split('\n').find((s:string)=>/generic:.*\s+v\s+/i.test(s));
 const names=header?.replace(/^.*generic:\s*/,'').split(/\s+v\s+/i);
 if(!names||names.length!==2||!sameTeam(names[0],event.home,resolve)||!sameTeam(names[1],event.away,resolve))throw Error('Los equipos del encabezado público no coinciden.');
 if(competition==='Champions'&&!norm(main??'').includes('uefa champions league'))throw Error('El contenido público no identifica la UEFA Champions League.');
 const raw=JSON.parse(capture.raw),server=epoch(raw.server_time);
 if(capture.url!==`https://moviodds.com/quotes?fi=${event.id}&site=com`||!Number.isSafeInteger(capture.requestedAt)||!Number.isSafeInteger(capture.receivedAt)||capture.requestedAt>capture.receivedAt||capture.receivedAt>now||Math.abs(capture.receivedAt-proof.checkedAt)>60000||raw.site!=='com'||raw.fixture!==event.id||!['cache','live-fetch'].includes(raw.source)||!Array.isArray(raw.quotes)||raw.count!==raw.quotes.length||raw.dropped!==0||server===null||server>capture.receivedAt+5000||capture.receivedAt-server>30000)throw Error('La lectura de API no es completa, contemporánea o del mismo partido.');
 const coverage:any[]=[],comparisons:any[]=[];
 for(const [groupId,heading,count] of GROUPS){
   const block=proof.blocks.filter((b:any)=>b.heading===heading);if(block.length!==1){comparisons.push({groupId,heading,matched:false,reason:'Mercado público ausente o duplicado.'});continue;}
   const lines=String(block[0].text).split('\n').map(s=>s.trim()).filter(Boolean),display=new Map<string,{label:string;price:number}>();
   const displayedHeading=block[0].displayHeading??heading,headings:Record<string,string[]>={'Resultado final':['Resultado final','Full Time Result'],'Doble oportunidad':['Doble oportunidad','Double Chance'],'Resultado sin empate':['Resultado sin empate','Draw No Bet']};
   if(!headings[heading]?.includes(displayedHeading)||lines[0]!==displayedHeading)throw Error('Encabezado de mercado contradictorio.');
   for(let i=1;i<lines.length-1;i++){const side=sideFor(lines[i],event.home,event.away,resolve);if(side&&/^\d+(?:\.\d+)?$/.test(lines[i+1])){if(display.has(side))throw Error('Selección pública duplicada.');display.set(side,{label:lines[i],price:Number(lines[i+1])});}}
   const quotes=raw.quotes.filter((q:any)=>q.group_id===groupId),selections:any[]=[],rows:any[]=[];
   for(const q of quotes){
     const selection=mapMarket(q,event),shown=selection?display.get(selection.side):null,changed=epoch(q.ts),confirmed=epoch(raw.group_status?.[groupId]?.polled_at);
     const times=changed!==null&&confirmed!==null&&changed<=confirmed&&confirmed<=capture.receivedAt;
     const scale=q.odds_dec>=1.1?100:1000,validPrice=shown&&q.odds_dec>1&&[Math.floor(q.odds_dec*scale+1e-9)/scale,Math.round(q.odds_dec*scale)/scale].some(p=>Math.abs(p-shown.price)<1e-9);
     const matched=q.fixture_id===event.id&&typeof q.sel_id==='string'&&q.sel_id.length>0&&validPrice&&times&&q.suspended!==true&&raw.group_status?.[groupId]?.stale!==true;
     rows.push({selection:shown?.label??q.label,apiPrice:q.odds_dec,bet365Price:shown?.price??null,matched:Boolean(matched),confirmedAt:confirmed});
     if(matched)selections.push({selectionId:q.sel_id,label:shown!.label,side:selection!.side,line:selection!.line,sourcePrice:q.odds_dec,displayPrice:shown!.price});
   }
   const matched=display.size===count&&quotes.length===count&&new Set(quotes.map((q:any)=>q.sel_id)).size===count&&selections.length===count;
   comparisons.push({groupId,heading,matched,rows});
   if(matched)coverage.push({competition,eventId:event.id,groupId,period:'full_time_regulation',checkedAt:new Date(proof.checkedAt).toISOString(),url,scope:'sampled-coverage',selections});
 }
 return {competition,eventId:event.id,eventName:`${event.home} — ${event.away}`,checkedAt:proof.checkedAt,providerReceivedAt:capture.receivedAt,url,comparisons,coverage};
}
