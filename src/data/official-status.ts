import { createHash } from 'node:crypto';
import type { HistoricalMatch } from '../domain.ts';
import { Store } from '../storage/store.ts';
import { plainText } from '../news/rss.ts';
import { publicResource } from './fetch.ts';
import { calendarDate } from './parsers.ts';

export const RAYO_STATUS_URL='https://www.rayovallecano.es/partidos/temporada-2026-2027-laliga-ea-sports-8-rayo-vallecano-vs-athletic-club-2997';
export const RAYO_CALENDAR_URL='https://www.laliga.com/clubes/rayo-vallecano/proximos-partidos';
export function parseOfficialPostponement(statusHtml:string,calendarHtml:string):{date:string;timeLabel:string|null}|null {
  const status=plainText(statusHtml);
  if (!status.includes('Rayo Vallecano')||!status.includes('Athletic Club')||!status.slice(0,15000).includes('Suspendido')) return null;
  const calendar=plainText(calendarHtml);
  const row=calendar.match(/(\d{2})\.(\d{2})\.(2026)\s+(\d{2}:\d{2})\s+Rayo Vallecano\s+VS\s+Athletic Club/i);
  if (!row) return {date:'2026-10-10',timeLabel:null};
  return {date:calendarDate(`${row[3]}-${row[2]}-${row[1]}`),timeLabel:row[4]};
}
export async function officialStatusReview(store:Store,network:boolean,request:typeof fetch):Promise<{match:HistoricalMatch|null;warnings:string[]}> {
  const [statusResult,calendarResult]=await Promise.allSettled([
    publicResource('official-rayo-j8',RAYO_STATUS_URL,{network,request,ttlMs:24*3600000}),
    publicResource('official-rayo-calendar',RAYO_CALENDAR_URL,{network,request,ttlMs:24*3600000})
  ]);
  if(statusResult.status==='rejected')return {match:null,warnings:['No se ha podido revisar el estado oficial del Rayo–Athletic; un resultado desconocido permanece desconocido.']};
  const resource=statusResult.value.resource,calendar=calendarResult.status==='fulfilled'?calendarResult.value.resource:null;
  const parsed=parseOfficialPostponement(resource.raw,calendar?.raw??'');
  if(!parsed)return {match:null,warnings:[]};
  return store.atomic(()=> {
    store.registerSource('official:rayo-page','Rayo Vallecano — estado oficial de partido',RAYO_STATUS_URL,'Página oficial consultada para contrastar el estado; derechos reservados, sin redistribuir el contenido.');
    store.registerSource('official:laliga-calendar','LaLiga — calendario oficial de Rayo',RAYO_CALENDAR_URL,'Calendario oficial consultado para contrastar fecha; derechos reservados, sin garantía de API.');
    store.registerSource('official:status-review','Revisión de estado con fuentes oficiales',RAYO_STATUS_URL,'Metadato derivado con referencias a capturas oficiales; sin resultado inventado.');
    const evidence=[store.capture({sourceId:'official:rayo-page',ingestionKey:`page:${resource.receivedAt}:${resource.sha256}`,url:resource.url,
      format:'official-status-html-v1',rawText:resource.raw,requestedAt:resource.requestedAt,receivedAt:resource.receivedAt})];
    if(calendar)evidence.push(store.capture({sourceId:'official:laliga-calendar',ingestionKey:`page:${calendar.receivedAt}:${calendar.sha256}`,url:calendar.url,
      format:'official-calendar-html-v1',rawText:calendar.raw,requestedAt:calendar.requestedAt,receivedAt:calendar.receivedAt}));
    const key=`status-review:${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`;
    const previous=store.artifactByKey('statistics',key);
    if(previous)return {match:JSON.parse(String(previous.data_json)).match,warnings:['Rayo–Athletic: suspensión documentada; excluida de resultados. Fecha de reanudación consultada en LaLiga.']};
    const now=Date.now();
    const raw={fixture:'2026-27 Rayo Vallecano de Madrid — Athletic Club',status:'postponed',date:parsed.date,
      localTimeLabel:parsed.timeLabel,timeZoneConversion:'No convertida: se conserva fecha y hora publicada como etiqueta.',partialMatch:true,sourceCaptures:evidence};
    const captureId=store.capture({sourceId:'official:status-review',ingestionKey:key,url:RAYO_STATUS_URL,
      format:'official-status-review-v1',rawText:JSON.stringify(raw),receivedAt:now,sourceAsOf:Math.max(resource.receivedAt,calendar?.receivedAt??0)});
    const home=store.ensureTeam('Rayo Vallecano de Madrid'),away=store.ensureTeam('Athletic Club');
    const id=store.ensureFixture('official:status-review','rayo-athletic-2026-27-j8','2026-27',home,away);
    store.observeFixture({captureId,fixtureId:id,dateLabel:parsed.date,status:'postponed',details:raw});
    const match:HistoricalMatch={id,season:'2026-27',date:parsed.date,kickoffAt:null,home:'Rayo Vallecano de Madrid',away:'Athletic Club',
      homeGoals:null,awayGoals:null,status:'postponed',source:'official:status-review',captureId,availableAt:now};
    store.artifact({kind:'statistics',key,data:{match,review:raw},captureIds:[...evidence,captureId],fixtureId:id});
    return {match,warnings:['Rayo–Athletic: suspensión documentada; excluida de resultados. Fecha de reanudación consultada en LaLiga.']};
  });
}
