import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../src/config.ts';
import type {MonitorAcceptanceEvidence} from '../src/odds/acceptance.ts';

export interface EvidenceFrame {id:string;format:string;url:string;requestedAt:number|null;receivedAt:number;raw:any;sha256?:string;}
const TRACKED=new Set(['40','981','10114','10150','10544','171','178002','938','10143']);
const timestamp=(v:unknown):number|null=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const stats=(v:number[])=>{const a=v.filter(Number.isFinite).sort((x,y)=>x-y);const q=(p:number)=>a.length?a[Math.floor((a.length-1)*p)]:null;return {count:a.length,min:a[0]??null,p50:q(.5),p95:q(.95),max:a.at(-1)??null};};
const example=(array:any[],value:any)=>{if(array.length<20)array.push(value);};
function lineIdentity(raw:any):string|null {return raw.line==null&&raw.handicap==null?null:String(raw.line??raw.handicap).replaceAll(' ','');}
interface Item {key:string;eventId:string;groupId:string;selectionId:string;marketId:string;line:string|null;price:number;changedAt:number|null;observedAt:number|null;confirmedAt:number|null;suspended:boolean;stale:boolean;coherent:boolean;captureId:string;receivedAt:number;mode:string;}
export function unpackFrame(frame:EvidenceFrame,tracked:ReadonlySet<string>=TRACKED) {
 const url=new URL(frame.url),raw=frame.raw;
 if(raw?.site!=='com')return null;
 const direct=frame.format==='moviodds-live-fixture-v1';
 const board=frame.format==='moviodds-laliga-extract-v1';
 if(!direct&&!board)return null;
 if(raw.warming===true||raw.partial===true||raw.truncated===true||raw.complete===false||raw.dropped!==undefined&&raw.dropped!==0)return null;
 if(direct&&(!Array.isArray(raw.quotes)||raw.fixture!==url.searchParams.get('fi')||raw.dropped!==0||raw.count!==raw.quotes.length||!['cache','live-fetch'].includes(raw.source)))return null;
 if(board&&!Array.isArray(raw.matches))return null;
 // Every request filter participates, including phase filters such as in_play.
 const requestFilters=[...url.searchParams].map(([k,v])=>[k,k==='groups'?v.split(',').sort().join(','):v]).sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
 const scope=JSON.stringify([url.origin,url.pathname,direct?raw.fixture:null,requestFilters]);
 const matches=direct?[{id:raw.fixture,quotes:raw.quotes,group_status:raw.group_status}]:raw.matches;
 const items:Item[]=[],groups=new Map<string,{at:number|null;stale:boolean}>(),events=new Set<string>();
 let allRawCount=0,allRawSuspended=0,trackedSuspended=0,suspensionFieldsMissing=0;
 for(const m of matches){
  if(!direct&&(m.sport!=='soccer'||m.league!=='Spain La Liga'))continue;
  events.add(String(m.id));
  for(const [group,status] of Object.entries(m.group_status??{}))if(tracked.has(group))groups.set(JSON.stringify([String(m.id),group]),{at:timestamp((status as any)?.polled_at),stale:(status as any)?.stale===true});
  for(const r of m.quotes??[]){
   allRawCount++;if(r.suspended===true)allRawSuspended++;if(r.suspended===undefined)suspensionFieldsMissing++;
   if(!tracked.has(String(r.group_id)))continue;
   const eventId=String(m.id),groupId=String(r.group_id),selectionId=String(r.sel_id??''),marketId=String(r.market_id??''),line=lineIdentity(r),mode=direct&&raw.source==='live-fetch'?'observation':'last-price-change';
   const sourceTime=timestamp(r.ts),confirmedAt=timestamp(m.group_status?.[groupId]?.polled_at);
   const coherent=r.fixture_id===eventId&&selectionId.length>0&&typeof r.odds_dec==='number'&&r.odds_dec>1&&sourceTime!==null&&confirmedAt!==null&&sourceTime<=confirmedAt&&confirmedAt<=frame.receivedAt;
   if(r.suspended===true)trackedSuspended++;
   const period=r.period===undefined?'full_time_regulation':String(r.period);
   items.push({key:JSON.stringify([eventId,groupId,marketId,period,selectionId,line]),eventId,groupId,selectionId,marketId,line,price:r.odds_dec,changedAt:mode==='last-price-change'?sourceTime:null,observedAt:mode==='observation'?sourceTime:null,confirmedAt,suspended:r.suspended===true,stale:m.group_status?.[groupId]?.stale===true,coherent,captureId:frame.id,receivedAt:frame.receivedAt,mode});
  }
 }
 return {scope,matches,items,groups,events,allRawCount,allRawSuspended,trackedSuspended,suspensionFieldsMissing,direct};
}
export function analyzeFrames(frames:Iterable<EvidenceFrame>,groups?:string[]) {
 const tracked=groups?new Set(groups):TRACKED;
 const previous=new Map<string,{frame:EvidenceFrame;data:NonNullable<ReturnType<typeof unpackFrame>>}>();
 const timings:number[]=[],confirmationAges:number[]=[],globalGaps:number[]=[],scopeGaps:number[]=[],sourceChangeAges:number[]=[];
 const priceExamples:any[]=[],suspensionExamples:any[]=[],absenceExamples:any[]=[],groupAbsenceExamples:any[]=[],fixtureAbsenceExamples:any[]=[],withdrawalExamples:any[]=[],invalidExamples:any[]=[],gapExamples:any[]=[];
 const evidenceRefs:{captureId:string;sha256:string;receivedAt:number}[]=[];
 let count=0,rejected=0,first:number|null=null,last:number|null=null,previousReceived:number|null=null,quotes=0,allRawQuotes=0,allRawSuspended=0,trackedRawSuspended=0,rawSuspendedWithoutStale=0,coherentSuspendedWithoutStale=0,suspensionFieldsMissing=0;
 let priceChanges=0,coherentPriceChanges=0,coherentObservationChanges=0,suspensionTransitions=0,staleTransitions=0,missingSelections=0,missingGroups=0,missingFixtures=0,eligibleMissingGroups=0,eligibleMissingFixtures=0,invalidTimes=0,completeComparisons=0;
 let run={first:0,last:0,captures:0,maxGapMs:0},longest={...run};
 const byFormat:Record<string,number>={},bySource:Record<string,number>={};
 for(const frame of frames){
  const current=unpackFrame(frame,tracked);if(!current){rejected++;continue;}
  count++;byFormat[frame.format]=(byFormat[frame.format]??0)+1;const source=frame.raw.source??'catalog-cache';bySource[source]=(bySource[source]??0)+1;
  if(frame.sha256&&/^[a-f0-9]{64}$/.test(frame.sha256))evidenceRefs.push({captureId:frame.id,sha256:frame.sha256,receivedAt:frame.receivedAt});
  first=first===null?frame.receivedAt:Math.min(first,frame.receivedAt);last=last===null?frame.receivedAt:Math.max(last,frame.receivedAt);
  if(frame.requestedAt!==null&&frame.receivedAt>=frame.requestedAt)timings.push(frame.receivedAt-frame.requestedAt);
  if(previousReceived!==null){const gap=frame.receivedAt-previousReceived;globalGaps.push(gap);if(gap>60000){example(gapExamples,{before:new Date(previousReceived).toISOString(),after:new Date(frame.receivedAt).toISOString(),gapMs:gap});run={first:frame.receivedAt,last:frame.receivedAt,captures:1,maxGapMs:0};}else{run.last=frame.receivedAt;run.captures++;run.maxGapMs=Math.max(run.maxGapMs,gap);}}
  else run={first:frame.receivedAt,last:frame.receivedAt,captures:1,maxGapMs:0};
  if(run.last-run.first>longest.last-longest.first||run.last-run.first===longest.last-longest.first&&run.captures>longest.captures)longest={...run};previousReceived=frame.receivedAt;
  quotes+=current.items.length;allRawQuotes+=current.allRawCount;allRawSuspended+=current.allRawSuspended;trackedRawSuspended+=current.trackedSuspended;suspensionFieldsMissing+=current.suspensionFieldsMissing;
  for(const item of current.items){
   if(item.suspended&&!item.stale){rawSuspendedWithoutStale++;if(item.coherent)coherentSuspendedWithoutStale++;}
   if(item.confirmedAt!==null&&item.confirmedAt<=frame.receivedAt)confirmationAges.push(frame.receivedAt-item.confirmedAt);
   if(!item.coherent){invalidTimes++;example(invalidExamples,item);}
  }
  const prior=previous.get(current.scope);
  if(prior){
   completeComparisons++;scopeGaps.push(frame.receivedAt-prior.frame.receivedAt);
   const old=new Map(prior.data.items.map(item=>[item.key,item])),next=new Set(current.items.map(item=>item.key));
   const refs={before:{captureId:prior.frame.id,sha256:prior.frame.sha256??null},after:{captureId:frame.id,sha256:frame.sha256??null}};
   for(const item of current.items){
    const before=old.get(item.key);if(!before)continue;
    if(before.price!==item.price){priceChanges++;const coherent=before.coherent&&item.coherent&&before.mode===item.mode&&item.mode==='last-price-change'&&item.changedAt!>before.changedAt!;const observed=before.coherent&&item.coherent&&before.mode===item.mode&&item.mode==='observation'&&item.observedAt!>before.observedAt!;if(coherent){coherentPriceChanges++;sourceChangeAges.push(item.receivedAt-item.changedAt!);}if(observed)coherentObservationChanges++;example(priceExamples,{before,after:item,coherentLastChangeClock:coherent,coherentObservationClock:observed,gapMs:item.receivedAt-before.receivedAt});}
    if(!before.suspended&&item.suspended){suspensionTransitions++;example(suspensionExamples,{before,after:item,operatorDirectlyConfirmed:false});}
   }
   for(const [key,group] of current.groups){const old=prior.data.groups.get(key);if(old&&old.stale!==group.stale)staleTransitions++;}
   for(const before of prior.data.items){
    if(next.has(before.key))continue;
    if(!current.events.has(before.eventId)){continue;}
    const groupKey=JSON.stringify([before.eventId,before.groupId]),group=current.groups.get(groupKey),oldGroup=prior.data.groups.get(groupKey);
    if(!group)continue;
    // Same endpoint/filter, same fixture, covered group with a non-regressing read clock.
    if(!before.coherent||group.at===null||group.at>frame.receivedAt||!oldGroup||oldGroup.at===null||group.at<oldGroup.at)continue;
    missingSelections++;const absence={type:'selection',before,afterCaptureId:frame.id,afterReceivedAt:frame.receivedAt,groupConfirmedAt:group.at,scope:current.scope,evidenceRefs:refs,meaning:'Ausencia en respuesta comparable; no demuestra cierre en la página del operador.'};example(absenceExamples,absence);example(withdrawalExamples,absence);
   }
   const coherentPriorGroups=new Map<string,Item[]>();
   for(const before of prior.data.items)if(before.coherent){const key=JSON.stringify([before.eventId,before.groupId]),list=coherentPriorGroups.get(key)??[];list.push(before);coherentPriorGroups.set(key,list);}
   const currentQuotedGroups=new Set(current.items.map(item=>JSON.stringify([item.eventId,item.groupId])));
   for(const [key] of prior.data.groups)if(!current.groups.has(key)){
    const [eventId,groupId]=JSON.parse(key);if(!current.events.has(eventId))continue;
    missingGroups++;
    const priorQuotes=coherentPriorGroups.get(key)??[],eligible=priorQuotes.length>0&&!currentQuotedGroups.has(key);
    const absence={type:'group',eventId,groupId,beforeCaptureId:prior.frame.id,afterCaptureId:frame.id,afterReceivedAt:frame.receivedAt,scope:current.scope,previousCoherentSelections:priorQuotes.length,selectionIds:priorQuotes.map(q=>q.selectionId),eligible,evidenceRefs:refs,meaning:eligible?'El grupo y sus precios faltan en la respuesta íntegra del mismo alcance; retirada de fuente, sin afirmar cierre del operador.':'Falta metadato de grupo; sin precios previos coherentes o con precios todavía presentes no acredita retirada.'};
    example(groupAbsenceExamples,absence);if(eligible){eligibleMissingGroups++;example(withdrawalExamples,absence);}
   }
   for(const eventId of prior.data.events)if(!current.events.has(eventId)){
    missingFixtures++;const priorQuotes=prior.data.items.filter(q=>q.eventId===eventId&&q.coherent),eligible=priorQuotes.length>0;
    const absence={type:'fixture',eventId,beforeCaptureId:prior.frame.id,afterCaptureId:frame.id,afterReceivedAt:frame.receivedAt,scope:current.scope,previousCoherentSelections:priorQuotes.length,selectionIds:priorQuotes.map(q=>q.selectionId),eligible,evidenceRefs:refs,meaning:eligible?'El partido falta en el tablero íntegro de igual alcance; retirada de fuente, sin afirmar cierre del operador.':'El partido anterior no tenía precios coherentes del catálogo; no acredita retirada de una cotización utilizable.'};
    example(fixtureAbsenceExamples,absence);if(eligible){eligibleMissingFixtures++;example(withdrawalExamples,absence);}
   }
  }
  previous.set(current.scope,{frame,data:current});
 }
 const http=stats(timings),confirmation=stats(confirmationAges);
 const contractRefs=evidenceRefs.map(({captureId,sha256})=>({captureId,sha256}));
 const windowRefs=evidenceRefs.filter(ref=>ref.receivedAt>=longest.first&&ref.receivedAt<=longest.last).map(({captureId,sha256})=>({captureId,sha256}));
 const comparableWithdrawals=missingSelections+eligibleMissingGroups+eligibleMissingFixtures;
 const monitorEvidence:MonitorAcceptanceEvidence={captures:count,priceChanges:coherentPriceChanges+coherentObservationChanges,explicitSuspensions:coherentSuspendedWithoutStale,comparableWithdrawals,firstReceivedAt:first??0,lastReceivedAt:last??0,maxGapMs:stats(globalGaps).max??0,httpDurationMs:{count:http.count,p95:http.p95??0,max:http.max??0},confirmationAgeMs:{count:confirmation.count,p95:confirmation.p95??0,max:confirmation.max??0},evidenceRefs:contractRefs,continuousWindow:longest.captures?{firstReceivedAt:longest.first,lastReceivedAt:longest.last,captures:longest.captures,maxGapMs:longest.maxGapMs,evidenceRefs:windowRefs}:undefined};
 return {version:1,auditedAt:new Date().toISOString(),readOnlyDatabase:true,trackedGroupIds:[...tracked].sort(),scope:'Explicit prematch group IDs; source snapshots are compared only within the same endpoint, fixture filter, sport, site and requested group filter.',monitorEvidence,
  sample:{captures:count,rejectedCaptures:rejected,byFormat,bySource,firstReceivedAt:first===null?null:new Date(first).toISOString(),lastReceivedAt:last===null?null:new Date(last).toISOString(),spanMs:first===null||last===null?0:last-first,trackedRawQuoteObservations:quotes,allRawQuoteObservations:allRawQuotes,comparableScopeStreams:previous.size,comparisons:completeComparisons},
  priceChanges:{count:priceChanges,coherentLastChangeCount:coherentPriceChanges,coherentObservationCount:coherentObservationChanges,examples:priceExamples},
  suspensions:{allGroupsExplicitRawTrueObservations:allRawSuspended,trackedGroupsExplicitRawTrueObservations:trackedRawSuspended,trackedWithoutStaleFlag:rawSuspendedWithoutStale,trackedCoherentWithoutStaleFlag:coherentSuspendedWithoutStale,trackedFalseToTrueTransitions:suspensionTransitions,rawFieldMissingObservations:suspensionFieldsMissing,examples:suspensionExamples,note:'Explicit provider flags are evidence of source availability, not an independent observation of a suspension in Bet365 Spain. Stale flags are kept separate.'},
  absences:{comparableCoveredSelectionAbsences:missingSelections,wholeGroupAbsences:missingGroups,wholeFixtureAbsences:missingFixtures,eligibleWholeGroupWithdrawals:eligibleMissingGroups,eligibleWholeFixtureWithdrawals:eligibleMissingFixtures,comparableWithdrawals,selectionExamples:absenceExamples,groupExamples:groupAbsenceExamples,fixtureExamples:fixtureAbsenceExamples,withdrawalExamples,note:'Disjoint selection/group/fixture source withdrawals require previously coherent quotes and complete RAW responses of identical endpoint and every query filter. Metadata disappearance while prices remain, empty prior groups, truncated responses and normalized in_play exclusions do not qualify. No subtype establishes operator market closure.'},
  confirmationState:{distinctGroupStaleTransitions:staleTransitions},invalidRawQuoteMetadata:{count:invalidTimes,examples:invalidExamples},
  timing:{httpDurationMs:stats(timings),globalCaptureGapMs:stats(globalGaps),sameScopeCaptureGapMs:stats(scopeGaps),confirmationAgeAtReceiptMs:stats(confirmationAges),receivedAfterLastChangeMs:stats(sourceChangeAges),longestGlobalRunWithGapsAtMost60s:{...longest,durationMs:longest.last-longest.first},gapExamples,bookmakerToProviderPropagationMeasured:false,note:'HTTP duration, market read age and capture intervals are measurable. Their combination is not operator-to-provider propagation latency.'},
  acceptance:{realPriceChangesObserved:coherentPriceChanges+coherentObservationChanges>0,sourceSuspensionFlagsObserved:trackedRawSuspended>0,comparableSelectionAbsencesObserved:missingSelections>0,comparableSourceWithdrawalsObserved:comparableWithdrawals>0,sourceConfirmationChangesObserved:staleTransitions>0,independentBet365SpainSuspensionProof:false,independentBet365SpainWithdrawalProof:false,operatorToProviderLatencyProof:false,
   remaining:['Independent Spanish operator comparisons and current scoped regional/rules audit must be supplied by browser evidence.','Provider suspension flags and REST absences cannot alone verify suspensions or closure on Bet365 Spain.','Failure, retry, stale-response and restart behavior needs controlled end-to-end checks in addition to source evidence.','Acceptance requires declared coverage and quota/cadence accounting; this audit does not automatically mark progress complete.']}};
}
export function capturedFrames(directory:string):{frames:Iterable<EvidenceFrame>;metadata:object} {
 const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
 if(manifest.purpose!=='bounded-acceptance-public-read'||!Array.isArray(manifest.records))throw Error('Manifiesto de aceptación desconocido.');
 const records=manifest.records.filter((r:any)=>r.file).sort((a:any,b:any)=>a.receivedAt-b.receivedAt);
 function* frames():Generator<EvidenceFrame>{for(const row of records){
  if(!/^\d{3}-\d+\.json$/.test(row.file)||!/^\d+$/.test(row.eventId))throw Error('Ruta de muestra inválida.');
  const capture=JSON.parse(readFileSync(join(directory,row.file),'utf8'));
  if(createHash('sha256').update(capture.raw).digest('hex')!==row.sha256||capture.receivedAt!==row.receivedAt||capture.requestedAt!==row.requestedAt||capture.url!==`https://moviodds.com/quotes?fi=${row.eventId}&site=com`)throw Error('La muestra no coincide con su manifiesto.');
  yield {id:`file:${row.file}:${row.sha256}`,format:'moviodds-live-fixture-v1',url:capture.url,requestedAt:capture.requestedAt,receivedAt:capture.receivedAt,raw:JSON.parse(capture.raw),sha256:row.sha256};
 }}
 return {frames:frames(),metadata:{directory,records:manifest.records.length,successfulReads:records.length,failures:manifest.records.filter((r:any)=>!r.file),plannedRounds:manifest.rounds,fixtureIds:manifest.ids,hashesVerifiedDuringRead:true}};
}
function* mergeFrames(a:Iterable<EvidenceFrame>,b:Iterable<EvidenceFrame>):Generator<EvidenceFrame>{
 const left=a[Symbol.iterator](),right=b[Symbol.iterator]();let x=left.next(),y=right.next();
 while(!x.done||!y.done){if(y.done||!x.done&&x.value.receivedAt<=y.value.receivedAt){yield x.value;x=left.next();}else{yield y.value;y=right.next();}}
}
/** The DB stream wins equal-time ties, so importing a file never creates a new observation. */
export function* uniqueCaptureFrames(databaseFrames:Iterable<EvidenceFrame>,archivedFrames:Iterable<EvidenceFrame>=[]):Generator<EvidenceFrame>{
 const seen=new Set<string>();
 for(const frame of mergeFrames(databaseFrames,archivedFrames)){
  const identity=JSON.stringify([frame.url,frame.requestedAt,frame.receivedAt,frame.sha256??createHash('sha256').update(JSON.stringify(frame.raw)).digest('hex')]);
  if(seen.has(identity))continue;
  seen.add(identity);yield frame;
 }
}
export function auditDatabase(databasePath:string,captureDirectory?:string,groups?:string[]) {
 const db=new DatabaseSync(databasePath,{readOnly:true});
 try {
  db.exec('PRAGMA query_only=ON; BEGIN');
  const rows=db.prepare('SELECT c.id,c.requested_at,c.received_at,p.format,p.source_url,p.raw_text,p.sha256 FROM captures c JOIN payloads p ON p.id=c.payload_id WHERE c.source_id=? AND p.format IN (?,?) ORDER BY c.received_at,c.id').iterate('moviodds:com','moviodds-laliga-extract-v1','moviodds-live-fixture-v1');
  function* frames():Generator<EvidenceFrame>{for(const row of rows){if(createHash('sha256').update(String(row.raw_text)).digest('hex')!==row.sha256)throw Error('La captura SQLite no coincide con su huella.');yield {id:String(row.id),format:String(row.format),url:String(row.source_url),requestedAt:row.requested_at===null?null:Number(row.requested_at),receivedAt:Number(row.received_at),raw:JSON.parse(String(row.raw_text)),sha256:String(row.sha256)};}}
  const archive=captureDirectory?capturedFrames(captureDirectory):null;
  const result=analyzeFrames(uniqueCaptureFrames(frames(),archive?.frames??[]),groups);
  const usagePath=join(dirname(databasePath),'odds-usage.json'),rawUsage=existsSync(usagePath)?JSON.parse(readFileSync(usagePath,'utf8')):null;
  const usage=rawUsage&&Number.isSafeInteger(rawUsage.used)&&rawUsage.used>=0?{used:rawUsage.used,limit:4800 as const,freeOnly:true as const}:undefined;
  return {...result,monitorEvidence:{...result.monitorEvidence,usage},boundedCaptureRun:archive?.metadata??null,storage:{integrity:db.prepare('PRAGMA integrity_check').get(),normalizedOddsObservations:db.prepare('SELECT count(*) count FROM odds_observations').get(),sourceCaptureCounts:db.prepare('SELECT s.id,count(c.id) captures FROM sources s LEFT JOIN captures c ON c.source_id=s.id GROUP BY s.id').all()}};
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),database=args.find(a=>a.startsWith('--database='))?.slice(11)??join(ROOT,'data/laliga.sqlite'),output=args.find(a=>a.startsWith('--output='))?.slice(9)??join(ROOT,'docs/acceptance-evidence-nov22.json');
 if(args.some(a=>!a.startsWith('--database=')&&!a.startsWith('--output=')&&!a.startsWith('--captures=')&&!a.startsWith('--groups=')))throw new Error('Uso: node scripts/acceptance-evidence.ts [--database=...] [--output=...] [--captures=...] [--groups=40,10114,...]');
 const captureDirectory=args.find(a=>a.startsWith('--captures='))?.slice(11),groups=args.find(a=>a.startsWith('--groups='))?.slice(9).split(',');
 const report=auditDatabase(database,captureDirectory,groups);writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,sample:report.sample,priceChanges:report.priceChanges.count,suspensions:report.suspensions,absences:{selection:report.absences.comparableCoveredSelectionAbsences,eligibleGroupWithdrawals:report.absences.eligibleWholeGroupWithdrawals,eligibleFixtureWithdrawals:report.absences.eligibleWholeFixtureWithdrawals,totalComparableSourceWithdrawals:report.absences.comparableWithdrawals,groupMetadataAbsences:report.absences.wholeGroupAbsences,fixtureAbsences:report.absences.wholeFixtureAbsences},timing:report.timing,acceptance:report.acceptance},null,2));
}
