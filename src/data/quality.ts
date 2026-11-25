import type { DataSnapshot, HistoricalMatch } from '../domain.ts';
import { canonicalTeamName } from './identity.ts';

export interface SportsTeamQuality {
  team:string; historyMatches:number; recentMatches:number; lastResultAt:number|null;
  missingPastMatches:{id:string;date:string;home:string;away:string}[]; unknowns:string[];
}
export interface SportsReadiness {
  ready:boolean; passed:boolean; asOf:number; reasons:string[]; warnings:string[]; teams:SportsTeamQuality[];
}
const DAY=86400000;
function resultAt(row:HistoricalMatch):number {
  // Sin hora confirmada, el resultado solo está completo para un corte posterior al día entero en España.
  return row.kickoffAt===null?Date.parse(`${row.date}T23:59:59.999Z`):row.kickoffAt+2*3600000;
}
export function assessingSportsReadiness(snapshot:DataSnapshot|null,event:{home:string;away:string;kickoffAt:number;season?:string},now=Date.now(),resolveTeam:((name:string)=>string|null)=canonicalTeamName):SportsReadiness {
  const reasons:string[]=[],warnings:string[]=[],teams:SportsTeamQuality[]=[];
  const asOf=Math.min(now,event.kickoffAt);
  if (!Number.isFinite(now)||!Number.isFinite(event.kickoffAt)||event.kickoffAt<=now) reasons.push('El partido no tiene un inicio futuro válido para analizar apuestas previas.');
  if (!snapshot) return {ready:false,passed:false,asOf,reasons:[...reasons,'No hay datos deportivos cargados.'],warnings,teams};
  if (snapshot.updatedAt>now||now-snapshot.updatedAt>DAY) reasons.push('Los datos deportivos requieren una actualización: fecha futura o más de 24 horas.');
  const home=resolveTeam(event.home),away=resolveTeam(event.away);
  if (!home||!away||home===away) reasons.push('Identidad de equipos no verificada.');
  const today=new Date(asOf).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
  const visible=snapshot.matches.filter(row=>Number.isFinite(row.availableAt)&&row.availableAt<=asOf);
  if(snapshot.competition==='Champions'&&snapshot.errors.some(e=>/incompleta|discrepantes/i.test(e)))reasons.push('La actualización de Champions tiene incidencias de cobertura pendientes.');
  if(visible.some(row=>row.home===home&&row.away===away&&row.neutral===true&&row.kickoffAt===event.kickoffAt))reasons.push('Partido en campo neutral: el modelo actual no habilita importes para esta situación.');
  const finished=visible.filter(row=>row.status==='finished'&&row.homeGoals!==null&&row.awayGoals!==null&&resultAt(row)<asOf);
  if (finished.length<300) reasons.push(`Histórico insuficiente: ${finished.length} resultados anteriores disponibles; se requieren al menos 300.`);
  for (const team of [home,away].filter(Boolean) as string[]) {
    const club=finished.filter(row=>row.home===team||row.away===team);
    const relevant=visible.filter(row=>(row.home===team||row.away===team)&&(row.date<today||row.kickoffAt!==null&&row.kickoffAt+3*3600000<asOf)&&Date.parse(`${row.date}T12:00:00Z`)>=asOf-180*DAY);
    const missing=relevant.filter(row=>row.status!=='postponed'&&(row.homeGoals===null||row.awayGoals===null));
    const latest=club.length?Math.max(...club.map(resultAt)):null;
    const recent=club.filter(row=>resultAt(row)>=asOf-30*DAY).length;
    const unknowns=['Lesiones, sanciones, alineaciones y minutos no disponen de cobertura estructurada exhaustiva.'];
    if(club.length<8)reasons.push(`${team}: solo ${club.length} partidos anteriores disponibles; historial insuficiente.`);
    if(latest===null||asOf-latest>30*DAY)reasons.push(`${team}: no hay un resultado verificado en los últimos 30 días.`);
    if(missing.length)reasons.push(`${team}: ${missing.length} partido(s) pasado(s) con resultado desconocido; la forma reciente puede estar incompleta.`);
    if(snapshot.errors.some(error=>/Resultados discrepantes/.test(error)&&error.includes(team)))reasons.push(`${team}: hay resultados contradictorios entre fuentes sin resolver; no se asigna dinero.`);
    if(relevant.some(row=>row.status==='postponed'))warnings.push(`${team}: hay un aplazamiento o suspensión documentado, excluido de resultados y forma; no se trata como 0-0.`);
    const intervening=visible.filter(row=>(row.home===team||row.away===team)&&row.status==='scheduled'&&row.kickoffAt!==null&&row.kickoffAt>now&&row.kickoffAt<event.kickoffAt);
    if(intervening.length)warnings.push(`${team}: tiene ${intervening.length} partido(s) previsto(s) antes de este encuentro. Es un pronóstico anticipado con los resultados conocidos ahora; debe recalcularse después de esos partidos.`);
    teams.push({team,historyMatches:club.length,recentMatches:recent,lastResultAt:latest,
      missingPastMatches:missing.map(row=>({id:row.id,date:row.date,home:row.home,away:row.away})),unknowns});
  }
  const year=new Date(event.kickoffAt).getUTCFullYear()-(new Date(event.kickoffAt).getUTCMonth()<6?1:0);
  const season=event.season??`${year}-${String((year+1)%100).padStart(2,'0')}`;
  const own=visible.find(row=>row.home===home&&row.away===away&&row.season===season&&row.status==='postponed'&&row.source==='official:status-review');
  if(own)reasons.push('Este encuentro fue suspendido tras comenzar: su reanudación requiere un modelo de estado de partido y reglas específicas; no se analiza como 90 minutos nuevos.');
  if(snapshot.matches.length>visible.length)warnings.push('Se excluyeron observaciones recibidas después del corte temporal.');
  warnings.push('La calidad deportiva no verifica las cuotas, las noticias ausentes, el saldo ni la calibración del modelo.');
  return {ready:reasons.length===0,passed:reasons.length===0,asOf,reasons:[...new Set(reasons)],warnings:[...new Set(warnings)],teams};
}
