// Auditoría de evidencia recibida; solo abre la base y archivos de origen en lectura.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../src/config.ts';

type Frame={id:string;format:string;url:string;requestedAt:number;receivedAt:number;raw:any;complete:boolean};
type Item={key:string;eventId:string;marketId:string;groupId:string;period:string;selectionId:string;line:string|null;price:number;changedAt:number|null;confirmedAt:number|null;rawSuspended:boolean|null;stale:boolean;home:string;away:string;captureId:string;receivedAt:number;coherent:boolean};
const time=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const stats=(values:number[])=>{
  const valid=values.filter(Number.isFinite).sort((a,b)=>a-b);
  const quantile=(q:number)=>valid.length?valid[Math.floor((valid.length-1)*q)]:null;
  return {count:valid.length,min:valid[0]??null,p50:quantile(.5),p95:quantile(.95),max:valid.at(-1)??null};
};
function items(frame:Frame):Item[]{
  const result:Item[]=[];
  for(const match of frame.raw.matches??[]){
    for(const quote of match.quotes??[]){
      const normalized=frame.format==='normalized-moviodds-board-v1';
      const groupId=normalized?quote.marketId?.split(':')[0]:String(quote.group_id??'');
      const marketId=normalized?quote.marketId:`${groupId}:${quote.market_id??''}`;
      const eventId=String(match.id),selectionId=normalized?quote.selectionId:String(quote.sel_id??'');
      const period=normalized?quote.period:String(quote.period??'full_time_regulation');
      const line=quote.line==null?null:String(quote.line);
      const changedAt=time(normalized?quote.sourceUpdatedAt:quote.ts);
      const confirmedAt=time(normalized?quote.sourceConfirmedAt:match.group_status?.[groupId]?.polled_at);
      const price=normalized?quote.price:quote.odds_dec;
      const coherent=changedAt!==null&&confirmedAt!==null&&changedAt<=confirmedAt&&confirmedAt<=frame.receivedAt;
      result.push({key:JSON.stringify([eventId,marketId,period,selectionId,line]),eventId,marketId,groupId,period,selectionId,line,price,changedAt,confirmedAt,
        rawSuspended:normalized?null:quote.suspended===true?true:quote.suspended===false?false:null,stale:normalized?false:match.group_status?.[groupId]?.stale===true,
        home:match.home,away:match.away,captureId:frame.id,receivedAt:frame.receivedAt,coherent});
    }
  }
  return result;
}
const db=new DatabaseSync(join(ROOT,'data/laliga.sqlite'),{readOnly:true});
try{
  const rows=db.prepare('SELECT c.id,c.requested_at,c.received_at,c.source_as_of,p.source_url,p.format,p.raw_text,p.sha256 FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.source_id=? ORDER BY c.received_at').all('moviodds:com');
  const frames:Frame[]=rows.filter(row=>row.format==='moviodds-laliga-extract-v1').map(row=>({id:String(row.id),format:String(row.format),url:String(row.source_url),requestedAt:Number(row.requested_at),receivedAt:Number(row.received_at),raw:JSON.parse(String(row.raw_text)),complete:true}));
  const archived:Frame[]=[];
  const archiveRoot=join(ROOT,'data/free-odds-checks');
  if(existsSync(archiveRoot))for(const directory of readdirSync(archiveRoot))for(const filename of readdirSync(join(archiveRoot,directory)).filter(name=>/^sample-\d+\.json$/.test(name))){
    const path=join(archiveRoot,directory,filename),raw=JSON.parse(readFileSync(path,'utf8'));
    if(raw.site!=='com')continue;
    archived.push({id:`file:data/free-odds-checks/${directory}/${filename}`,format:'normalized-moviodds-board-v1',url:'https://moviodds.com/odds?sport=soccer&groups=40&site=com',requestedAt:raw.requestedAt,receivedAt:raw.receivedAt,raw,complete:false});
  }
  const all=[...archived,...frames].sort((a,b)=>a.receivedAt-b.receivedAt);
  const history=new Map<string,Item>(),changes:any[]=[],rawSuspensions:any[]=[],staleTransitions:any[]=[],disappearances:any[]=[],invalid:any[]=[];
  const confirmationAges:number[]=[],transportTimes:number[]=[],intervals:number[]=[],changeObservationDelays:number[]=[];
  let previousFull:{frame:Frame;items:Item[]}|null=null,firstFull=0,lastFull=0,totalRawQuotes=0,omittedSuspension=0;
  for(const frame of all){
    const current=items(frame);
    if(frame.complete){
      totalRawQuotes+=current.length;transportTimes.push(frame.receivedAt-frame.requestedAt);if(!firstFull)firstFull=frame.receivedAt;lastFull=frame.receivedAt;
      for(const item of current){
        if(item.rawSuspended===true)rawSuspensions.push(item);
        if(item.rawSuspended===null)omittedSuspension++;
        if(item.confirmedAt!==null)confirmationAges.push(item.receivedAt-item.confirmedAt);
        if(!item.coherent){
          const stored=db.prepare('SELECT count(*) n FROM odds_observations WHERE capture_id=? AND market_id=? AND selection_id=?').get(item.captureId,item.marketId,item.selectionId);
          invalid.push({...item,normalizedOddsRows:Number(stored?.n??0)});
        }
      }
      if(previousFull){
        intervals.push(frame.receivedAt-previousFull.frame.receivedAt);
        const prior=new Map(previousFull.items.map(item=>[item.key,item]));
        const next=new Set(current.map(item=>item.key));
        for(const old of previousFull.items)if(!next.has(old.key))disappearances.push({before:old,afterCaptureId:frame.id,afterReceivedAt:frame.receivedAt,meaning:'Ausencia en la respuesta completa del proveedor; no demuestra por sí sola cierre en Bet365.'});
        for(const item of current){const old=prior.get(item.key);if(old&&old.stale!==item.stale)staleTransitions.push({before:old,after:item,meaning:'Cambio de confirmación por mercado; no se equipara a suspensión explícita de Bet365.'});}
      }
      previousFull={frame,items:current};
    }
    for(const item of current){
      const old=history.get(item.key);
      if(old&&old.price!==item.price){
        const sourceChangeCoherent=old.coherent&&item.coherent&&old.changedAt!==null&&item.changedAt!==null&&item.changedAt>old.changedAt;
        changes.push({before:old,after:item,sourceChangeCoherent,observationGapMs:item.receivedAt-old.receivedAt,receivedAfterSourceChangeMs:item.changedAt===null?null:item.receivedAt-item.changedAt,
          bookmakerToProviderLatencyMeasured:false,explanation:'Se observan dos precios reales con fechas; el intervalo entre capturas no es latencia de propagación de Bet365.'});
        if(sourceChangeCoherent&&item.changedAt!==null)changeObservationDelays.push(item.receivedAt-item.changedAt);
      }
      history.set(item.key,item);
    }
  }
  const usage=JSON.parse(readFileSync(join(ROOT,'data/odds-usage.json'),'utf8'));
  const sameDayChanges=changes.filter(change=>!change.before.captureId.startsWith('file:')&&!change.after.captureId.startsWith('file:'));
  const distinctGroupTransitions=new Map(staleTransitions.map(change=>[JSON.stringify([change.before.captureId,change.after.captureId,change.after.eventId,change.after.groupId]),change]));
  const result={version:1,task:'T05 evidence audit',auditedAt:new Date().toISOString(),readOnlyDatabase:true,
    sample:{databaseCaptures:frames.length,archivedNormalizedCaptures:archived.length,firstReceivedAt:firstFull?new Date(firstFull).toISOString():null,lastReceivedAt:lastFull?new Date(lastFull).toISOString():null,spanMs:lastFull-firstFull,totalRawQuoteObservations:totalRawQuotes,normalizedArchivedQuotes:archived.reduce((n,f)=>n+items(f).length,0)},
    priceChanges:{count:changes.length,coherentCount:changes.filter(row=>row.sourceChangeCoherent).length,withinDatabaseDayCount:sameDayChanges.length,acrossArchivedDaysCount:changes.length-sameDayChanges.length,examples:changes.slice(0,30),allChanges:changes},
    suspensionEvidence:{explicitRawTrueObservations:rawSuspensions.length,examples:rawSuspensions.slice(0,15),fieldOmittedObservations:omittedSuspension,note:'Las cuotas del archivo normalizado o marcadas no confirmadas por grupo no sirven como prueba de suspensión explícita del operador.'},
    missingSelections:{count:disappearances.length,examples:disappearances.slice(0,20)},
    marketConfirmationTransitions:{quoteLevelCount:staleTransitions.length,distinctMarketReadTransitions:distinctGroupTransitions.size,staleToConfirmed:staleTransitions.filter(t=>t.before.stale&&!t.after.stale).length,confirmedToStale:staleTransitions.filter(t=>!t.before.stale&&t.after.stale).length,examples:staleTransitions.slice(0,20)},
    timing:{httpDurationMs:stats(transportTimes),pollGapMs:stats(intervals),marketConfirmationAgeAtReceiptMs:stats(confirmationAges),receivedAfterSourceChangeMs:stats(changeObservationDelays),bookmakerToProviderLatencyMeasured:false},
    invalidTimestampEvidence:{count:invalid.length,allExcludedFromNormalizedOdds:invalid.every(item=>item.normalizedOddsRows===0),examples:invalid.slice(0,20)},
    usage:{...usage,configuredConservativeLimit:4800,providerAdvertisedLimit:5000},
    conclusions:{actualPriceChangesObserved:changes.some(row=>row.sourceChangeCoherent),explicitBookmakerSuspensionObserved:rawSuspensions.length>0,selectionAbsenceObserved:disappearances.length>0,realMarketConfirmationFailuresObserved:staleTransitions.length>0,
      cannotClaim:['No se ha medido latencia entre cambio en Bet365 España y actualización del proveedor.','Los cambios del estado stale pertenecen a la confirmación del proveedor, no prueban una suspensión del operador.','Una ausencia de selección en REST necesita contraste adicional para atribuirla a cierre en Bet365.','El historial recibido no acredita una observación sin interrupciones entre todas las capturas.']}};
  writeFileSync(join(ROOT,'docs/OBSERVACIONES_CUOTAS.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify({sample:result.sample,priceChanges:{count:result.priceChanges.count,coherent:result.priceChanges.coherentCount,examples:changes.slice(0,4)},explicitRawSuspensions:rawSuspensions.length,disappearances:disappearances.length,confirmationTransitions:staleTransitions.length,invalidTimestamps:result.invalidTimestampEvidence,timing:result.timing,usage:result.usage},null,2));
}finally{db.close();}
