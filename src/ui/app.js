'use strict';
let state=null,ledgerMode='manual',pollBusy=false,noticeTimer=null,lastQuoteStatus='',connected=false;
let candidateView={competition:'',query:'',market:'',eventId:'',status:'active',limit:20},searchTimer=null;
try{const saved=JSON.parse(localStorage.getItem('laliga-observatorio.filters.v2')??'null');if(saved&&typeof saved==='object')candidateView={competition:['LaLiga','Champions'].includes(saved.competition)?saved.competition:'',query:typeof saved.query==='string'?saved.query.slice(0,200):'',market:typeof saved.market==='string'?saved.market.slice(0,500):'',eventId:typeof saved.eventId==='string'?saved.eventId.slice(0,500):'',status:['all','active','observations','validated','unvalidated'].includes(saved.status)?saved.status:'all',limit:Number.isSafeInteger(saved.limit)?Math.min(2000,Math.max(20,saved.limit)):20};}catch{}
const $=selector=>document.querySelector(selector);
const money=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(n)):'—';
const pct=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?`${(n*100).toFixed(d).replace('.',',')} %`:'—';
const num=(n,d=2)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const time=t=>t?new Date(t).toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Hora sin confirmar';
const text=(selector,value)=>{$(selector).textContent=String(value??'—');};
const array=value=>Array.isArray(value)?value:[];
const toString=value=>typeof value==='string'?value:typeof value==='number'?String(value):'';
function node(tag,attributes={},children=[]) {
  const n=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(value===undefined||value===null) continue;
    if(key==='className') n.className=value; else n.setAttribute(key,String(value));
  }
  for(const child of children.flat()) if(child!==undefined&&child!==null) n.append(child instanceof Node?child:String(child));
  return n;
}
function button(label,handler,className='text-button') {const b=node('button',{type:'button',className},[label]);b.addEventListener('click',handler);return b;}
function list(lines) {return node('ul',{},array(lines).filter(Boolean).map(line=>node('li',{},[toString(line)])));}
function safeLink(url,label,className='') {
  try {const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))return node('span',{},[label]);return node('a',{href:parsed.href,target:'_blank',rel:'noopener noreferrer',className},[label]);}
  catch{return node('span',{},[label]);}
}
function stat(label,value,positive=false){return node('div',{className:'stat'},[node('span',{className:'stat-name'},[label]),node('span',{className:`stat-number${positive?' positive':''}`},[value])]);}
function notice(message,error=false) {
  const box=$('#notice');box.hidden=false;box.className=`notice${error?' error':''}`;box.textContent=message;
  clearTimeout(noticeTimer);if(!error)noticeTimer=setTimeout(()=>{box.hidden=true;},14000);
}
async function api(path,body) {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-laliga-token':state?.csrfToken??''},
    body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(180000)});
  let value;try{value=await response.json();}catch{throw new Error('El bot no devolvió una respuesta legible.');}
  if(!response.ok)throw new Error(value.error?.message??value.error??value.message??'No se pudo completar la operación.');return value;
}
async function action(path,body={},message='Operación completada.',target=null) {
  if(target)target.disabled=true;
  try{const value=await api(path,body);await refresh();notice(value.message??message);return true;}
  catch(error){notice(error.message,true);return false;}finally{if(target)target.disabled=false;}
}
async function refresh() {
  if(pollBusy)return;pollBusy=true;
  try{state=await api('/api/state?focus='+encodeURIComponent(candidateView.eventId));connected=true;render();$('#connection').replaceChildren(node('span',{className:'status-dot'}),node('span',{},['Panel conectado']));}
  catch(error){connected=false;$('#connection').replaceChildren(node('span',{className:'status-dot error'}),node('span',{},['Sin conexión al bot']));if(!state)notice('No se puede conectar con el bot. Mantén abierta la ventana de inicio y vuelve a cargar el panel.',true);expireOnly();}
  finally{pollBusy=false;}
}
function quoteReason(candidate,now=Date.now()) {
  if(!connected)return'Panel desconectado: no se muestran importes activos';
  if(decision(candidate.id)?.status==='omitted')return'Has decidido omitir esta selección';
  const q=candidate.quote;
  if(q?.validationError)return 'Metadatos de origen inválidos';
  if(q?.sourceStale)return 'Mercado sin reconfirmación reciente';
  if(!q||q.regionVerified!==true)return'Cobertura de Bet365 España sin contrastar';
  if(q.suspended!==false)return'Mercado suspendido o sin confirmar';
  if(!Number.isFinite(q.kickoffAt)||q.kickoffAt<=now)return'El encuentro ya comenzó o su hora no está confirmada';
  const sourceTime=q.timestampKind==='observation'?q.sourceObservedAt:q.sourceUpdatedAt;
  if(!Number.isFinite(q.sourceConfirmedAt)||!Number.isFinite(q.receivedAt)||!Number.isFinite(sourceTime)||!Number.isFinite(q.requestedAt))return'Faltan horas de origen o recepción';
  if(q.receivedAt>now||q.requestedAt>q.receivedAt||sourceTime>q.sourceConfirmedAt||q.sourceConfirmedAt>q.receivedAt)return'Horas incompatibles';
  const maxSourceAge=Math.min(candidate.quoteMaxSourceAgeMs??60000,q.kickoffAt-now>48*3600000?900000:q.kickoffAt-now>24*3600000?300000:60000);
  if(now-q.receivedAt>30000||now-q.sourceConfirmedAt>maxSourceAge)return'Cuota caducada: esperando una nueva confirmación';
  if(q.receivedAt-q.requestedAt>10000)return'Respuesta demasiado lenta';
  if(candidate.modelValidated!==true)return'Validación pendiente para esta selección y línea';
  if(candidate.actionable!==true)return array(candidate.reasons)[0]??'No supera todas las comprobaciones';
  return null;
}
const fresh=c=>quoteReason(c)===null;
function decision(id){return array(state?.decisions).filter(d=>d.recommendationId===id).at(-1)??null;}
function report(){return state?.report??{};}
function candidates(){return array(report().candidates);}
function account(){const l=state?.ledger??{};return l.manual??l;}
function expireOnly(){if(!state)return;renderAmounts();renderChampions();const key=candidates().map(c=>`${c.id}:${quoteReason(c)}`).join('|');if(key!==lastQuoteStatus)renderCandidates();}
function renderAmounts(){
  text('#providerStatus',state?.providerConfigured?'Clave local configurada; la próxima respuesta comprobará su validez.':'Falta la clave gratuita. Las cuotas permanecen bloqueadas.');
  const a=account(),eligible=candidates().filter(fresh),proposed=eligible.reduce((sum,c)=>sum+Math.max(0,Number(c.stakeEur)||0),0);
  text('#availableAmount',money(a.availableEur??a.balanceEur));text('#committedAmount',money(a.committedEur));
  text('#balanceNote',a.confirmed?'Saldo que has confirmado en tu registro':'Presupuesto inicial · saldo por confirmar');
  text('#recommendedAmount',money(proposed));text('#opportunityCount',eligible.length);
  text('#recommendationNote',eligible.length?'Suma de propuestas vigentes · no se descuenta':'Con las condiciones actuales, no apostar');
  text('#reportTime',report().generatedAt?`Análisis del ${time(report().generatedAt)}`:'Todavía sin informe');
  const banner=$('#coverageBanner'),verified=eligible.length>0;
  banner.className=`coverage-banner${verified?' good':''}`;
  const limits=array(report().limitations);
  const balanceStale=!a.confirmed||!a.confirmedAt||Date.now()-a.confirmedAt>24*3600000;
  const heading=verified?'Hay apuestas recomendadas vigentes':!connected?'Panel sin conexión':!state?.monitor?.running?'Seguimiento detenido':!state?.operation?.ready?'Faltan comprobaciones operativas':balanceStale?'Confirma tu saldo para calcular importes':'Bot activo · ninguna apuesta cumple los controles ahora';
  const details=balanceStale?'Ve a «Mis apuestas» y confirma el dinero libre que ves ahora en Bet365. El último saldo guardado no se renueva automáticamente.':verified?'Revisa el análisis, comprueba la cuota actual y decide. El importe es una propuesta; el panel no realiza apuestas.':state?.operation?.ready?'El bot analiza las cuotas automáticamente. Precio caducado, falta de contraste español, modelo insuficiente o ventaja pequeña mantienen el importe en 0 €.':
    limits.find(x=>/españa|regional|región|verific|contrasta/i.test(String(x)))??'Aún no hay una oportunidad que supere todas las comprobaciones. Las observaciones sin validar tienen un importe de 0 €.';
  banner.replaceChildren(node('span',{className:'banner-icon','aria-hidden':'true'},['i']),node('div',{},[node('strong',{},[heading]),node('p',{},[details])]));
  const comparisons=array(state?.bet365Comparisons).filter(c=>Date.now()>=c.checkedAt&&Date.now()-c.checkedAt<24*3600000);
  text('#bet365ComparisonSummary',comparisons.length?`Contraste público con Bet365 España: ${comparisons.length} partidos y ${comparisons.reduce((n,c)=>n+array(c.coverage).reduce((m,e)=>m+array(e.selections).length,0),0)} selecciones coincidentes. Último contraste: ${time(Math.max(...comparisons.map(c=>c.checkedAt)))}. Es una comprobación puntual; revisa siempre el precio que acepta tu cuenta.`:'El precio de la API y el que acepta tu cuenta pueden variar. El panel exige un contraste español vigente para proponer dinero.');
}
function renderMonitor(){
  const m=state?.monitor??{};const running=m.running===true;
  text('#monitorLabel',running?'Seguimiento automático activo':'Seguimiento detenido');
  $('#monitorDot').className=`status-dot${m.error?' error':running?'':' muted'}`;
  const lines=[];if(m.lastSuccessAt)lines.push(`Última consulta: ${time(m.lastSuccessAt)}`);if(running&&m.nextPollAt)lines.push(`Próxima: ${time(m.nextPollAt)}`);
  if(m.error)lines.push(toString(m.error));if(!lines.length)lines.push('Solo en este panel, mientras el bot esté abierto.');
  text('#monitorDetails',lines.join(' · '));text('#monitorButton',running?'Detener seguimiento':'Iniciar seguimiento');
  const job=state?.job;const busy=job?.running===true||['running','refreshing','training','news'].includes(job?.status);
  $('#refreshButton').disabled=busy;$('#newsButton').disabled=busy;
  if(busy&&job.message)text('#monitorDetails',job.message);
}
function renderCandidates(){
  const container=$('#opportunityList');const opened=new Set([...container.querySelectorAll('details[open]')].map(n=>n.dataset.id));
  const allRows=candidates();
  text("#viewObservations",candidateView.status==="active"?"Ver opciones no recomendadas":"Volver a las recomendaciones");
  lastQuoteStatus=allRows.map(c=>`${c.id}:${quoteReason(c)}`).join('|');
  renderFilters(allRows);
  const query=normalize(candidateView.query);
  const filtered=allRows.filter(c=>(!candidateView.competition||c.competition===candidateView.competition)&&(!candidateView.market||c.market===candidateView.market)&&(!candidateView.eventId||String(c.eventId??c.fixtureId)===candidateView.eventId)&&(!query||normalize(`${c.eventName??''} ${c.home??''} ${c.away??''} ${c.market??''} ${c.selection??''}`).includes(query))&&
    (candidateView.status==='all'||candidateView.status==='active'&&fresh(c)||candidateView.status==='observations'&&!fresh(c)||candidateView.status==='validated'&&c.modelValidated===true||candidateView.status==='unvalidated'&&c.modelValidated!==true))
    .sort((a,b)=>Number(fresh(b))-Number(fresh(a))||Number(b.modelValidated===true)-Number(a.modelValidated===true)||(Number(b.expectedValue)||0)-(Number(a.expectedValue)||0));
  const active=filtered.filter(fresh),observations=filtered.filter(c=>!fresh(c));
  const rows=[...active,...observations.slice(0,candidateView.limit)],more=observations.length>candidateView.limit;
  text('#candidateCount',`${rows.length} de ${filtered.length}${filtered.length!==allRows.length?` · ${allRows.length} en total`:''}`);
  text('#filterSummary',active.length?`${active.length} oportunidades vigentes visibles · ${Math.min(candidateView.limit,observations.length)} de ${observations.length} observaciones.`:`${Math.min(candidateView.limit,observations.length)} de ${observations.length} observaciones. Las oportunidades vigentes se muestran siempre sin límite.`);
  $('#paginationBar').hidden=!more;text('#paginationNote',more?`Quedan ${observations.length-Math.min(candidateView.limit,observations.length)} observaciones en estos filtros.`:'');
  text('#summary',report().summary??'');$('#summary').hidden=!report().summary;
  if(!rows.length){container.replaceChildren(node('div',{className:'empty-state'},[node('span',{'aria-hidden':'true'},['◎']),node('h3',{},[candidateView.status==='active'?'Ahora no hay apuestas recomendadas':'Sin selecciones con estos filtros']),node('p',{},[candidateView.status==='active'?'Revisa el estado de arriba. Los análisis descartados están disponibles aparte y no son propuestas para apostar.':'Prueba otro partido, mercado o búsqueda.'])]));return;}
  container.replaceChildren(...rows.map(c=>{
    const reason=quoteReason(c),ok=reason===null,great=ok&&c.greatOpportunity===true;
    const stateLabel=great?'Gran oportunidad · experimental':ok?'Propuesta disponible':'No apostar todavía';
    const top=node('div',{className:'opportunity-top'},[node('div',{},[node('div',{className:'opportunity-title'},[c.eventName??`${c.home??''} — ${c.away??''}`]),node('div',{className:'event-time'},[`${c.competition??'LaLiga'} · ${time(c.kickoffAt)}`]),node('div',{className:'selection-name'},[`${toString(c.market)} · ${toString(c.selection)}`])]),node('span',{className:`tag ${ok?'good':'warning'}`},[stateLabel])]);
    const minimum=num(Number.isFinite(c.minimumOdds)?Math.ceil(c.minimumOdds*100-1e-9)/100:null);
    const values=node('div',{className:'opportunity-values simple-values'},[stat('Cuota recibida',num(c.price)),stat('Importe que propone el bot',money(ok?Math.max(0,Number(c.stakeEur)||0):0),ok),stat('Acierto estimado · no garantizado',pct(c.probability))]);
    values.firstElementChild.append(node('small',{className:'helper'},[`Mínima estimada: ${minimum}`]));
    const friendlyReason=/Cobertura de Bet365 España|contraste regional/.test(reason??'')?'Falta comprobar este mercado en Bet365 España.':/apuesta o propuesta|exposición a este partido/.test(reason??'')?'El bot ya eligió otra opción para este partido.':reason;
    const note=ok?`Precio leído por el proveedor: ${time(c.quote.sourceConfirmedAt)}. Comprueba el de tu cuenta antes de apostar.`:friendlyReason;
    const choice=decision(c.id);const choices=node('div',{className:'candidate-actions'},[
      button('1. Comprobar precio',event=>action('/api/quotes/refresh',{eventId:c.eventId},null,event.currentTarget),'button primary small'),
      safeLink(c.bookmakerUrl,'2. Ver en Bet365','button secondary small'),
      button('3. Ya la he apostado',()=>prefill(c),'button secondary small'),
      node('details',{className:'extra-actions'},[node('summary',{},['Más acciones']),
        button('Dejar pendiente',event=>action('/api/decisions',{recommendationId:c.id,status:'pending',idempotencyKey:crypto.randomUUID()},'Selección marcada como pendiente. No reserva dinero.',event.currentTarget)),
        button('Omitir',event=>action('/api/decisions',{recommendationId:c.id,status:'omitted',idempotencyKey:crypto.randomUUID()},'Selección omitida. No se ha registrado ninguna apuesta.',event.currentTarget))])
    ]);
    const bottom=node('div',{className:'opportunity-bottom'},[node('span',{className:`quote-note${ok?'':' unsafe'}`},[note,choice?` · Tu decisión: ${choice.status==='omitted'?'omitida':'pendiente'}`:'']),choices]);
    const details=node('details',{className:'analysis-details','data-id':c.id??''},[node('summary',{},['Por qué la propone · cálculo y fuentes'])]);
    details.append(node('p',{},[`Precio mínimo estimado: ${minimum}. Ventaja matemática estimada: ${pct(c.expectedValue)}. Esta ventaja no es la probabilidad de ganar ni una rentabilidad demostrada. Si cambia el precio, vuelve a comprobarlo para recalcular el importe.`]));
    if(opened.has(String(c.id??'')))details.open=true;
    for(const line of array(c.analysis))details.append(node('p',{},[toString(line)]));
    if(typeof c.fairMarketProbability==='number')details.append(node('p',{},[`Referencia del mercado sin margen (1X2): ${pct(c.fairMarketProbability)}; margen conjunto observado ${pct(c.marketMargin)}. Es una referencia, no la probabilidad verdadera.`]));
    const reasons=[...array(c.reasons),...array(c.modelWarnings)];if(reasons.length)details.append(list([...new Set(reasons.map(toString))]));
    if(c.quote)details.append(node('p',{},[`Cuota de origen: ${num(c.quote.price,6)} · Cuota de cálculo: ${num(c.price)} · Lectura de origen: ${time(c.quote.sourceObservedAt)} · Último cambio: ${c.quote.sourceUpdatedAt?time(c.quote.sourceUpdatedAt):'desconocido'} · Confirmación de mercado: ${time(c.quote.sourceConfirmedAt)} · Recibida: ${time(c.quote.receivedAt)}. Verificación regional: ${c.quote.regionVerificationMode==='sampled-coverage'?'compatibilidad por muestra; precio español actual sin comprobar':c.quote.regionVerified===true?'contraste puntual':'pendiente'}.`]));
    for(const n of array(c.news).slice(0,5))details.append(node('p',{},[safeLink(n.url,n.title??'Fuente de noticias')]));
    const uncertainty=node('p',{className:'uncertainty-note'},[c.uncertainty??'Estimación experimental. No hay un intervalo de incertidumbre calibrado ni una rentabilidad demostrada para esta selección.']);
    details.append(uncertainty);
    return node('article',{className:`opportunity-card${ok?' actionable':''}${great?' great':''}`},[top,values,bottom,details]);
  }));
}
function normalize(value){return String(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replaceAll(',','.').trim();}
function saveView(){try{localStorage.setItem('laliga-observatorio.filters.v2',JSON.stringify(candidateView));}catch{}}
function renderFilters(rows){
  $('#competitionFilter').value=candidateView.competition??'';
  const updateOptions=(selector,options,selected,emptyLabel)=>{
    const control=$(selector),values=[...new Map(options.map(item=>[item.value,item])).values()];
    values.sort((a,b)=>a.label.localeCompare(b.label,'es'));
    if(selected&&!values.some(item=>item.value===selected))values.push({value:selected,label:control.selectedOptions[0]?.textContent??'Selección sin cuotas actuales'});
    const signature=JSON.stringify(values);if(control.dataset.options!==signature&&document.activeElement!==control){control.replaceChildren(node('option',{value:''},[emptyLabel]),...values.map(item=>node('option',{value:item.value},[item.label])));control.dataset.options=signature;}
    if(document.activeElement!==control)control.value=selected;
  };
  updateOptions('#marketFilter',rows.map(c=>({value:toString(c.market),label:toString(c.market)})).filter(o=>o.value),candidateView.market,'Todos los mercados');
  updateOptions('#fixtureFilter',rows.map(c=>({value:String(c.eventId??c.fixtureId),label:c.eventName??`${c.home??''} — ${c.away??''}`})),candidateView.eventId,'Todos los partidos');
  if(document.activeElement!==$('#candidateSearch'))$('#candidateSearch').value=candidateView.query;$('#statusFilter').value=candidateView.status;
}
function renderFixtures(){
  const rows=array(report().fixtures);text('#fixtureCount',`${rows.length} partidos`);
  $('#fixturesList').replaceChildren(...(rows.length?rows.map(f=>{
    const prediction=f.prediction??{},p=prediction.probabilities??prediction.result??prediction.outcomes??{};
    const home=p.home??prediction.homeWin??prediction.homeProbability,draw=p.draw??prediction.drawProbability,away=p.away??prediction.awayWin??prediction.awayProbability;
    const contents=[node('div',{className:'fixture-name'},[`${f.home??''} — ${f.away??''}`]),node('div',{className:'event-time'},[time(f.kickoffAt)])];
    if([home,draw,away].some(Number.isFinite))contents.push(node('div',{className:'probabilities'},[['Local',home],['Empate',draw],['Visitante',away]].map(([title,v])=>node('div',{className:'probability'},[node('span',{},[title]),node('strong',{},[pct(v)])]))));
    if(array(f.analysis).length)contents.push(list(f.analysis));if(array(f.warnings).length)contents.push(node('p',{className:'fixture-warning'},[array(f.warnings).map(toString).join(' · ')]));
    return node('article',{className:'card fixture-card'},contents);
  }):[node('div',{className:'empty-state span-all'},[node('h3',{},['Calendario pendiente']),node('p',{},['No se han recibido partidos con información suficiente.'])]) ]));
  const e=report().evaluation,gate=e?.modelGate?.passed===true;
  $('#modelGate').className=`tag${gate?' good':' warning'}`;text('#modelGate',gate?'Comprobación probabilística superada':'Modelo experimental');
  const summary=$('#evaluationSummary');summary.className='';
  if(!e||e.status!=='evaluated'){summary.replaceChildren(node('p',{className:'empty-compact'},['Aún no hay suficientes resultados para evaluar este modelo.']));return;}
  const m=e.test??{},b=e.benchmark?.test??{};
  summary.replaceChildren(node('div',{className:'evaluation-metrics'},[stat('Partidos de prueba',Number.isFinite(m.sampleSize)?String(m.sampleSize):'—'),stat('Error de probabilidad · Brier',num(m.brier,3)),stat('Error logarítmico',num(m.logLoss,3)),stat('Referencia sencilla · Brier',num(b.brier,3))]),
    node('p',{className:'helper'},[`Entrenamiento: ${e.chronology?.trainingCount??'—'} partidos. Validación: ${e.chronology?.validationCount??'—'}. Prueba: ${e.chronology?.testCount??'—'}. Un error menor es mejor. Evaluación reconstruida por fechas; no demuestra qué información estaba disponible en el pasado ni rentabilidad.`]),list([...array(e.modelGate?.reasons),...array(e.limitations)].slice(0,7)));
}
let championsRenderKey='';
function renderChampions(){
  const c=state?.champions??{},now=Date.now(),rows=array(c.matches).filter(m=>m.kickoffAt>now);
  const status=q=>{const p=q.quote??{},age=p.kickoffAt-now>48*3600000?900000:p.kickoffAt-now>24*3600000?300000:60000;return !connected?'Sin conexión':p.suspended??q.suspended?'Suspendida':p.validationError||!q.validTimes?'Hora sin validar':p.sourceStale||q.stale||!p.receivedAt||now<p.receivedAt||now-p.receivedAt>30000||!p.sourceConfirmedAt||now-p.sourceConfirmedAt>age?'Caducada':p.regionVerified?'Precio con contraste vigente':'España pendiente de contraste';};
  const key=JSON.stringify([c.receivedAt,c.error,c.captureId,c.modelVersion,c.stakeEur,c.opportunities,c.pending,rows.map(m=>[m.id,m.quotes.map(q=>[q.id,q.price,status(q)])])]);
  if(key===championsRenderKey)return;championsRenderKey=key;
  text('#championsCount',`${c.analysedMatches??0} analizados · ${c.opportunities??0} propuestas`);
  text('#championsDescription',c.mode==='analysis'?`Modelo propio con ${c.historyMatches??0} resultados históricos de Champions. Importe propuesto ahora: ${money(c.stakeEur??0)}, dentro del mismo límite conjunto de LaLiga. Solo 90 minutos y descuento; sin prórroga, penaltis ni ganador de eliminatoria.`:'Preparando históricos y evaluación propios de Champions. Las cuotas sin todos los controles no reciben importe.');
  text('#championsTime',c.error|| (c.receivedAt?`Última lectura: ${time(c.receivedAt)}. El seguimiento y «Renovar precios» renuevan los precios. La confirmación de cada mercado y el contraste español se comprueban por selección; no hay garantía de tiempo real.`:'Sin consulta actual. Inicia el seguimiento para recibir cuotas.'));
  $('#championsChecklist').replaceChildren(...[['Partidos y cuotas con captura de origen',Boolean(c.captureId)],['Históricos y modelo propios de Champions',c.trainingMatches>0],['Evaluación cronológica por selección y mercado',c.evaluation?.status==='evaluated'],['Contrastes de Bet365 España disponibles; las demás selecciones permanecen sin importe',!array(c.pending).includes('Contraste de cuotas con Bet365 España')]].map(([label,ok])=>node('li',{},[`${ok?'☑':'☐'} ${label}`])));
  const e=c.evaluation;$('#championsEvaluation').replaceChildren(...(e?.test?[node('p',{},[`${e.chronology?.trainingCount??0} partidos de entrenamiento, ${e.chronology?.validationCount??0} de validación y ${e.test.sampleSize} de prueba final. Brier ${num(e.test.brier,3)} frente a ${num(e.benchmark?.test?.brier,3)} de referencia; menor es mejor. La evaluación no demuestra rentabilidad.`]),list(Object.entries(e.marketGates??{}).filter(([k])=>['1x2','double_chance','dnb'].includes(k)).map(([k,g])=>`${({'1x2':'Resultado final',double_chance:'Doble oportunidad',dnb:'Sin empate'})[k]}: ${array(g.selections).filter(s=>s.passed).length} de ${array(g.selections).length} selecciones superan los controles.`))]:[node('p',{},['Evaluación pendiente; sin propuestas con dinero.'])]));
  const opened=new Set([...$('#championsList').querySelectorAll('details[open]')].map(d=>d.dataset.eventId));
  $('#championsList').replaceChildren(...(rows.length?rows.map(m=>node('article',{className:'card fixture-card'},[
    node('div',{className:'fixture-name'},[`${m.home} — ${m.away}`]),node('div',{className:'event-time'},[time(m.kickoffAt)]),
    ...(m.prediction?[node('div',{className:'probabilities'},[['Local',m.prediction.probabilities.home],['Empate',m.prediction.probabilities.draw],['Visitante',m.prediction.probabilities.away]].map(([label,p])=>node('div',{className:'probability'},[node('span',{},[label]),node('strong',{},[pct(p)])])))]:[]),
    node('p',{className:'helper'},[`${m.quotes.length} selecciones recibidas · ${m.prediction?.ready?'Pronóstico experimental calculado':'Historial insuficiente o modelo pendiente'}. Consulta los importes vigentes en Apuestas recomendadas.`]),
    node('details',{className:'champions-markets','data-event-id':m.id,...(opened.has(m.id)?{open:''}:{})},[node('summary',{},['Ver mercados y precios recibidos']),...m.quotes.map(q=>node('div',{className:'champions-price'},[
      node('strong',{},[`${q.market} · ${q.label}`]),node('span',{},[`Cuota ${num(q.price)} · ${status(q)}`]),node('small',{},[`Confirmación del mercado: ${time(q.confirmedAt)}`])
    ]))])
  ])):[node('div',{className:'empty-state span-all'},[node('h3',{},['Sin partidos de Champions recibidos']),node('p',{},['Puede que el proveedor no los esté publicando ahora o que el seguimiento esté detenido.'])]) ]));
}
function renderNews(){
  const news=array(report().news),analysis=report().newsAnalysis??{},status={available:array(analysis.facts).length?'Qwen ha extraído información con evidencia textual.':'Qwen ha revisado el material recibido sin encontrar hechos de bajas verificables.',empty:'No se han encontrado hechos verificables en el material recibido.',unavailable:'Qwen no está disponible; se muestran las fuentes recibidas sin atribuirle un análisis.',invalid:'La respuesta de Qwen no superó la comprobación de evidencia.'}[analysis.status]??'Análisis de noticias pendiente.';
  text('#newsStatus',`${status} ${news.length} noticias recibidas.${news.length>18?' Se muestran las 18 más recientes.':''} La ausencia de información no confirma ausencia de lesiones o bajas. ${array(analysis.warnings).slice(0,3).map(toString).join(' ')}`);
  const kinds={injury:'Lesión',doubt:'Duda',suspension:'Sanción',rotation:'Rotación',minutes:'Minutos',lineup:'Alineación',other:'Contexto'};
  const labels={reported:'Información periodística',rumour:'Rumor',official:'Confirmación indicada por la fuente'};
  $('#factsList').replaceChildren(...array(analysis.facts).map(f=>{
    const n=news.find(n=>n.id===f.newsId);return node('article',{className:'fact-card'},[node('strong',{},[`${kinds[f.kind]??'Contexto'} · ${f.team??''}${f.player?` · ${f.player}`:''}`]),node('span',{},[labels[f.status]??'Sin clasificar']),node('blockquote',{},[f.evidence??'']),n?safeLink(n.url,'Consultar la fuente'):null]);
  }));
  $('#newsList').replaceChildren(...news.slice().sort((a,b)=>(b.publishedAt??0)-(a.publishedAt??0)).slice(0,18).map(n=>node('article',{className:'news-card'},[
    node('div',{className:'news-source'},[n.source??'Fuente deportiva']),node('h3',{},[n.title??'Titular no disponible']),n.text?node('p',{},[String(n.text).slice(0,360)]):null,
    node('div',{className:'news-meta'},[`${time(n.publishedAt)} · ${n.scope==='full'?'Texto completo':n.scope==='excerpt'?'Extracto disponible':'Solo metadatos'}`]),safeLink(n.url,'Leer en la fuente ↗','news-link')
  ])));
}
function renderLedger(){
  const ledger=state?.ledger??{},manual=account();
  text('#confirmedTime',manual.confirmedAt?`Saldo conciliado por ti el ${time(manual.confirmedAt)}.`:'El presupuesto inicial de 100 € todavía no es un saldo confirmado.');
  const minimum=state?.preferences?.minStakeEur;
  text('#minimumNote',typeof minimum==='number'?`Mínimo de tu cuenta confirmado: ${money(minimum)}. El bot descarta importes inferiores.`:'Sin un mínimo confirmado, el bot mantiene el importe propuesto en 0 €.');
  const maxFraction=state?.preferences?.maxBetFraction??.01;
  $('#minimumNote').append(` Máximo por apuesta: ${pct(maxFraction,0)} del saldo (${money((manual.bankrollEur??0)*maxFraction)} ahora). El importe calculado puede ser menor o cero.`);
  if(typeof minimum==='number'&&document.activeElement!==$('#minimumInput')&&!$('#minimumInput').value)$('#minimumInput').value=minimum;
  $('#ledgerTotals').replaceChildren(stat('Capital en seguimiento',money(manual.bankrollEur)),stat('Resultado liquidado',money(manual.netProfitEur)));
  const book=ledger[ledgerMode]??(ledgerMode==='manual'?manual:{}),bets=array(book.bets??array(ledger.bets).filter(b=>b.mode===ledgerMode));
  $('#manualTab').classList.toggle('selected',ledgerMode==='manual');$('#simulationTab').classList.toggle('selected',ledgerMode==='simulation');
  text('#ledgerCount',`${bets.length} registros · libre ${money(book.availableEur)}`);
  const tableContainer=$('#betsTable');
  if(!bets.length)tableContainer.replaceChildren(node('div',{className:'table-empty'},[ledgerMode==='manual'?'Todavía no has registrado apuestas realizadas. El informe no registra ninguna automáticamente.':'Tu libro de simulación está vacío y permanece separado del dinero real.']));
  else{
    const labels={won:'Ganada',lost:'Perdida',void:'Nula',half_won:'Media ganancia',half_lost:'Media pérdida'};
    const headers=['Partido y selección','Cuota','Importe','Estado','Resultado','Registro'];
    const table=node('table',{},[node('thead',{},[node('tr',{},headers.map(h=>node('th',{scope:'col'},[h])))]),node('tbody',{},bets.map(b=>{
      const actions=node('td',{className:'actions'});
      if(b.status==='open')actions.append(button('Liquidar',()=>openSettle(b)),button('Corregir',()=>openCorrect(b)));
      else actions.append(node('span',{className:'helper'},[`Liquidada ${time(b.settledAt)}`]));
      return node('tr',{},[node('td',{},[node('strong',{},[b.eventName]),node('div',{className:'helper'},[`${b.market} · ${b.selection}`])]),node('td',{},[num(b.price)]),node('td',{},[money(b.stakeEur)]),node('td',{},[node('span',{className:`tag ${b.status==='open'?'warning':''}`},[b.status==='open'?'Pendiente':labels[b.result]??'Liquidada'])]),node('td',{},[b.profitEur===null?'—':money(b.profitEur)]),actions]);
    }))]);tableContainer.replaceChildren(table);
  }
  const names={balance_confirmed:'Saldo disponible conciliado',bet_recorded:'Apuesta anotada',bet_corrected:'Anotación corregida',bet_settled:'Resultado registrado'};
  $('#ledgerEvents').replaceChildren(...array(ledger.events).slice().reverse().slice(0,30).map(e=>node('div',{className:'event-row'},[node('div',{},[names[e.kind]??e.kind,e.payload?.reason?` · ${e.payload.reason}`:'',e.payload?.mode==='simulation'?' · Simulación':'']),node('span',{},[time(e.createdAt)])])));
  const options=$('#fixtureOptions');options.replaceChildren(...array(report().fixtures).map(f=>node('option',{value:`${f.home} — ${f.away}`})));
}
function renderProgress(){
  const acceptance=state?.acceptance;
  text('#acceptanceDate',acceptance?`Evidencia comprobada el ${time(acceptance.checkedAt)}. El contraste regional actual y la vigencia de cada cuota se comprueban por separado.`:'Pendiente de ejecutar la aceptación con evidencia.');
  $('#acceptanceChecks').replaceChildren(...array(acceptance?.checks).map(c=>node('p',{},[`${c.passed?'✓':'−'} ${c.task}: ${c.detail}`])));
  const metrics=acceptance?.metrics;
  text('#acceptanceMetrics',metrics?`${metrics.captures} capturas · ${metrics.priceChanges} cambios · ${metrics.suspensions} suspensiones explícitas de fuente · ${metrics.withdrawals} retiradas de fuente. HTTP p95: ${num(metrics.httpP95Ms/1000)} s. ${acceptance.limitation??''}`:'');
  const p=state?.progress??{},tasks=array(p.tasks),done=Number.isFinite(p.completed)?p.completed:tasks.filter(t=>t.status==='done').length,total=Number.isFinite(p.total)?p.total:tasks.length;
  text('#progressCount',total?`${done} de ${total} comprobadas`:'Sin estado recibido');$('#progressFill').style.width=total?`${Math.min(100,Math.max(0,done/total*100))}%`:'0';
  $('#progressList').replaceChildren(...tasks.map(t=>node('article',{className:`progress-item ${['done','partial'].includes(t.status)?t.status:'pending'}`},[node('span',{className:'progress-check','aria-label':t.status==='done'?'Comprobada':t.status==='partial'?'Parcial':'Pendiente'},[t.status==='done'?'✓':t.status==='partial'?'−':'']),node('div',{},[node('div',{className:'progress-title'},[`${t.id??''}. ${t.title??''}`]),node('p',{className:'progress-detail'},[t.detail??''])])])));
  const coverage=array(report().coverage);
  if(!coverage.length)$('#coverageTable').replaceChildren(node('p',{className:'empty-compact'},['Cobertura todavía no medida.']));
  else $('#coverageTable').replaceChildren(node('table',{},[node('thead',{},[node('tr',{},['Fuente / temporada','Partidos','Con resultado','Resultados pasados ausentes','Último resultado','Observaciones'].map(h=>node('th',{scope:'col'},[h])))]),node('tbody',{},coverage.map(c=>node('tr',{},[node('td',{},[`${c.source??''} ${c.season??''}`]),node('td',{},[c.matches??'—']),node('td',{},[c.scored??'—']),node('td',{},[c.missingPastResults??'—']),node('td',{},[c.latestResult??'—']),node('td',{},[array(c.warnings).map(toString).join(' · ')||'Sin incidencias detectadas'])])))]));
  $('#marketCatalog').replaceChildren(...array(report().marketCatalog).map(m=>node('article',{className:'catalog-item'},[node('h4',{},[m.name??'Mercado']),node('span',{className:`tag${m.status==='active'?' good':''}`},[{active:'Modelo y datos disponibles',model_only:'Modelo · cuotas pendientes',pending:'Pendiente',research:'En investigación',unsupported:'Sin cobertura'}[m.status]??m.status??'Pendiente']),node('p',{},[m.reason??''])])));
  const errors=[...array(state?.errors),...array(report().errors)];$('#errorList').replaceChildren(...[...new Set(errors.map(e=>typeof e==='string'?e:e.message??String(e)))].filter(Boolean).map(e=>node('div',{className:'error-row'},[e])));
}
function render(){renderAmounts();renderMonitor();renderCandidates();renderFixtures();renderChampions();renderNews();renderLedger();renderProgress();$('#limitations').replaceChildren(...array(report().limitations).map(line=>node('li',{},[toString(line)])));}
function prefill(c){
  const form=$('#betForm');for(const [key,value] of Object.entries({eventId:c.eventId??c.fixtureId??'',eventName:c.eventName??`${c.home??''} — ${c.away??''}`,market:c.market??'',selection:c.selection??'',price:c.price??'',stakeEur:fresh(c)?c.stakeEur??'':'',recommendationId:c.id??'',mode:'manual'})){if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;}
  $('#betFormDetails').open=true;$('#betFormDetails').scrollIntoView({behavior:'smooth',block:'center'});form.elements.stakeEur.focus();
}
function openSettle(b){const f=$('#settleForm');f.reset();f.elements.betId.value=b.id;text('#settleDescription',`${b.eventName} · ${b.selection} · ${money(b.stakeEur)} · ${b.mode==='simulation'?'Simulación':'Registro real'}`);$('#settleDialog').showModal();}
function openCorrect(b){const f=$('#correctForm');f.elements.betId.value=b.id;f.elements.price.value=b.price;f.elements.stakeEur.value=b.stakeEur;f.elements.reason.value='';text('#correctDescription',`${b.eventName} · ${b.selection} · ${b.mode==='simulation'?'Simulación':'Registro real'}`);$('#correctDialog').showModal();}
$('#providerForm').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;const key=f.elements.key.value;f.reset();await action('/api/provider-key',{key},'Clave guardada.',f.querySelector('button'));});
$('#refreshButton').addEventListener('click',event=>action('/api/refresh',{},'Actualización solicitada. El panel mostrará su avance.',event.currentTarget));
$('#newsButton').addEventListener('click',event=>action('/api/news',{},'Revisión de noticias solicitada.',event.currentTarget));
$('#monitorButton').addEventListener('click',event=>action(state?.monitor?.running?'/api/stop':'/api/monitor/start',{},state?.monitor?.running?'Seguimiento detenido.':'Seguimiento iniciado.',event.currentTarget));
$('#backupButton').addEventListener('click',event=>action('/api/backup',{},'Copia de seguridad creada.',event.currentTarget));
$('#acceptanceButton').addEventListener('click',event=>action('/api/acceptance/check',{},'Comprobación solicitada.',event.currentTarget));
$('#balanceForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const ok=await action('/api/balance',{balanceEur:Number(form.elements.balanceEur.value),idempotencyKey:crypto.randomUUID()},'Saldo disponible confirmado.',form.querySelector('button'));if(ok)form.reset();});
$('#preferencesForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await action('/api/preferences',{minStakeEur:Number(form.elements.minStakeEur.value)},'Mínimo de apuesta guardado.',form.querySelector('button'));});
$('#betForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form)),mode=values.mode;
  if(mode==='manual'&&!account().confirmed){notice('Confirma primero el saldo disponible que ves en Bet365.',true);$('#balanceInput').focus();return;}
  const namedFixture=array(report().fixtures).find(f=>`${f.home} — ${f.away}`===values.eventName);
  const eventId=values.eventId||(namedFixture?.eventId??namedFixture?.id)||`manual:${String(values.eventName).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim()}`;
  const body={eventId,eventName:values.eventName,market:values.market,selection:values.selection,price:Number(values.price),stakeEur:Number(values.stakeEur),mode,idempotencyKey:crypto.randomUUID()};
  if(values.recommendationId)body.recommendationId=values.recommendationId;
  const ok=await action('/api/bets',body,mode==='simulation'?'Simulación guardada en su libro separado.':'Apuesta realizada anotada. No se ha enviado ninguna apuesta.',form.querySelector('button'));
  if(ok){form.reset();$('#betFormDetails').open=false;ledgerMode=mode;renderLedger();}
});
$('#betForm').elements.eventName.addEventListener('input',()=>{$('#betForm').elements.eventId.value='';$('#betForm').elements.recommendationId.value='';});
$('#settleForm').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,body={betId:f.elements.betId.value,result:f.elements.result.value,idempotencyKey:crypto.randomUUID()};if(f.elements.payoutEur.value!=='')body.payoutEur=Number(f.elements.payoutEur.value);if(await action('/api/bets/settle',body,'Resultado guardado y saldo actualizado.',f.querySelector('button[type=submit]')))$('#settleDialog').close();});
$('#correctForm').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,body={betId:f.elements.betId.value,price:Number(f.elements.price.value),stakeEur:Number(f.elements.stakeEur.value),reason:f.elements.reason.value,idempotencyKey:crypto.randomUUID()};if(await action('/api/bets/correct',body,'Corrección guardada con su historial.',f.querySelector('button[type=submit]')))$('#correctDialog').close();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
$('#manualTab').addEventListener('click',()=>{ledgerMode='manual';renderLedger();});$('#simulationTab').addEventListener('click',()=>{ledgerMode='simulation';renderLedger();});
$('#candidateSearch').addEventListener('input',event=>{clearTimeout(searchTimer);candidateView.query=event.currentTarget.value;candidateView.limit=20;searchTimer=setTimeout(()=>{saveView();renderCandidates();},180);});
for(const [selector,field] of [['#competitionFilter','competition'],['#marketFilter','market'],['#fixtureFilter','eventId'],['#statusFilter','status']])$(selector).addEventListener('change',event=>{candidateView[field]=event.currentTarget.value;candidateView.limit=20;saveView();renderCandidates();});
$('#loadMoreButton').addEventListener('click',()=>{candidateView.limit+=20;saveView();renderCandidates();});
$('#clearFilters').addEventListener('click',()=>{candidateView={competition:'',query:'',market:'',eventId:'',status:'active',limit:20};saveView();renderCandidates();});
$('#viewObservations').addEventListener('click',()=>{candidateView.status=candidateView.status==='active'?'all':'active';saveView();renderCandidates();});
$('#refreshQuotesButton').addEventListener('click',event=>action('/api/quotes/refresh',{},null,event.currentTarget));
$('#championsRecommendations').addEventListener('click',()=>{candidateView.competition='Champions';candidateView.status='active';candidateView.market='';candidateView.eventId='';candidateView.query='';saveView();renderCandidates();location.hash='opportunities';});
const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')===`#${entry.target.id}`));},{rootMargin:'-12% 0px -70% 0px'});document.querySelectorAll('main .section').forEach(s=>observer.observe(s));
refresh();setInterval(refresh,10000);setInterval(expireOnly,1000);
