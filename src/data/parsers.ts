import { createHash } from 'node:crypto';
import type { CoverageRow, HistoricalMatch } from '../domain.ts';
import { canonicalTeamName } from './identity.ts';

export function calendarDate(value: unknown): string {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Fecha de calendario inválida.');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new Error('Fecha de calendario inexistente.');
  return value;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function parseOpenFootball(raw: string, season: string, availableAt: number, captureId: string): {matches:HistoricalMatch[]; coverage:CoverageRow} {
  if (!/^\d{4}-\d{2}$/.test(season)) throw new Error('Temporada inválida.');
  const source='openfootball';
  const data=JSON.parse(raw);
  if (!Array.isArray(data.matches) || !data.matches.length || data.matches.length>500) throw new Error('Conjunto histórico sin partidos válidos.');
  const seen=new Set<string>(); const matches:HistoricalMatch[]=[]; const warnings:string[]=[];
  const today = new Date(availableAt).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
  for (const row of data.matches) {
    const date=calendarDate(row.date);
    const home=canonicalTeamName(row.team1),away=canonicalTeamName(row.team2);
    if (!home || !away || home===away) throw new Error(`Equipo histórico sin correspondencia explícita: ${String(row.team1)} / ${String(row.team2)}`);
    const identity=JSON.stringify([season,home,away]);
    if (seen.has(identity)) throw new Error('Partido duplicado en el histórico.');
    seen.add(identity);
    const firstYear=Number(season.slice(0,4));
    if (date<`${firstYear}-07-01` || date>`${firstYear+1}-07-31`) throw new Error('Partido fuera de su temporada.');
    const score=row.score?.ft;
    if (score!==undefined && (!Array.isArray(score) || score.length!==2 || !score.every((n:unknown) => typeof n==='number' && Number.isSafeInteger(n) && n>=0 && n<100))) throw new Error('Marcador histórico inválido.');
    if (score && date>=today) throw new Error('Un resultado de hoy sin hora confirmada o de fecha futura no puede incorporarse como finalizado.');
    let status:HistoricalMatch['status']=score?'finished':date>today?'scheduled':'unknown';
    if (typeof row.status==='string' && /postpon|aplaz/i.test(row.status)) status='postponed';
    // El conjunto no declara zona horaria para time: se preserva la fecha, nunca se inventa UTC.
    matches.push({id:`of:${hash(identity).slice(0,24)}`,season,date,kickoffAt:null,home,away,
      homeGoals:score?.[0]??null,awayGoals:score?.[1]??null,status,source,captureId,availableAt});
  }
  const scored=matches.filter(row=>row.status==='finished');
  const missingPastResults=matches.filter(row=>row.date<today&&row.homeGoals===null).length;
  const latestResult=scored.map(row=>row.date).sort().at(-1)??null;
  if (missingPastResults) warnings.push(`${missingPastResults} partidos de fechas pasadas sin resultado; se excluyen del entrenamiento.`);
  warnings.push('Horas locales sin zona declarada: kickoffAt desconocido; reconstrucción histórica por fecha de partido, no prueba de disponibilidad en tiempo real.');
  if (season===`${new Date(availableAt).getUTCFullYear()-(new Date(availableAt).getUTCMonth()<6?1:0)}-${String((new Date(availableAt).getUTCFullYear()+(new Date(availableAt).getUTCMonth()<6?0:1))%100).padStart(2,'0')}` && latestResult && availableAt-Date.parse(`${latestResult}T23:59:59Z`)>14*86400000) warnings.push('Resultados de la temporada actual con más de 14 días de antigüedad; cobertura actual incompleta.');
  return {matches,coverage:{source,season,matches:matches.length,scored:scored.length,missingPastResults,missingKickoff:matches.length,latestResult,warnings}};
}

export function parseEspn(raw: string, availableAt: number, captureId: string): {matches:HistoricalMatch[]; warnings:string[]} {
  const data=JSON.parse(raw);
  if (!Array.isArray(data.events)) throw new Error('Calendario experimental sin eventos.');
  const matches:HistoricalMatch[]=[]; const warnings:string[]=[];
  for (const event of data.events) {
    try {
      const competition=event.competitions?.[0], competitors=competition?.competitors;
      if (!Array.isArray(competitors)||competitors.length!==2||typeof event.id!=='string') throw new Error('Evento ambiguo.');
      const local=competitors.find((x:any)=>x.homeAway==='home'),visitor=competitors.find((x:any)=>x.homeAway==='away');
      const home=canonicalTeamName(local?.team?.displayName??''),away=canonicalTeamName(visitor?.team?.displayName??'');
      if (!home||!away||home===away) throw new Error('Equipos sin correspondencia explícita.');
      if (typeof event.date!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(event.date)) throw new Error('Hora sin zona declarada.');
      const kickoffAt=Date.parse(event.date);
      if (!Number.isFinite(kickoffAt)) throw new Error('Hora inválida.');
      const date=new Date(kickoffAt).toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
      const firstYear=new Date(kickoffAt).getUTCFullYear()-(new Date(kickoffAt).getUTCMonth()<6?1:0);
      const season=`${firstYear}-${String((firstYear+1)%100).padStart(2,'0')}`;
      const completed=event.status?.type?.completed===true;
      const postponed=/postpon|delay|cancel/i.test(event.status?.type?.name??'');
      let homeGoals:number|null=null,awayGoals:number|null=null;
      if (completed) {
        if (kickoffAt>availableAt) throw new Error('Resultado futuro incoherente.');
        const scores=[local?.score,visitor?.score].map(v=>typeof v==='object'?v?.value:v);
        if (!scores.every(s=>/^\d{1,2}$/.test(String(s)))) throw new Error('Marcador final inválido.');
        [homeGoals,awayGoals]=scores.map(Number);
      }
      matches.push({id:`espn:${event.id}`,season,date,kickoffAt,home,away,homeGoals,awayGoals,status:completed?'finished':postponed?'postponed':kickoffAt>availableAt?'scheduled':'unknown',source:'espn-experimental',captureId,availableAt});
    } catch(error) { warnings.push(`Evento ${String(event.id??'?')} omitido: ${error instanceof Error?error.message:'incompatible'}`); }
  }
  return {matches,warnings};
}
