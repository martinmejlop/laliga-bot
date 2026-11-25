import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT} from './config.ts';
import {readJson,writeJson} from './files.ts';
import {loadData,refreshData} from './data/service.ts';
import {loadChampionsData,refreshChampionsData} from './data/champions-service.ts';
import type {DataSnapshot} from './domain.ts';
import {fitModel,evaluateModel,type Model,type Evaluation} from './model/service.ts';
import {buildReport,renderReport} from './report.ts';
import {Ledger} from './ledger/service.ts';
import {MarketMonitor} from './odds/monitor.ts';
import {allMatches} from './odds/moviodds.ts';
import {championsState} from './odds/champions.ts';
import {authenticatedOddsRequest,providerKey,saveProviderKey} from './odds/auth.ts';
import {loadAcceptance} from './odds/acceptance-state.ts';
import {recommendationReadiness} from './operation.ts';
import {Store} from './storage/store.ts';
import {backupRuntime} from './runtime-backup.ts';

export interface RuntimeOptions {
  championsLoad?:()=>DataSnapshot|null;championsRefresh?:()=>Promise<DataSnapshot|null>;
  directory?:string; reportsDirectory?:string; request?:typeof fetch;
  load?:()=>DataSnapshot|null; refresh?:(options:any)=>Promise<DataSnapshot>; artifacts?:boolean;
}
export class Runtime {
  directory:string; reportsDirectory:string; ledger:Ledger; monitor:MarketMonitor; csrfToken=randomUUID();
  snapshot:DataSnapshot|null=null; model:Model|null=null; evaluation:Evaluation|null=null;
  championsSnapshot:DataSnapshot|null=null;championsModel:Model|null=null;championsEvaluation:Evaluation|null=null;
  #championsHash='';#loadChampions:()=>DataSnapshot|null;#refreshChampions:()=>Promise<DataSnapshot|null>;
  preferences:{minStakeEur:number|null;maxBetFraction?:number}; job={running:false,status:'idle',message:'Preparado.'};
  errors:string[]=[]; decisions:any[]=[]; generatedAt=Date.now();
  #load:()=>DataSnapshot|null; #refresh:(options:any)=>Promise<DataSnapshot>; #artifacts:boolean;
  #modelDataHash='';
  #acceptanceAttemptAt=0;
  #dayTimer:ReturnType<typeof setInterval>|null=null; #closed=false;
  constructor(options:RuntimeOptions={}) {
    this.directory=options.directory??join(ROOT,'data');this.reportsDirectory=options.reportsDirectory??join(ROOT,'reports');
    mkdirSync(this.directory,{recursive:true});mkdirSync(this.reportsDirectory,{recursive:true});
    this.#load=options.load??loadData;this.#refresh=options.refresh??refreshData;this.#artifacts=options.artifacts!==false;
    const championsEnabled=resolve(this.directory)===resolve(join(ROOT,'data'))||Boolean(options.championsLoad||options.championsRefresh);
    this.#loadChampions=options.championsLoad??(()=>championsEnabled?loadChampionsData(this.directory):null);
    this.#refreshChampions=options.championsRefresh??(()=>championsEnabled?refreshChampionsData(this.directory,options.request??fetch):Promise.resolve(null));
    this.ledger=new Ledger(join(this.directory,'ledger.sqlite'));
    this.preferences=readJson(join(this.directory,'preferences.json'),{minStakeEur:null});
    this.decisions=readJson(join(this.directory,'decisions.json'),[]);
    this.monitor=new MarketMonitor({directory:this.directory,request:authenticatedOddsRequest(this.directory,options.request??fetch),enableLive:true,catalogueWhileActive:true});
    this.monitor.on('update',()=>{if(!this.#closed)this.saveReport();});
    this.rebuild();
  }
  rebuild() {
    this.#rebuildChampions();
    this.snapshot=this.#load();
    if(!this.snapshot){this.model=null;this.evaluation=null;this.saveReport();return;}
    const hash=createHash('sha256').update(JSON.stringify(this.snapshot.matches.map(m=>[m.id,m.status,m.date,m.homeGoals,m.awayGoals,m.availableAt]))).digest('hex');
    const cached=readJson<any>(join(this.directory,'evaluation.json'),null);
    this.evaluation=cached?.dataHash===hash?cached.evaluation:evaluateModel(this.snapshot.matches);
    if(cached?.dataHash!==hash)writeJson(join(this.directory,'evaluation.json'),{dataHash:hash,evaluation:this.evaluation});
    if(!this.model||this.#modelDataHash!==hash||Date.now()-this.model.cutoff>6*3600000){
      this.model=fitModel(this.snapshot.matches,Date.now(),{...this.evaluation?.selectedOptions,availability:'observed'});
      this.#modelDataHash=hash;writeJson(join(this.directory,'model-state.json'),this.model);
    }
    if(this.#artifacts && this.model.trainingCaptureIds.length){
      const store=new Store(join(this.directory,'laliga.sqlite'));
      try {
        store.artifact({kind:'model',key:this.model.version,data:{...this.model,evaluation:this.evaluation},captureIds:this.model.trainingCaptureIds});
      } finally {store.close();}
    }
    this.saveReport();
  }
  #rebuildChampions(){
    this.championsSnapshot=this.#loadChampions();
    if(!this.championsSnapshot){this.championsModel=null;this.championsEvaluation=null;return;}
    const hash=createHash('sha256').update(JSON.stringify(this.championsSnapshot.matches.map(m=>[m.id,m.competition,m.neutral,m.date,m.status,m.homeGoals,m.awayGoals,m.availableAt]))).digest('hex');
    const cached=readJson<any>(join(this.directory,'champions-evaluation.json'),null);
    this.championsEvaluation=cached?.dataHash===hash?cached.evaluation:evaluateModel(this.championsSnapshot.matches);
    if(cached?.dataHash!==hash)writeJson(join(this.directory,'champions-evaluation.json'),{dataHash:hash,evaluation:this.championsEvaluation});
    if(!this.championsModel||this.#championsHash!==hash||Date.now()-this.championsModel.cutoff>6*3600000){this.championsModel=fitModel(this.championsSnapshot.matches,Date.now(),{...this.championsEvaluation?.selectedOptions,availability:'observed'});this.#championsHash=hash;writeJson(join(this.directory,'champions-model-state.json'),this.championsModel);}
    if(this.#artifacts&&this.championsModel.trainingCaptureIds.length){const store=new Store(join(this.directory,'laliga.sqlite'));try{store.artifact({kind:'model',key:this.championsModel.version,data:{competition:'Champions',...this.championsModel,evaluation:this.championsEvaluation},captureIds:this.championsModel.trainingCaptureIds});}finally{store.close();}}
  }
  start(options:{monitor?:boolean;refresh?:boolean}={}) {
    if(options.monitor!==false)this.monitor.start();
    // El ciclo pertenece al bot local: no hay entrega a horas fijas ni mensajes externos.
    this.#dayTimer=setInterval(()=>{if(!this.job.running && (!this.snapshot||Date.now()-this.snapshot.updatedAt>30*60000))this.startRefresh(true);},5*60000);
    this.#dayTimer.unref();
    if(options.refresh!==false && (!this.snapshot||Date.now()-this.snapshot.updatedAt>30*60000))this.startRefresh(true);
    if(resolve(this.directory)===resolve(join(ROOT,'data'))){const timer=setInterval(()=>{if(!this.#closed&&!this.job.running&&Date.now()-this.#acceptanceAttemptAt>30*60000)this.startAcceptanceCheck(false);},5*60000);timer.unref();this.#acceptanceTimer=timer;}
  }
  #acceptanceTimer:ReturnType<typeof setInterval>|null=null;
  startAcceptanceCheck(withTests=true) {
    if(this.job.running)return {message:'Ya hay una comprobación en curso.'};
    if(resolve(this.directory)!==resolve(join(ROOT,'data')))throw new Error('La comprobación de evidencia está disponible en el panel de uso diario.');
    this.#acceptanceAttemptAt=Date.now();this.job={running:true,status:'acceptance',message:'Comprobando fuentes y vigilancia con la evidencia archivada…'};
    execFile(process.execPath,[join(ROOT,'scripts/check-acceptance.ts'),...(withTests?['--test']:[])],{cwd:ROOT,windowsHide:true,timeout:120000,maxBuffer:1000000},error=>{
      if(this.#closed)return;
      this.job={running:false,status:error?'error':'idle',message:error?'La comprobación no terminó; se conservan los controles anteriores y sus fechas.':'Evidencia revisada. Consulta los criterios pendientes en Avance y cobertura.'};
      if(error)this.errors.push('No se pudo completar la revisión de aceptación.');
      this.saveReport();
    });
    return {message:this.job.message};
  }
  report(now=Date.now()) {
    const acceptance=loadAcceptance(this.directory,now);
    const operationalReady=recommendationReadiness(acceptance).ready;
    const sharedReady=['controlled-faults','free-budget'].every(id=>acceptance?.checks?.find((c:any)=>c.id===id)?.passed===true);
    return buildReport({snapshot:this.snapshot,model:this.model,evaluation:this.evaluation,champions:{snapshot:this.championsSnapshot,model:this.championsModel,evaluation:this.championsEvaluation,operationalReady:sharedReady},board:this.monitor.board,ledger:this.ledger.snapshot(),monitor:this.monitor.state(),preferences:this.preferences,decisions:this.decisions,operationalReady,generatedAt:this.generatedAt,now});
  }
  state(focus='') {
    const report=this.report();
    const preferred=focus||report.candidates.find(c=>c.modelValidated&&c.expectedValue>=.03&&c.quote.regionVerified)?.eventId||'';
    this.monitor.viewed(preferred);
    const progress=readJson<any>(join(ROOT,'config/progress.json'),{completed:2,total:18,tasks:[]});
    const acceptance=loadAcceptance(this.directory);
    return {generatedAt:Date.now(),running:!this.#closed,job:this.job,operation:recommendationReadiness(acceptance),report,bet365Comparisons:readJson(join(this.directory,'bet365-comparisons.json'),[]),champions:championsState(this.monitor.board?.champions,Date.now(),{snapshot:this.championsSnapshot,model:this.championsModel,evaluation:this.championsEvaluation,report}),ledger:this.ledger.snapshot(),progress,acceptance,monitor:this.monitor.state(),providerConfigured:Boolean(providerKey(this.directory)),preferences:this.preferences,csrfToken:this.csrfToken,decisions:this.decisions,errors:this.errors.slice(-20)};
  }
  saveReport() {
    this.generatedAt=Date.now();
    try {
      const report=this.report();
      writeJson(join(this.reportsDirectory,'latest.json'),report);
      writeFileSync(join(this.reportsDirectory,'latest.html'),renderReport(report),'utf8');
      const file=`${new Date(this.generatedAt).toISOString().replaceAll(':','-')}-${report.id}`;
      writeFileSync(join(this.reportsDirectory,`${file}.html`),renderReport(report),'utf8');
      const captureIds=[...new Set([...(this.model?.trainingCaptureIds??[]),...(this.championsModel?.trainingCaptureIds??[]),...(this.snapshot?.news.map(n=>n.captureId)??[]),...(this.championsSnapshot?.news.map(n=>n.captureId)??[]),...report.candidates.map(c=>c.quote.captureId).filter(Boolean),...(this.monitor.captureId?[this.monitor.captureId]:[])])];
      if(this.#artifacts && captureIds.length){
        const store=new Store(join(this.directory,'laliga.sqlite'));
        try {
          store.artifact({kind:'report',key:report.id,data:report,captureIds});
          // La distribución y las variables se conservan con el informe que las utilizó.
          for(const fixture of report.fixtures) {
            const predictionKey=`${fixture.prediction.modelVersion}:${fixture.id}:${fixture.kickoffAt}`;
            const trainingInputs=fixture.trainingCaptureIds?.length?fixture.trainingCaptureIds:captureIds;
            store.artifact({kind:'prediction',key:predictionKey,data:fixture.prediction,captureIds:trainingInputs});
            store.artifact({kind:'statistics',key:predictionKey,data:fixture.prediction.features,captureIds:trainingInputs});
          }
        } finally {store.close();}
      }
    } catch(error){this.errors.push(`No se pudo archivar el informe: ${error instanceof Error?error.message:String(error)}`);}
  }
  startRefresh(analyzeNews=false) {
    if(this.job.running)return {message:'Ya hay una actualización en curso.'};
    this.job={running:true,status:analyzeNews?'news':'refreshing',message:analyzeNews?'Revisando noticias con Qwen local…':'Actualizando históricos, calendario, noticias y cuotas…'};
    void(async()=>{
      try {
        const updated=await Promise.allSettled([this.#refresh({network:true,analyzeNews}),this.#refreshChampions()]);
        const failures=updated.filter(r=>r.status==='rejected');for(const result of failures)if(result.status==='rejected')this.errors.push(String(result.reason?.message??result.reason));
        if(this.#closed)return;
        this.job={running:true,status:'training',message:'Comprobando cobertura y evaluando el modelo…'};
        this.rebuild();
        if(this.monitor.running)await this.monitor.poll();
        this.job={running:false,status:failures.length?'error':'idle',message:failures.length?'Una fuente no pudo actualizarse; revisa el estado de cada competición.':'LaLiga y Champions actualizadas. Las propuestas comparten saldo y límites.'};
      }catch(error){this.errors.push(error instanceof Error?error.message:String(error));this.job={running:false,status:'error',message:'La actualización ha fallado; revisa el detalle de fuentes.'};}
      finally {if(!this.#closed)this.saveReport();}
    })();
    return {message:this.job.message};
  }
  decision(input:any) {
    if(typeof input.idempotencyKey!=='string'||!input.idempotencyKey||typeof input.recommendationId!=='string'||!['omitted','pending'].includes(input.status))throw new Error('Decisión inválida.');
    const previous=this.decisions.find(row=>row.idempotencyKey===input.idempotencyKey);
    if(previous){if(previous.recommendationId!==input.recommendationId||previous.status!==input.status)throw new Error('La decisión ya existe con otro contenido.');return previous;}
    const candidate=this.report().candidates.find(c=>c.id===input.recommendationId);
    if(!candidate)throw new Error('La selección ya no figura en el análisis actual.');
    const decision={id:randomUUID(),idempotencyKey:input.idempotencyKey,recommendationId:candidate.id,status:input.status,eventName:candidate.eventName,selection:candidate.selection,at:Date.now()};
    this.decisions.push(decision);writeJson(join(this.directory,'decisions.json'),this.decisions);return decision;
  }
  async mutate(path:string,input:any) {
    let result:any;
    switch(path){
      case '/api/quotes/refresh':{
        const preferred=this.report().candidates.find(c=>c.modelValidated&&c.expectedValue>=.03&&c.quote.regionVerified&&!c.quote.validationError&&!c.quote.sourceStale);
        const eventId=input.eventId??preferred?.eventId??allMatches(this.monitor.board)[0]?.id;
        if(typeof eventId!=='string'||!allMatches(this.monitor.board).some(m=>m.id===eventId))throw new Error('Espera a que el seguimiento reciba el catálogo de partidos.');
        if(!this.monitor.running)throw new Error('Inicia el seguimiento antes de comprobar una cuota.');
        if(this.monitor.busy)return {message:'Hay una consulta en curso; espera a que termine.'};
        this.monitor.viewed(eventId);await this.monitor.poll({eventId});
        return {message:this.monitor.error??'Cuotas consultadas y propuestas recalculadas. Revisa su vigencia y el importe actual.'};
      }
      case '/api/acceptance/check':return this.startAcceptanceCheck(true);
      case '/api/provider-key':saveProviderKey(this.directory,input.key);this.monitor.credentialsChanged();return {message:'Clave guardada solo en este equipo. Reintentando la consulta gratuita.'};
      case '/api/refresh':return this.startRefresh(true);
      case '/api/news':return this.startRefresh(true);
      case '/api/balance':result=this.ledger.confirmBalance(input);break;
      case '/api/bets':result=this.ledger.recordBet(input);break;
      case '/api/bets/settle':result=this.ledger.settleBet(input);break;
      case '/api/bets/correct':result=this.ledger.correctBet(input);break;
      case '/api/decisions':result=this.decision(input);break;
      case '/api/preferences':{
        if(typeof input.minStakeEur!=='number'||!Number.isFinite(input.minStakeEur)||input.minStakeEur<=0||input.minStakeEur>100||Math.abs(input.minStakeEur*100-Math.round(input.minStakeEur*100))>1e-7)throw new Error('Indica un mínimo válido, con un máximo de dos decimales.');
        this.preferences={...this.preferences,minStakeEur:input.minStakeEur};writeJson(join(this.directory,'preferences.json'),this.preferences);result={message:'Mínimo de cuenta guardado.'};break;
      }
      case '/api/stop':this.monitor.stop();return {message:'Seguimiento detenido. Las oportunidades quedan desactivadas.'};
      case '/api/monitor/start':this.monitor.start();return {message:'Seguimiento iniciado; esperando una respuesta actual.'};
      case '/api/backup':return await backupRuntime(this.directory,this.reportsDirectory);
      default:throw new Error('Operación desconocida.');
    }
    this.saveReport();return result;
  }
  close() {if(this.#closed)return;this.#closed=true;if(this.#dayTimer)clearInterval(this.#dayTimer);if(this.#acceptanceTimer)clearInterval(this.#acceptanceTimer);this.monitor.stop();this.ledger.close();}
}
