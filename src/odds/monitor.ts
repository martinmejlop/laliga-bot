import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {ROOT} from '../config.ts';
import {writeJson,readJson} from '../files.ts';
import {fetchMarketBoard,MAIN_ODDS_URL,MAIN_GROUPS} from './markets.ts';
import {allMatches,type OddsBoard} from './moviodds.ts';
import {Store,StoreError} from '../storage/store.ts';
import {registerObservedSources,MOVIODDS_SOURCE} from '../storage/import-board.ts';
import {fetchLiveFixture} from './live.ts';
import {createHash} from 'node:crypto';
import type {Quote} from './freshness.ts';

type PublicCapture={raw:string;url:string;requestedAt:number;receivedAt:number};
const quoteKey=(q:Quote)=>JSON.stringify([q.eventId,q.marketId,q.period,q.selectionId,q.line]);
const quoteMap=(board:OddsBoard|null|undefined)=>new Map(allMatches(board).flatMap(m=>m.quotes.map(q=>[quoteKey(q),q] as const)));
const stamp=(q:Quote)=>q.timestampKind==='observation'?q.sourceObservedAt:q.sourceUpdatedAt;
const mode=(q:Quote)=>q.timestampKind??'last-price-change';

export class MarketMonitor extends EventEmitter {
  board:OddsBoard|null=null;
  captureId:string|null=null;
  running=false; busy=false; lastSuccessAt:number|null=null; lastAttemptAt:number|null=null; nextPollAt:number|null=null;
  error:string|null='Pendiente de consulta actual.'; changes:any[]=[];
  invalidQuoteCount=0;
  lastFailedCaptureId:string|null=null;
  #timer:ReturnType<typeof setTimeout>|null=null; #retryAt=0; #failures=0; #viewerAt=0; #generation=0;
  #usagePath:string; #boardPath:string; #dbPath:string; #changesPath:string; #request:typeof fetch;
  #lastAccepted:OddsBoard|null=null;
  #enableLive=false; #catalogueWhileActive=false; #catalogAt=0; #cursor=0; #focus='';
  #scopesPath:string; #requestsPath:string; #retryPath:string; #scopeBoards:Record<string,OddsBoard>={}; #requests:any[]=[];
  constructor(options:{directory?:string;request?:typeof fetch;enableLive?:boolean;catalogueWhileActive?:boolean}={}) {
    super(); const directory=options.directory??join(ROOT,'data');
    this.#usagePath=join(directory,'odds-usage.json');this.#boardPath=join(directory,'latest-odds.json');this.#dbPath=join(directory,'laliga.sqlite');this.#changesPath=join(directory,'price-changes.json');this.#request=options.request??fetch;
    this.#lastAccepted=readJson<OddsBoard|null>(this.#boardPath,null);
    this.#enableLive=options.enableLive===true;
    this.#catalogueWhileActive=options.catalogueWhileActive===true;
    this.#scopesPath=join(directory,'odds-scopes.json');this.#requestsPath=join(directory,'odds-requests.json');
    this.#retryPath=join(directory,'odds-retry.json');
    this.#scopeBoards=readJson(this.#scopesPath,{});this.#requests=readJson<any[]>(this.#requestsPath,[]).slice(0,2000);
    this.lastFailedCaptureId=this.#requests.find(entry=>entry.ok===false&&typeof entry.captureId==='string')?.captureId??null;
    const retryState=readJson(this.#retryPath,{retryAt:0,failures:0});
    if(Number.isSafeInteger(retryState.retryAt)&&retryState.retryAt>0)this.#retryAt=retryState.retryAt;
    if(Number.isSafeInteger(retryState.failures)&&retryState.failures>0)this.#failures=retryState.failures;
    this.changes=readJson<any[]>(this.#changesPath,[]).slice(0,100);
    // La caché sirve para comparar cambios, nunca como una nueva consulta al arrancar.
    this.board=null;
  }
  viewed(focus='') {this.#focus=allMatches(this.board).some(m=>m.id===focus)?focus:'';const now=Date.now(),wasActive=now-this.#viewerAt<30000;this.#viewerAt=now;if(!wasActive&&this.running&&!this.busy&&now-(this.lastAttemptAt??0)>30000)this.#schedule(Math.max(1000,this.#retryAt-now));}
  usage(now=Date.now()) {
    const month=new Date(now).toISOString().slice(0,7);
    try {
      const value=readJson(this.#usagePath,{month,used:0});
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)||!Number.isSafeInteger(value.used)||value.used<0)return {month,used:4800,corrupt:true};
      return value.month===month?value:{month,used:0};
    } catch {return {month,used:4800,corrupt:true};}
  }
  state() {return {running:this.running,busy:this.busy,lastSuccessAt:this.lastSuccessAt,lastAttemptAt:this.lastAttemptAt,nextPollAt:this.nextPollAt,error:this.error,changes:this.changes.slice(0,30),requestsUsed:this.usage().used,monthlyLimit:4800,
    cadence:'Consulta automática adaptada al plan gratuito; sin garantía de tiempo real. Los precios caducados se retiran.',invalidQuoteCount:this.invalidQuoteCount,quoteCount:allMatches(this.board).reduce((n,m)=>n+m.quotes.length,0),
    lastFailedCaptureId:this.lastFailedCaptureId,retryAt:this.#retryAt||null,recentRequests:this.#requests.slice(0,10)};}
  start() {if(this.running)return;this.running=true;this.#generation++;void this.poll();}
  credentialsChanged(){this.#retryAt=0;this.#failures=0;writeJson(this.#retryPath,{retryAt:0,failures:0});if(this.running&&!this.busy)void this.poll();}
  stop() {this.running=false;this.#generation++;this.board=null;if(this.#timer)clearTimeout(this.#timer);this.#timer=null;this.nextPollAt=null;this.error='Vigilancia detenida; no hay oportunidades activas.';this.emit('update');}
  async poll(options:{eventId?:string}={}) {
    if(this.busy)return; const now=Date.now();
    const usage=this.usage(now);
    if(usage.used>=4800){this.error=(usage as any).corrupt?'No se puede verificar el contador de consultas. Vigilancia bloqueada para proteger el límite gratuito.':'Límite mensual gratuito alcanzado. Sin recomendaciones activas.';this.board=null;this.emit('update');this.#schedule(3600000);return;}
    if(now<this.#retryAt){this.error='Esperando el plazo de reintento del proveedor; sin precios activos.';this.#schedule(this.#retryAt-now);return;}
    this.busy=true;this.lastAttemptAt=now;const generation=this.#generation;
    let scope=`catalogue:${MAIN_GROUPS.join(',')}`,publicCapture:PublicCapture|null=null;
    // Reservar antes de la red: también cuentan los fallos y los reinicios no reinician el contador.
    try {
      writeJson(this.#usagePath,{...usage,used:usage.used+1});
      const active=now-this.#viewerAt<30000;
      const available=allMatches(this.board).filter(m=>m.kickoffAt>now);
      const requested=options.eventId?available.find(m=>m.id===options.eventId):null;
      if(options.eventId&&!requested)throw new Error('El partido ya no está en el catálogo previo actual.');
      const target=requested??(this.#enableLive && !(active&&this.#catalogueWhileActive) && available.length && now-this.#catalogAt<(active?600000:3600000)
        ? available.find(m=>m.id===this.#focus)??available[this.#cursor++%available.length]:null);
      scope=target?`fixture:${target.id}:${MAIN_GROUPS.join(',')}`:`catalogue:${MAIN_ODDS_URL}`;
      const fetched=target?await fetchLiveFixture(target,this.#request):await fetchMarketBoard(this.#request);
      const {board,capture}=fetched;
      publicCapture=capture;
      if(generation!==this.#generation)return;
      const scopedPrevious=this.#scopeBoards[scope];
      if(scopedPrevious && (board.receivedAt<scopedPrevious.receivedAt || board.serverTime<scopedPrevious.serverTime))throw new Error('Respuesta fuera de orden: se han retirado los precios.');
      const previous=quoteMap(this.#lastAccepted),comparablePrevious=quoteMap(scopedPrevious);
      const rawFixtures=new Map<string,any>(target?[]:[...(JSON.parse(capture.raw).matches??[]),...('championsCapture' in fetched?JSON.parse(fetched.championsCapture.raw).matches??[]:[])].map((match:any)=>[match.id,match]));
      const changes:any[]=[]; const seen=new Set<string>();
      for(const match of allMatches(board)) for(const quote of match.quotes){
        const id=quoteKey(quote);seen.add(id);const old=previous.get(id),sameScopeOld=comparablePrevious.get(id);
        const sourceStamp=stamp(quote);
        if(typeof sourceStamp!=='number'||!Number.isFinite(sourceStamp)||sourceStamp<=0||typeof quote.sourceConfirmedAt!=='number'||!Number.isFinite(quote.sourceConfirmedAt)||quote.sourceConfirmedAt<=0||sourceStamp>quote.sourceConfirmedAt||quote.sourceConfirmedAt>quote.receivedAt)quote.validationError='Marcas de observación o confirmación de mercado no verificadas.';
        if(quote.validationError)continue;
        // Regresiones dentro de un mismo endpoint sí invalidan. Entre catálogo y
        // /quotes puede cambiar el alcance o llegar una caché anterior legítima.
        if(sameScopeOld&&!sameScopeOld.validationError&&((quote.sourceConfirmedAt??0)<(sameScopeOld.sourceConfirmedAt??0)||mode(quote)===mode(sameScopeOld)&&((stamp(quote)??0)<(stamp(sameScopeOld)??0)||quote.price!==sameScopeOld.price&&(stamp(quote)??0)<=(stamp(sameScopeOld)??0))))throw new Error('Precio o confirmación incoherentes con el historial; se invalidan las oportunidades.');
        if(old&&(quote.sourceConfirmedAt??0)<(old.sourceConfirmedAt??0))continue;
        if(quote.suspended && old && !old.validationError && !old.suspended)changes.push({kind:'suspended',scope,eventId:quote.eventId,selectionId:quote.selectionId,marketId:quote.marketId,line:quote.line,at:board.receivedAt,reason:'explicit-provider-flag'});
        else if(old && !old.validationError && old.price!==quote.price)changes.push({kind:'price-changed',scope,eventId:quote.eventId,selectionId:quote.selectionId,marketId:quote.marketId,line:quote.line,previousPrice:old.price,price:quote.price,at:board.receivedAt});
      }
      for(const [id,old] of comparablePrevious) if(!seen.has(id)){
        const raw=rawFixtures.get(old.eventId),kickoff=typeof raw?.kickoff_utc==='string'?Date.parse(raw.kickoff_utc):NaN;
        const reason=raw&&(raw.in_play===true||Number.isFinite(kickoff)&&kickoff<=board.receivedAt)?'not-prematch':raw&&raw.in_play!==false?'phase-unverified':'missing-from-same-endpoint-response';
        changes.push({kind:'withdrawn',scope,eventId:old.eventId,selectionId:old.selectionId,marketId:old.marketId,line:old.line,at:board.receivedAt,reason});
      }
      const store=new Store(this.#dbPath);
      let invalid=0;
      try { store.atomic(()=>{
        registerObservedSources(store);
        // El sobre admite hasta 5 s de desfase del reloj remoto. No se convierte
        // esa hora futura en un as-of válido ni se modifican las horas de cuotas.
        const captureId=store.capture({sourceId:MOVIODDS_SOURCE,ingestionKey:`${target?'live:'+target.id:'markets'}:${board.receivedAt}`,url:target?capture.url:MAIN_ODDS_URL,format:target?(target.competition==='Champions'?'moviodds-champions-live-v1':'moviodds-live-fixture-v1'):'moviodds-laliga-extract-v1',rawText:capture.raw,requestedAt:board.requestedAt,receivedAt:board.receivedAt,sourceAsOf:board.serverTime<=board.receivedAt?board.serverTime:null});
        if('championsCapture' in fetched&&board.champions){const extra=fetched.championsCapture;
          board.champions.captureId=store.capture({sourceId:MOVIODDS_SOURCE,ingestionKey:`champions:${board.receivedAt}`,url:extra.url,format:'moviodds-champions-extract-v1',rawText:extra.raw,requestedAt:extra.requestedAt,receivedAt:extra.receivedAt,sourceAsOf:board.serverTime<=board.receivedAt?board.serverTime:null});
        }
        if(target?.competition==='Champions'&&board.champions)board.champions.captureId=captureId;
        for(const match of allMatches(board))for(const quote of match.quotes)quote.captureId=quote.competition==='Champions'?board.champions?.captureId:captureId;
        if(board.serverTime>board.receivedAt)store.issue(new StoreError('INVALID_TIME','Reloj del sobre adelantado: sourceAsOf desconocido; horas originales conservadas.',{captureId,serverTime:board.serverTime,receivedAt:board.receivedAt}));
        for(const match of board.matches){
          const date=new Date(match.kickoffAt);const y=date.getUTCFullYear()-(date.getUTCMonth()<6?1:0);const season=`${y}-${String((y+1)%100).padStart(2,'0')}`;
          const fixtureId=store.ensureFixture(MOVIODDS_SOURCE,match.id,season,store.resolveTeam(MOVIODDS_SOURCE,match.home),store.resolveTeam(MOVIODDS_SOURCE,match.away));
          store.observeFixture({captureId,fixtureId,kickoffAt:match.kickoffAt,status:'scheduled',details:{suppliedBy:MOVIODDS_SOURCE,officialKickoffVerified:false}});
          for(const quote of match.quotes){
            if(quote.validationError){invalid++;store.issue(new StoreError('INVALID_TIME',quote.validationError,{eventId:quote.eventId,selectionId:quote.selectionId,marketId:quote.marketId,captureId}));continue;}
            try {store.observeQuote(captureId,fixtureId,quote);}
            catch(error){
              if(!(error instanceof StoreError)||error.code!=='INVALID_TIME')throw error;
              // La evidencia original permanece en la captura. Se aísla solo el precio incoherente.
              quote.validationError=error.message;invalid++;
              store.issue(new StoreError('INVALID_TIME',error.message,{eventId:quote.eventId,selectionId:quote.selectionId,marketId:quote.marketId,sourceUpdatedAt:quote.sourceUpdatedAt,sourceConfirmedAt:quote.sourceConfirmedAt,captureId}));
            }
          }
        }
        this.captureId=captureId;
      }); } finally {store.close();}
      invalid+=board.champions?.matches.flatMap(m=>m.quotes).filter(q=>q.quote.validationError).length??0;
      const sourceAges=allMatches(board).flatMap(m=>m.quotes.filter(q=>!q.validationError&&q.sourceConfirmedAt!==null&&q.sourceConfirmedAt<=capture.receivedAt).map(q=>capture.receivedAt-q.sourceConfirmedAt!)).sort((a,b)=>a-b);
      this.#scopeBoards[scope]=structuredClone(board);
      if(target){board.matches=[...(this.board?.matches.filter(m=>m.id!==target.id)??[]),...board.matches];if(target.competition==='Champions'&&board.champions)board.champions.matches=[...(this.board?.champions?.matches.filter(m=>m.id!==target.id)??[]),...board.champions.matches];else board.champions=this.board?.champions;}
      else this.#catalogAt=now;
      for(const match of board.matches)match.quotes=match.quotes.map(q=>{const old=previous.get(quoteKey(q));return old&&!q.validationError&&!old.validationError&&(old.sourceConfirmedAt??0)>(q.sourceConfirmedAt??0)?old:q;});
      for(const match of board.champions?.matches??[])for(const wrapper of match.quotes){const q=wrapper.quote,old=previous.get(quoteKey(q));if(old&&!q.validationError&&!old.validationError&&(old.sourceConfirmedAt??0)>(q.sourceConfirmedAt??0))wrapper.quote=old;}
      this.board=board;this.#lastAccepted=board;this.lastSuccessAt=Date.now();this.error=null;this.#failures=0;this.#retryAt=0;
      writeJson(this.#retryPath,{retryAt:0,failures:0});
      this.invalidQuoteCount=invalid;
      this.changes=[...changes,...this.changes].slice(0,100);
      // Cache por endpoint solo para comparación. Nunca se publica al arrancar.
      this.#scopeBoards=Object.fromEntries(Object.entries(this.#scopeBoards).filter(([key,value])=>key.startsWith('catalogue:')||allMatches(value).some(m=>m.kickoffAt>Date.now())));
      writeJson(this.#scopesPath,this.#scopeBoards);writeJson(this.#boardPath,board);writeJson(this.#changesPath,this.changes);
      this.#recordRequest({ok:true,scope,captureId:this.captureId,url:capture.url,requestedAt:capture.requestedAt,receivedAt:capture.receivedAt,durationMs:capture.receivedAt-capture.requestedAt,
        source:JSON.parse(capture.raw).source??'catalogue',quoteCount:seen.size,invalidQuoteCount:invalid,
        sourceConfirmationAgeMs:sourceAges.length?{min:sourceAges[0],median:sourceAges[Math.floor(sourceAges.length/2)],max:sourceAges.at(-1)}:null});
    } catch(error) {
      this.error=error instanceof Error&&/HTTP 401/.test(error.message)?'El proveedor exige una clave gratuita de MoviOdds. Configúrala en Avance y cobertura.':error instanceof Error?error.message:'Fallo del proveedor.';this.board=null;this.#catalogAt=0;this.#failures++;
      const retry=(error as any)?.retryAfterMs;
      this.#retryAt=Date.now()+Math.max(Number.isFinite(retry)?retry:0,Math.min(1800000,60000*2**Math.min(this.#failures,5)));
      writeJson(this.#retryPath,{retryAt:this.#retryAt,failures:this.#failures});
      const rejected=(error as any)?.capture??publicCapture;
      let archiveError:string|null=null;
      if(rejected){try{this.lastFailedCaptureId=this.#archiveRejected(rejected,scope);}catch{archiveError='No se pudo archivar el rechazo.';}}
      this.#recordRequest({ok:false,scope,captureId:rejected?this.lastFailedCaptureId:null,url:rejected?.url??null,requestedAt:rejected?.requestedAt??now,receivedAt:rejected?.receivedAt??Date.now(),durationMs:(rejected?.receivedAt??Date.now())-(rejected?.requestedAt??now),error:this.error,retryAt:this.#retryAt,archiveError});
    } finally {this.busy=false;this.emit('update');if(generation!==this.#generation&&this.running)this.#schedule(1000);}
    const near=allMatches(this.board).some(m=>m.kickoffAt>Date.now() && m.kickoffAt-Date.now()<6*3600000);
    const active=Date.now()-this.#viewerAt<30000;
    this.#schedule(Math.max(this.#retryAt-Date.now(),active?20000:near?120000:3600000));
  }
  #recordRequest(entry:any){this.#requests=[entry,...this.#requests].slice(0,2000);writeJson(this.#requestsPath,this.#requests);}
  #archiveRejected(capture:PublicCapture,scope:string):string {
    const store=new Store(this.#dbPath);
    try{registerObservedSources(store);return store.capture({sourceId:MOVIODDS_SOURCE,ingestionKey:`rejected:${scope}:${capture.receivedAt}:${createHash('sha256').update(capture.raw).digest('hex')}`,url:capture.url,format:'moviodds-rejected-response-v1',rawText:capture.raw,requestedAt:capture.requestedAt,receivedAt:capture.receivedAt,sourceAsOf:null});}
    finally{store.close();}
  }
  #schedule(delay:number){if(!this.running)return;if(this.#timer)clearTimeout(this.#timer);this.nextPollAt=Date.now()+Math.max(delay,1000);this.#timer=setTimeout(()=>{void this.poll();},Math.max(delay,1000));this.#timer.unref();}
}
