import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {catalogSelectionAllowed,catalogRulesCurrent} from './odds/acceptance.ts';
import {checkQuote,manualPrematchPolicy} from './odds/freshness.ts';
import {allMatches,type OddsBoard} from './odds/moviodds.ts';
import {championsTeamName} from './data/champions-identity.ts';
import type {DataSnapshot,MarketSelection} from './domain.ts';
import {predictMatch,type Model,type Evaluation} from './model/service.ts';
import {evaluateSelection,allocateStakes,configuredStakeLimits} from './value/service.ts';
import type {LedgerSnapshot} from './ledger/service.ts';
import {canonicalTeamName} from './data/service.ts';
import {assessingSportsReadiness} from './data/quality.ts';

export const MARKET_NAMES:Record<string,string>={'1x2':'Resultado final',double_chance:'Doble oportunidad',dnb:'Empate no válido',asian_handicap:'Hándicap asiático / dos opciones',european_handicap:'Hándicap europeo',total_goals:'Goles totales',team_goals:'Goles de equipo',btts:'Ambos equipos marcan'};
export function selectionLabel(selection:MarketSelection,home:string,away:string):string {
  const labels:any={home,away,draw:'Empate',home_draw:`${home} o empate`,home_away:`${home} o ${away}`,draw_away:`Empate o ${away}`,over:'Más de',under:'Menos de',yes:'Sí',no:'No'};
  return `${labels[selection.side]??selection.side}${selection.line!==null?` ${selection.line>0&&selection.kind.includes('handicap')?'+':''}${selection.line}`:''}${selection.team?` (${selection.team==='home'?home:away})`:''}`;
}
function pct(value:number){return `${(value*100).toFixed(1)} %`;}
function featureLines(prediction:any):string[] {
  const lines=[`Goles esperados: ${prediction.home} ${prediction.expectedGoals.home.toFixed(2)}; ${prediction.away} ${prediction.expectedGoals.away.toFixed(2)}.`,
    `Probabilidades experimentales: local ${pct(prediction.probabilities.home)}, empate ${pct(prediction.probabilities.draw)}, visitante ${pct(prediction.probabilities.away)}.`];
  for(const [key,name] of [['home',prediction.home],['away',prediction.away]]){
    const f=prediction.features[key];
    lines.push(`${name}: ${f.matches} partidos de entrenamiento; últimos cinco: ${f.formPointsPerGame===null?'sin datos':f.formPointsPerGame.toFixed(2)+' puntos/partido'}, ${f.goalsForPerGame===null?'?':f.goalsForPerGame.toFixed(2)} goles a favor y ${f.goalsAgainstPerGame===null?'?':f.goalsAgainstPerGame.toFixed(2)} en contra. Forma ajustada al rival: ${f.opponentAdjustedForm===null?'desconocida':f.opponentAdjustedForm.toFixed(2)}. Intervalo desde el último resultado conocido hasta este encuentro: ${f.restDays===null?'desconocido':f.restDays.toFixed(1)+' días'}; puede haber otros partidos antes, no equivale al descanso real.`);
  }
  lines.push('Lesiones, alineaciones, xG y minutos esperados: no hay cobertura estructurada completa. La ausencia de noticias no significa ausencia de bajas.');
  return lines;
}
export interface ChampionsReportContext {snapshot:DataSnapshot|null;model:Model|null;evaluation:Evaluation|null;operationalReady:boolean;}
export function buildReport(input:{snapshot:DataSnapshot|null;model:Model|null;evaluation:Evaluation|null;board:OddsBoard|null;ledger:LedgerSnapshot;monitor:any;preferences:{minStakeEur:number|null;maxBetFraction?:number};decisions?:any[];operationalReady?:boolean;champions?:ChampionsReportContext;generatedAt?:number;now?:number}) {
  const now=input.now??Date.now(),generatedAt=input.generatedAt??now;
  const catalog=JSON.parse(readFileSync(new URL('../config/market-catalog.json',import.meta.url),'utf8'));
  const primaryCatalog=catalog;
  const championsCatalog=JSON.parse(readFileSync(new URL('../config/champions-market-catalog.json',import.meta.url),'utf8'));
  const {snapshot,model,evaluation,ledger,board}=input;
  const candidates:any[]=[],fixtures:any[]=[],limitations:string[]=[
    'Pronósticos experimentales: no hay rentabilidad demostrada ni garantía de beneficio.',
    'Presupuesto de datos 0 €. La vigilancia está limitada por la cobertura, frecuencia y disponibilidad del proveedor gratuito.',
    'El contraste regional es parcial y caduca; consulta la cuota y reglas que acepta tu cuenta antes de apostar manualmente.',
    'Las noticias aportan hechos y contexto; Qwen no modifica por su opinión las probabilidades ni los importes.'
  ];
  if(!ledger.manual.confirmed)limitations.push('El saldo inicial de 100 € todavía no está confirmado por el usuario. Importe recomendado: 0 €.');
  if(input.preferences.minStakeEur===null)limitations.push('Falta indicar el mínimo que admite tu cuenta para poder proponer importes.');
  if(!board)limitations.push('No hay una respuesta actual de cuotas; no se mantienen oportunidades antiguas.');
  if(input.monitor.invalidQuoteCount)limitations.push(`${input.monitor.invalidQuoteCount} cuotas se han excluido por marcas de origen incoherentes; su respuesta original está archivada.`);
  if(snapshot && now-snapshot.updatedAt>24*3600000)limitations.push('La actualización deportiva tiene más de 24 horas; actualizar antes de valorar apuestas.');
  const latestNews=snapshot?.news.reduce((last,item)=>Math.max(last,item.publishedAt??0),0)??0;
  if(!latestNews||now-latestNews>48*3600000)limitations.push('La noticia más reciente disponible tiene más de 48 horas o no tiene fecha: la cobertura actual de bajas y contexto es incompleta.');
  if(evaluation)limitations.push(...evaluation.limitations);
  const events=allMatches(board);
  const openPositions=ledger.manual.bets.filter(b=>b.status==='open');
  const unknownExposure=openPositions.some(b=>!events.some(event=>event.id===b.eventId));
  for(const event of events){
    const competition=event.competition??'LaLiga';
    const context=competition==='Champions'?input.champions:{snapshot:input.snapshot,model:input.model,evaluation:input.evaluation,operationalReady:input.operationalReady};
    if(!context)continue;
    const {snapshot,model,evaluation}=context,resolveTeam=competition==='Champions'?championsTeamName:canonicalTeamName;
    const catalog=competition==='Champions'?championsCatalog:primaryCatalog;
    if(event.kickoffAt<=now || model && event.kickoffAt<=model.cutoff)continue;
    const home=resolveTeam(event.home),away=resolveTeam(event.away);
    if(!home||!away||!model)continue;
    const prediction=predictMatch(model,home,away,event.kickoffAt);
    const quality=snapshot?assessingSportsReadiness(snapshot,{home,away,kickoffAt:event.kickoffAt},now,resolveTeam):{ready:false,reasons:['Sin datos deportivos.'],warnings:[]};
    const news=snapshot?.news.filter(item=>item.teams.includes(home)||item.teams.includes(away)).slice(0,12)??[];
    const analysis=featureLines(prediction);
    const facts=snapshot?.newsAnalysis.facts.filter(fact=>fact.team===home||fact.team===away)??[];
    for(const fact of facts)analysis.push(`Contexto (${fact.status}): ${fact.evidence}`);
    if(!facts.length)analysis.push('No hay hechos de bajas o rotaciones extraídos y verificados para este partido.');
    if(competition==='Champions')analysis.push('Forma y fuerza estimadas con encuentros de Champions; no representa todos los partidos de las ligas nacionales. Solo 90 minutos: se excluyen prórroga, penaltis y mercados de clasificación.');
    fixtures.push({competition,id:event.id,home,away,kickoffAt:event.kickoffAt,prediction,analysis,news,warnings:[...prediction.warnings,...quality.warnings,...quality.reasons],quality,trainingCaptureIds:model.trainingCaptureIds});
    for(const quote of event.quotes){
      if(!quote.selection)continue;
      const calculationPrice=quote.priceForCalculation??quote.price;
      const selection=quote.selection,value=evaluateSelection(prediction,selection,calculationPrice);
      const freshnessPolicy=manualPrematchPolicy(quote.kickoffAt,now),check=checkQuote(quote,now,freshnessPolicy);
      const gates=(evaluation as any)?.marketGates;
      const family=gates?.[selection.kind];
      const exact=family?.selections?.find((row:any)=>row.side===selection.side && row.line===selection.line && (row.team??null)===(selection.team??null));
      const marketPassed=exact?.passed===true;
      const reasons:string[]=[];
      if(context.operationalReady===false)reasons.push('Comprobación técnica de fuentes y vigilancia pendiente; solo observación.');
      if(quote.competition!==competition)reasons.push('La cuota pertenece a otra competición.');
      if(!catalogRulesCurrent(catalog,now))reasons.push('Reglas del catálogo sin revisión vigente.');
      if(!catalogSelectionAllowed(quote,catalog))reasons.push('Mercado en investigación: fuera del catálogo inicial contrastado.');
      if(!check.valid)reasons.push(({ 'coverage-unverified':'Precio sin contraste regional vigente.','stale-source':'El proveedor no ha reconfirmado este mercado recientemente.','stale-receipt':'La última consulta ha caducado.','suspended-or-unknown':'Selección suspendida o sin disponibilidad confirmada.','not-prematch':'Partido iniciado.'} as any)[check.reason]??`Cuota descartada: ${check.reason}.`);
      if(!input.monitor.running || input.monitor.error)reasons.push('Vigilancia detenida o con un fallo pendiente.');
      if(!prediction.ready)reasons.push(...prediction.warnings);
      if(!marketPassed)reasons.push(...(exact?.reasons?.length?exact.reasons:['Validación fuera de entrenamiento insuficiente para esta selección y línea.']));
      if(!snapshot || now-snapshot.updatedAt>24*3600000)reasons.push('Actualizar los datos deportivos.');
      if(!quality.ready)reasons.push(...quality.reasons);
      if(unknownExposure)reasons.push('Hay una apuesta abierta sin correspondencia de partido verificable; concilia el registro antes de añadir exposición.');
      if(!value.valid)reasons.push(value.reason??'Distribución no válida.');
      if(value.expectedValue<.03)reasons.push('Ventaja estimada inferior al umbral prudente del 3 %.');
      const gain=value.probabilities.win+.5*value.probabilities.halfWin;
      const resultQuotes=event.quotes.filter(q=>q.selection?.kind==='1x2'&&q.period===quote.period&&!q.suspended);
      const completeResult=['home','draw','away'].every(side=>resultQuotes.filter(q=>q.selection?.side===side).length===1);
      const resultMargin=completeResult?resultQuotes.reduce((sum,q)=>sum+1/q.price,0)-1:null;
      const impliedProbability=1/calculationPrice;
      const fairMarketProbability=quote.selection.kind==='1x2'&&resultMargin!==null?impliedProbability/(1+resultMargin):null;
      const minimumOdds=gain>0?1+(value.probabilities.loss+.5*value.probabilities.halfLoss+.03)/gain:null;
      const id=createHash('sha256').update(JSON.stringify([model.version,event.id,quote.marketId,quote.period,quote.selectionId,quote.line,quote.price,quote.sourceUpdatedAt])).digest('hex').slice(0,24);
      const decision=input.decisions?.filter(d=>d.recommendationId===id).at(-1);
      if(decision?.status==='omitted')reasons.push('Selección omitida por el usuario; no se asigna presupuesto.');
      candidates.push({competition,id,eventId:event.id,fixtureId:event.id,eventName:`${home} — ${away}`,home,away,kickoffAt:event.kickoffAt,bookmakerUrl:`https://www.bet365.es/#/AC/B1/C1/D8/E${encodeURIComponent(event.id)}/F3/G40/`,
        market:MARKET_NAMES[selection.kind],selection:selectionLabel(selection,home,away),marketSelection:selection,price:calculationPrice,observedPrice:quote.price,
        probability:value.probabilityWin,impliedProbability,fairMarketProbability,marketMargin:quote.selection.kind==='1x2'?resultMargin:null,expectedValue:value.expectedValue,minimumOdds,breakEvenOdds:value.breakEvenOdds,settlement:value.probabilities,
        stakeEur:0,stakePct:0,actionable:reasons.length===0,greatOpportunity:false,modelValidated:marketPassed&&prediction.ready&&quality.ready,status:'research',decisionStatus:decision?.status??null,reasons,quote,value,modelWarnings:prediction.warnings,news,analysis,
        quoteMaxSourceAgeMs:freshnessPolicy.maxSourceAgeMs,validUntil:Math.min(quote.receivedAt+30000,(quote.sourceConfirmedAt??0)+freshnessPolicy.maxSourceAgeMs,quote.kickoffAt),uncertainty:'El valor esperado es experimental y no dispone de un intervalo de incertidumbre calibrado. La etiqueta de gran oportunidad exige al menos 8 % estimado y todos los controles; no acredita rentabilidad.'});
    }
  }
  const allocations=allocateStakes(candidates.map(c=>({id:c.id,fixtureId:c.fixtureId,teams:[c.home,c.away],price:c.price,value:c.value,actionable:c.actionable,reason:c.reasons[0]})),
    {balanceEur:ledger.manual.bankrollEur,committedEur:ledger.manual.committedEur,confirmedAt:ledger.manual.confirmedAt,
      positions:openPositions.map(b=>{const event=events.find(e=>e.id===b.eventId),resolveTeam=event?.competition==='Champions'?championsTeamName:canonicalTeamName;return {fixtureId:b.eventId,stakeEur:b.stakeEur,teams:event?[resolveTeam(event.home)!,resolveTeam(event.away)!].filter(Boolean):[]};})},
    {...configuredStakeLimits(input.preferences.maxBetFraction),minStakeEur:input.preferences.minStakeEur},now);
  for(const candidate of candidates){
    const allocation=allocations.allocations.find(a=>a.id===candidate.id)!;
    candidate.stakeEur=allocation.stakeEur;candidate.stakePct=allocation.stakePct;
    if(allocation.stakeEur===0){candidate.actionable=false;if(!candidate.reasons.includes(allocation.reason))candidate.reasons.push(allocation.reason);}
    candidate.greatOpportunity=candidate.actionable&&candidate.stakeEur>0&&candidate.expectedValue>=.08;
    candidate.status=candidate.actionable?'active':'research';
    delete candidate.value;
  }
  candidates.sort((a,b)=>Number(b.actionable)-Number(a.actionable)||Number(b.modelValidated)-Number(a.modelValidated)||b.expectedValue-a.expectedValue);
  const active=candidates.filter(c=>c.actionable).length;
  const marketCatalog=Object.entries(MARKET_NAMES).map(([kind,name])=>({kind,name,status:!catalog.initialMarkets.some((m:any)=>m.kind===kind)?'investigación; fuera del catálogo inicial':candidates.some(c=>c.marketSelection.kind===kind)?(candidates.some(c=>c.marketSelection.kind===kind&&c.modelValidated)?'solo líneas con validación aprobada':'calculado; validación no superada'):'sin cuotas compatibles',reason:'Cada selección exige su propio control de precio, línea, cobertura y validación.'}));
  for(const name of ['Córners','Tarjetas','Faltas y fueras de juego','Goleadores y asistencias','Remates de jugadores','Pases y acciones de jugadores','Paradas de porteros','Temporada','Directo','Combinadas'])marketCatalog.push({kind:name,name,status:'pendiente',reason:'Familia pendiente de datos, modelo y validación propios; no se presenta como analizada.'});
  const id=createHash('sha256').update(JSON.stringify([generatedAt,model?.version,input.champions?.model?.version,board?.receivedAt,ledger.events.at(-1)?.seq,input.preferences])).digest('hex').slice(0,24);
  return {id,generatedAt,asOf:now,status:active?'ready':candidates.length?'research':'empty',
    summary:active?`${active} selecciones superan los controles actuales. Total propuesto ${allocations.totalStakeEur.toFixed(2)} €; ejecución manual.`:'No hay apuestas que superen todos los controles en este momento. Importe recomendado: 0 €.',
    bankroll:{balanceEur:ledger.manual.bankrollEur,committedEur:ledger.manual.committedEur,availableEur:ledger.manual.availableEur,totalRecommendedEur:allocations.totalStakeEur,freeAfterEur:allocations.freeEur,confirmed:ledger.manual.confirmed},
    candidates,fixtures,coverage:[...(snapshot?.coverage??[]),...(input.champions?.snapshot?.coverage??[])],evaluation,championsEvaluation:input.champions?.evaluation??null,news:snapshot?.news??[],newsAnalysis:snapshot?.newsAnalysis??null,limitations:[...new Set([...limitations,...(input.champions?.evaluation?.limitations??[]),'LaLiga y Champions comparten saldo y límites; una propuesta de una competición reduce el presupuesto disponible para la otra.'])],marketCatalog,
    model:model?{version:model.version,cutoff:model.cutoff,trainingMatches:model.trainingMatches,lastResultAt:model.lastResultAt,rho:model.rho,warnings:model.warnings}:null,
    errors:[...(snapshot?.errors??[]),...(input.champions?.snapshot?.errors??[]),...(input.monitor.error?[input.monitor.error]:[])]};
}
const escape=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function renderRawReport(report:ReturnType<typeof buildReport>):string {
  const date=new Date(report.generatedAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'});
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Análisis de LaLiga y Champions · ${escape(date)}</title><style>body{font:16px/1.65 system-ui;max-width:1100px;margin:40px auto;padding:0 22px;color:#17283b;background:#f5f7f8}section,article{background:white;padding:24px;border-radius:14px;margin:20px 0}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}.note{border-left:4px solid #bc8523;padding:14px;background:#fff5dc}a{color:#087b70}</style><h1>LaLiga y Champions · análisis y oportunidades</h1><p>LaLiga y UEFA Champions League · modelos propios y presupuesto compartido.</p><p>Emitido ${escape(date)} · Bet365 · presupuesto inicial 100 € · registro y apuestas manuales.</p><p class="note">Copia fechada del análisis, no un precio garantizado. La vigencia y los importes actuales se consultan en el panel. No se envía ninguna apuesta.</p><section><h2>${escape(report.summary)}</h2><p>Patrimonio registrado ${report.bankroll.balanceEur.toFixed(2)} € · comprometido ${report.bankroll.committedEur.toFixed(2)} € · libre ${report.bankroll.availableEur.toFixed(2)} €.</p><ul>${report.limitations.map(line=>`<li>${escape(line)}</li>`).join('')}</ul></section><section><h2>Selecciones examinadas</h2><table><tr><th>Partido / selección</th><th>Cuota observada</th><th>Probabilidad experimental</th><th>Valor esperado</th><th>Importe al emitir</th></tr>${report.candidates.slice(0,100).map(c=>`<tr><td>${escape(c.competition??'LaLiga')} · ${escape(c.eventName)}<br>${escape(c.market)} · ${escape(c.selection)}<br><small>${escape(c.reasons.join(' '))}</small></td><td>${c.price.toFixed(3)}<br><small>Precio mínimo estimado ${c.minimumOdds?.toFixed(3)??'sin cálculo'}</small></td><td>${pct(c.probability)}</td><td>${pct(c.expectedValue)}</td><td>${c.stakeEur.toFixed(2)} €</td></tr>`).join('')}</table></section>${report.fixtures.map(f=>`<article><h2>${escape(f.competition??'LaLiga')} · ${escape(f.home)} — ${escape(f.away)}</h2><p>${escape(new Date(f.kickoffAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}))}</p>${f.analysis.map((line:string)=>`<p>${escape(line)}</p>`).join('')}<h3>Información recibida</h3>${f.news.length?f.news.map((n:any)=>`<p><a href="${escape(n.url)}">${escape(n.title)}</a> · ${escape(n.scope)} · ${n.publishedAt?escape(new Date(n.publishedAt).toISOString()):'fecha desconocida'}</p>`).join(''):'<p>Sin noticias vinculadas; no equivale a ausencia de bajas.</p>'}<p>${escape(f.warnings.join(' '))}</p></article>`).join('')}<section><h2>Evaluación del modelo</h2><pre style="white-space:pre-wrap">${escape(JSON.stringify(report.evaluation,null,2))}</pre></section><section><h2>Cobertura y fuentes</h2>${report.coverage.map(c=>`<p>${escape(c.source)} ${escape(c.season)}: ${c.scored}/${c.matches} con resultado; ${c.missingPastResults} resultados pasados ausentes. ${escape(c.warnings.join(' '))}</p>`).join('')}<p>Modelo ${escape(report.model?.version)} · noticias y cuotas con sus capturas en el archivo local.</p></section></html>`;
}

export function renderReport(report:ReturnType<typeof buildReport>):string {
  const e=report.evaluation;
  let evaluation='<p>Todavía no hay una evaluación suficiente. No se autorizan propuestas con dinero.</p>';
  if(e?.status==='evaluated'&&e.test){
    const metrics=e.test,baseline=e.benchmark.test;
    evaluation=`<p>Entrenamiento: ${e.chronology.trainingCount} partidos. Validación: ${e.chronology.validationCount}. Prueba final: ${metrics.sampleSize}, entre ${escape(e.chronology.testStart)} y ${escape(e.chronology.testEnd)}.</p>
      <table><tr><th>Medida</th><th>Modelo</th><th>Referencia sencilla</th></tr><tr><td>Error probabilístico (Brier; menor es mejor)</td><td>${metrics.brier.toFixed(4)}</td><td>${baseline?.brier.toFixed(4)??'Sin datos'}</td></tr><tr><td>Error logarítmico (menor es mejor)</td><td>${metrics.logLoss.toFixed(4)}</td><td>${baseline?.logLoss.toFixed(4)??'Sin datos'}</td></tr><tr><td>Acierto del resultado más probable</td><td>${pct(metrics.accuracy)}</td><td>${baseline?pct(baseline.accuracy):'Sin datos'}</td></tr></table>
      <p>Desviación media de calibración observada: ${pct(metrics.expectedCalibrationError)}. No se dispone de cuotas históricas verificadas para publicar una rentabilidad.</p>
      <p>Comprobación por selección y línea: ${Object.entries((e as any).marketGates??{}).map(([kind,gate]:any)=>`${escape(MARKET_NAMES[kind]??kind)}: ${gate.selections.filter((s:any)=>s.passed).length}/${gate.selections.length} selecciones predefinidas superan los controles`).join('; ')}.</p><p>Los mercados y líneas que fallan permanecen bloqueados. Superar una referencia de probabilidades no acredita ganancias futuras.</p>`;
  }
  const ce=report.championsEvaluation;
  const championsEvaluation=ce?.test?`<section><h2>Evaluación propia de Champions</h2><p>${ce.chronology.trainingCount} partidos de entrenamiento, ${ce.chronology.validationCount} de validación y ${ce.test.sampleSize} de prueba final. Brier ${ce.test.brier.toFixed(4)}; referencia ${ce.benchmark.test?.brier.toFixed(4)??'sin datos'}. Solo se habilitan selecciones y líneas con controles aprobados. No acredita rentabilidad.</p></section>`:'';
  return renderRawReport(report)
    .replace('<section><h2>Cobertura y fuentes</h2>',championsEvaluation+'<section><h2>Cobertura y fuentes</h2>')
    .replace(/<pre style="white-space:pre-wrap">[\s\S]*?<\/pre>/,evaluation)
    .replace('<h2>Selecciones examinadas</h2>','<h2>Selecciones examinadas</h2><p>Se muestran las primeras 100 observaciones priorizadas. Cada valor esperado es experimental y carece de un intervalo de incertidumbre calibrado. Un porcentaje alto sin superar todos los controles conserva importe 0 €. La comparación completa está en el panel.</p>');
}
