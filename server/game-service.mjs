import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {MODE_CONFIG,gridCell,pointInHintCell,haversineMeters,scoreGuess,answerRadiusMeters} from '../dist/rules.mjs';
import {pointInPlayArea} from '../dist/imagery-loader.mjs';

export const RULES_VERSION='grid-half-open-score-radius10-v1';
export const DAILY_TIMER_VERSION='server-30s-v1';
export const TIME_ZONE='Asia/Jerusalem';
export const MIN_STATISTICS_SAMPLE=30;
const ROUND_COUNT=5,DAILY_SECONDS=30,RUN_WINDOW_MS=10*60*1000,DAY_GRACE_MS=5*60*1000;
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const clone=value=>structuredClone(value);
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const zoneFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const parts=(formatter,at)=>Object.fromEntries(formatter.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));

export class GameServiceError extends Error{
  constructor(status,code,message,details){super(message);this.name='GameServiceError';this.status=status;this.code=code;if(details!==undefined)this.details=details;}
}
const fail=(status,code,message,details)=>{throw new GameServiceError(status,code,message,details);};

export function israelDayKey(at){
  if(!Number.isFinite(at))throw new TypeError('A finite timestamp is required');
  const p=parts(dateFormatter,at);return `${p.year}-${p.month}-${p.day}`;
}
export function israelDayWindow(dayKey){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey))fail(400,'INVALID_DAY','תאריך לא תקין.');
  const [year,month,day]=dayKey.split('-').map(Number),base=Date.UTC(year,month-1,day);
  if(new Date(base).toISOString().slice(0,10)!==dayKey)fail(400,'INVALID_DAY','תאריך לא תקין.');
  const midnight=utcDate=>{
    let guess=utcDate;
    for(let i=0;i<4;i++){
      const p=parts(zoneFormatter,guess),localAsUTC=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
      guess=utcDate-(localAsUTC-Math.floor(guess/1000)*1000);
    }
    return guess;
  };
  return {opensAt:midnight(base),closesAt:midnight(Date.UTC(year,month-1,day+1))};
}

/** Strictly-better comparison: ties receive no credit and never claim a win. */
export function strictBetterPercentile(value,otherValues,{higherIsBetter=false,minSampleSize=MIN_STATISTICS_SAMPLE}={}){
  if(otherValues.length===0||otherValues.length<minSampleSize)return null;
  const worse=otherValues.filter(other=>higherIsBetter?other<value:other>value).length;
  return Math.round(worse/otherValues.length*1000)/10;
}

export function createGameService({repository,catalog,playArea,now=Date.now,idFactory=randomUUID,dailySeed}={}){
  if(!repository||!catalog)throw new TypeError('A repository and catalog are required');
  const places=Array.isArray(catalog)?catalog:catalog.places;
  if(!Array.isArray(places))throw new TypeError('The catalog needs a places array');
  const allowedArea=playArea||catalog.playArea;
  if(!allowedArea)throw new TypeError('The exact play-area geometry is required');
  const snapshotId=catalog.snapshotId||hash(JSON.stringify(places.map(p=>[p.id,p.name,p.category,p.coordinates])));
  const mapVersion=catalog.mapVersion||'current-map-v1',rulesVersion=catalog.rulesVersion||RULES_VERSION;
  const privateDailySeed=dailySeed??repository.getDailySeed?.()??randomBytes(32).toString('hex');
  if(typeof privateDailySeed!=='string'||!privateDailySeed)throw new TypeError('dailySeed must be a nonempty private string');
  const poolCache=new Map();
  const instant=()=>{const value=Number(now());if(!Number.isFinite(value))throw new TypeError('now() must return a finite epoch timestamp');return value;};
  const transact=fn=>typeof repository.transaction==='function'?repository.transaction(fn):fn();
  const assertPlayer=playerId=>{if(typeof playerId!=='string'||!playerId)fail(401,'PLAYER_REQUIRED','צריך להתחיל מפגש משחק.');};
  const save=run=>repository.saveRun(run);
  const ensureCompatible=record=>{
    const timer=record.kind==='practice'?'untimed-v1':DAILY_TIMER_VERSION;
    if(record.rulesVersion!==RULES_VERSION||record.rulesVersion!==rulesVersion||record.mapVersion!==mapVersion||record.timerVersion!==timer)fail(503,'VERSION_UNAVAILABLE','המשחק נשמר בגרסת מפה או חוקים שאינה זמינה כרגע.');
  };
  const settings=(mode='normal',collection='landmarks')=>{
    if(!Object.hasOwn(MODE_CONFIG,mode))fail(400,'INVALID_MODE','רמת קושי לא תקינה.');
    if(!['landmarks','all'].includes(collection))fail(400,'INVALID_COLLECTION','מאגר משחק לא תקין.');
    return {mode,collection};
  };
  const placeSnapshot=place=>({id:place.id,revisionId:place.revisionId||hash(JSON.stringify([place.id,place.name,place.category,place.coordinates])),name:place.name,category:place.category,coordinates:[...place.coordinates],sourceUrl:place.sourceUrl||null,sourceLabel:place.sourceLabel||place.dataSource||'מקור הנתונים'});
  const eligible=(source,mode,collection)=>source.filter(p=>Array.isArray(p.coordinates)&&p.coordinates.length===2&&p.coordinates.every(Number.isFinite)&&p.name&&p.category&&(collection==='all'||p.poolGroup!=='businesses')&&(!p.eligibleModes||p.eligibleModes.includes(mode))&&pointInPlayArea(p.coordinates,allowedArea));
  const practicePool=(mode,collection)=>{const key=`${mode}:${collection}`;if(!poolCache.has(key)){const validated=typeof catalog.placesForMode==='function'?catalog.placesForMode(mode):null;poolCache.set(key,validated?validated.filter(p=>collection==='all'||p.poolGroup!=='businesses'):eligible(places,mode,collection));}return poolCache.get(key);};
  const ordered=(source,seed)=>source.map(place=>({place,order:hash(`${seed}|${place.id}`)})).sort((a,b)=>a.order.localeCompare(b.order)||a.place.id.localeCompare(b.place.id)).map(entry=>entry.place);
  const select=(source,seed,{strictRegions=false,preferCurated=false}={})=>{
    const candidates=ordered(source,seed);
    if(preferCurated)candidates.sort((a,b)=>(b.dailyPriority||0)-(a.dailyPriority||0));
    const selected=[],regions=new Set(),ids=new Set();
    for(const p of candidates){const region=p.dailyRegion||gridCell(p.coordinates,'hard').id;if(regions.has(region)||ids.has(p.id))continue;selected.push(p);regions.add(region);ids.add(p.id);if(selected.length===ROUND_COUNT)return selected;}
    if(!strictRegions)for(const p of candidates){if(ids.has(p.id))continue;selected.push(p);ids.add(p.id);if(selected.length===ROUND_COUNT)return selected;}
    fail(503,'CATALOG_NOT_READY','אין מספיק מקומות מתאימים למשחק כרגע.');
  };
  const cohort=(run,round)=>hash(JSON.stringify([round.place.revisionId,run.rulesVersion,run.mode,run.collection,run.timerVersion,run.mapVersion,round.cell.id]));
  const newRound=(place,index,mode)=>({index,id:idFactory(),place:placeSnapshot(place),cell:gridCell(place.coordinates,mode),state:index===0?'prepared':'pending',preparedAt:null,startedAt:null,deadlineAt:null,draftGuess:null,draftSavedAt:null,draftSequence:null,attempt:null,final:null});
  const makeRun=(playerId,kind,selected,{mode='normal',collection='landmarks',dayKey=null,challengeId=null,expiresAt=null}={})=>{
    const at=instant(),run={id:idFactory(),playerId,kind,mode,collection,dayKey,challengeId,catalogSnapshotId:snapshotId,mapVersion,rulesVersion,timerVersion:kind==='daily'?DAILY_TIMER_VERSION:'untimed-v1',createdAt:at,completedAt:null,expiresAt,status:'in_progress',currentRoundIndex:0,totalScore:0,submissionKeys:{},rounds:selected.map((p,i)=>newRound(p,i,mode))};
    run.rounds[0].preparedAt=at;return run;
  };
  const current=run=>run.rounds[run.currentRoundIndex];
  const complete=(run,at)=>{run.status='completed';run.completedAt=at;run.totalScore=run.rounds.reduce((sum,r)=>sum+(r.final?.score||0),0);};
  function finalize(run,round,coordinates,outcome,at){
    if(round.final)return;
    const centerDistanceMeters=coordinates?haversineMeters(coordinates,round.place.coordinates):null;
    const edgeDistanceMeters=centerDistanceMeters===null?null:Math.max(0,centerDistanceMeters-answerRadiusMeters);
    const score=centerDistanceMeters===null?0:scoreGuess(centerDistanceMeters,round.cell);
    round.final={guessCoordinates:coordinates?[...coordinates]:null,centerDistanceMeters,edgeDistanceMeters,score,outcome,finalizedAt:at};
    round.state='final';
    if(round.attempt)Object.assign(round.attempt,round.final);
    run.totalScore=run.rounds.reduce((sum,r)=>sum+(r.final?.score||0),0);
    if(run.currentRoundIndex===ROUND_COUNT-1)complete(run,at);
  }
  function expireRemaining(run,at){
    for(const round of run.rounds){
      if(round.final)continue;
      if(round.state==='active')finalize(run,round,round.draftGuess,round.draftGuess?'auto_submitted':'timeout',Math.min(round.deadlineAt||at,at));
      else{round.final={guessCoordinates:null,centerDistanceMeters:null,edgeDistanceMeters:null,score:0,outcome:'unseen',finalizedAt:at};round.state='final';}
    }
    complete(run,at);
  }
  function settle(run,at=instant()){
    if(run.status==='completed')return run;
    ensureCompatible(run);
    let changed=false;
    if(run.kind==='daily'&&run.expiresAt!==null&&at>=run.expiresAt){expireRemaining(run,run.expiresAt);changed=true;}
    else{const round=current(run);if(round.state==='active'&&round.deadlineAt!==null&&at>=round.deadlineAt){finalize(run,round,round.draftGuess,round.draftGuess?'auto_submitted':'timeout',round.deadlineAt);changed=true;}}
    if(changed)save(run);return run;
  }
  function owned(playerId,runId){
    assertPlayer(playerId);const found=repository.getRun(runId);
    if(!found||found.playerId!==playerId)fail(404,'RUN_NOT_FOUND','המשחק לא נמצא.');
    return settle(clone(found));
  }
  const checkRound=(run,body={})=>{if(body.roundId!==undefined&&body.roundId!==current(run).id)fail(409,'STALE_ROUND','הסיבוב כבר השתנה. יש לרענן את מצב המשחק.');};
  const validateGuess=(point,round)=>{
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))fail(400,'GUESS_REQUIRED','יש להניח סיכה בתוך אזור המשחק.');
    if(!pointInHintCell(point,round.cell)||!pointInPlayArea(point,allowedArea))fail(400,'GUESS_OUTSIDE_ALLOWED_AREA','אפשר לנחש רק בחלק המותר של המשבצת הירוקה.');
    return [...point];
  };
  const answer=round=>({name:round.place.name,category:round.place.category,coordinates:[...round.place.coordinates],radiusMeters:answerRadiusMeters,sourceUrl:round.place.sourceUrl,sourceLabel:round.place.sourceLabel});
  const resultView=(run,round)=>round.final?{roundIndex:round.index,score:round.final.score,outcome:round.final.outcome,guessCoordinates:round.final.guessCoordinates?[...round.final.guessCoordinates]:null,centerDistanceMeters:round.final.centerDistanceMeters,edgeDistanceMeters:round.final.edgeDistanceMeters,answer:run.kind==='practice'||run.status==='completed'?answer(round):null}:null;
  function view(run){
    const round=current(run),showPrompt=round.state==='active'||round.state==='final';
    return {runId:run.id,status:run.status,state:run.status==='completed'?'completed':round.state==='final'?'round_result':round.state,kind:run.kind,mode:run.mode,collection:run.collection,dayKey:run.dayKey,roundCount:ROUND_COUNT,roundIndex:run.currentRoundIndex,totalScore:run.totalScore,createdAt:run.createdAt,completedAt:run.completedAt,expiresAt:run.expiresAt,serverNow:instant(),rulesVersion:run.rulesVersion,mapVersion:run.mapVersion,
      currentRound:{index:round.index,id:round.id,cell:clone(round.cell),prompt:showPrompt?{name:round.place.name,category:round.place.category}:null,startedAt:round.startedAt,deadlineAt:round.deadlineAt,draftGuess:round.draftGuess?[...round.draftGuess]:null,draftSequence:round.draftSequence,result:resultView(run,round)},
      results:run.rounds.filter(r=>r.final).map(r=>resultView(run,r))};
  }
  function challengeFor(dayKey){
    let challenge=repository.getDailyChallenge(dayKey);if(challenge){ensureCompatible(challenge);return challenge;}
    const window=israelDayWindow(dayKey),source=catalog.dailyPlaces||places.filter(p=>p.dailyEligible);
    const selected=select(eligible(source,'normal','landmarks'),`${privateDailySeed}|${dayKey}|${snapshotId}|${rulesVersion}`,{strictRegions:true,preferCurated:true});
    challenge={id:`daily-${dayKey}-${hash(`${snapshotId}|${rulesVersion}`).slice(0,12)}`,dayKey,timeZone:TIME_ZONE,...window,catalogSnapshotId:snapshotId,mapVersion,rulesVersion,timerVersion:DAILY_TIMER_VERSION,places:selected.map(placeSnapshot),cells:selected.map(p=>gridCell(p.coordinates,'normal'))};
    repository.saveDailyChallenge(challenge);return challenge;
  }
  function attemptsFor(round,run){
    if(typeof repository.listAttempts==='function')return repository.listAttempts({placeRevisionId:round.place.revisionId,cohortKey:round.attempt?.cohortKey||cohort(run,round)});
    return repository.listRuns({}).flatMap(other=>(other.rounds||[]).map(r=>r.attempt).filter(Boolean));
  }
  function firstExposure(playerId,sourcePlaceId,at){
    if(typeof repository.markExposure==='function')return repository.markExposure(playerId,sourcePlaceId,at)===true;
    return !repository.listRuns({playerId}).some(run=>(run.rounds||[]).some(r=>r.startedAt!==null&&r.place.id===sourcePlaceId));
  }
  function statisticsView(playerId,run){
    if(run.kind==='daily'&&run.status!=='completed')fail(409,'RUN_NOT_COMPLETED','ההשוואות יופיעו בסיום המשחק.');
    const visibleRounds=run.rounds.filter(round=>round.final);
    return {runId:run.id,minSampleSize:MIN_STATISTICS_SAMPLE,serverNow:instant(),rounds:visibleRounds.map(round=>{
      const key=round.attempt?.cohortKey||cohort(run,round),byPlayer=new Map();
      for(const attempt of attemptsFor(round,run)){
        if(attempt.playerId===playerId||attempt.placeRevisionId!==round.place.revisionId||attempt.cohortKey!==key||attempt.finalizedAt===null||attempt.finalizedAt===undefined||attempt.firstExposure!==true||attempt.outcome==='unseen')continue;
        const previous=byPlayer.get(attempt.playerId);if(!previous||attempt.startedAt<previous.startedAt)byPlayer.set(attempt.playerId,attempt);
      }
      const reference=[...byPlayer.values()],errors=reference.map(a=>a.edgeDistanceMeters===null?Infinity:a.edgeDistanceMeters),ownError=round.final?.edgeDistanceMeters===null?Infinity:round.final.edgeDistanceMeters;
      const orderedErrors=[...errors].sort((a,b)=>a-b),middle=Math.floor(orderedErrors.length/2),median=orderedErrors.length?(orderedErrors.length%2?orderedErrors[middle]:(orderedErrors[middle-1]+orderedErrors[middle])/2):null;
      const ready=reference.length>=MIN_STATISTICS_SAMPLE;
      return {roundIndex:round.index,name:round.place.name,category:round.place.category,score:round.final?.score||0,edgeDistanceMeters:round.final?.edgeDistanceMeters??null,sampleSize:reference.length,percentile:round.attempt?strictBetterPercentile(ownError,errors):null,percentileKind:'strict-better',status:ready?'ready':'warming_up',medianEdgeDistanceMeters:ready&&Number.isFinite(median)?median:null,perfectRate:ready?reference.filter(a=>a.score===100).length/reference.length:null};
    })};
  }
  function boardView(playerId,dayKey){
    israelDayWindow(dayKey);const ownFound=repository.findDailyRun(playerId,dayKey);
    if(!ownFound)fail(409,'DAILY_NOT_COMPLETED','הדירוג ייפתח אחרי השלמת האתגר היומי.');
    const ownRun=settle(clone(ownFound));if(ownRun.status!=='completed')fail(409,'DAILY_NOT_COMPLETED','הדירוג ייפתח אחרי השלמת האתגר היומי.');
    const completed=repository.listRuns({kind:'daily',dayKey}).map(run=>settle(clone(run))).filter(run=>run.status==='completed');
    completed.sort((a,b)=>b.totalScore-a.totalScore||a.completedAt-b.completedAt||a.id.localeCompare(b.id));
    const scoreCounts=new Map(),scoreRanks=new Map(),binCounts=Array(11).fill(0);for(const run of completed){scoreCounts.set(run.totalScore,(scoreCounts.get(run.totalScore)||0)+1);binCounts[Math.min(10,Math.floor(run.totalScore/50))]++;}
    let rank=1;for(const score of [...scoreCounts.keys()].sort((a,b)=>b-a)){scoreRanks.set(score,rank);rank+=scoreCounts.get(score);}
    const publicRow=run=>({rank:scoreRanks.get(run.totalScore),nickname:repository.getPlayer?.(run.playerId)?.nickname||'שחקן',totalScore:run.totalScore,tiedCount:scoreCounts.get(run.totalScore),isYou:run.playerId===playerId,completedAt:run.completedAt});
    const entries=completed.slice(0,50).map(publicRow),ownEntry=publicRow(ownRun),others=completed.filter(run=>run.playerId!==playerId).map(run=>run.totalScore);
    const histogram=Array.from({length:11},(_,i)=>{const min=i*50,max=i===10?500:min+49;return {min,max,count:binCounts[i],isOwnBin:ownRun.totalScore>=min&&ownRun.totalScore<=max};});
    return {dayKey,participants:completed.length,entries,own:{...ownEntry,percentile:strictBetterPercentile(ownRun.totalScore,others,{higherIsBetter:true}),sampleSize:others.length},histogram,minSampleSize:MIN_STATISTICS_SAMPLE,serverNow:instant(),final:instant()>=israelDayWindow(dayKey).closesAt+DAY_GRACE_MS};
  }
  return {
    bootstrap(playerId){return transact(()=>{assertPlayer(playerId);const dayKey=israelDayKey(instant()),activeRuns=[],unavailableRuns=[];for(const original of repository.listRuns({playerId,status:'in_progress'})){try{const run=settle(clone(original));if(run.status!=='completed')activeRuns.push(view(run));}catch(error){if(error.code!=='VERSION_UNAVAILABLE')throw error;unavailableRuns.push({runId:original.id,kind:original.kind,dayKey:original.dayKey,code:error.code});}}const daily=repository.findDailyRun(playerId,dayKey);return {serverNow:instant(),dayKey,timeZone:TIME_ZONE,settings:{modes:Object.keys(MODE_CONFIG),collections:['landmarks','all'],roundCount:ROUND_COUNT,dailySeconds:DAILY_SECONDS},activeRuns,unavailableRuns,daily:{dayKey,runId:daily?.id||null,status:unavailableRuns.some(r=>r.runId===daily?.id)?'unavailable':daily?daily.status:'not_started'}};});},
    createPractice(playerId,options={}){return transact(()=>{assertPlayer(playerId);const {mode,collection}=settings(options.mode,options.collection),seed=idFactory(),selected=select(practicePool(mode,collection),seed);if(eligible(selected,mode,collection).length!==ROUND_COUNT)fail(503,'CATALOG_NOT_READY','אין מספיק מקומות מתאימים למשחק כרגע.');const run=makeRun(playerId,'practice',selected,{mode,collection});save(run);return view(run);});},
    getDaily(playerId){return transact(()=>{assertPlayer(playerId);const at=instant(),dayKey=israelDayKey(at),existing=repository.findDailyRun(playerId,dayKey);if(existing)return view(settle(clone(existing)));const challenge=challengeFor(dayKey),run=makeRun(playerId,'daily',challenge.places,{dayKey,challengeId:challenge.id,expiresAt:Math.min(at+RUN_WINDOW_MS,challenge.closesAt+DAY_GRACE_MS)});run.catalogSnapshotId=challenge.catalogSnapshotId;run.mapVersion=challenge.mapVersion;run.rulesVersion=challenge.rulesVersion;run.timerVersion=challenge.timerVersion;for(let i=0;i<run.rounds.length;i++)if(challenge.cells?.[i])run.rounds[i].cell=clone(challenge.cells[i]);save(run);return view(run);});},
    getRun(playerId,runId){return transact(()=>view(owned(playerId,runId)));},
    prepareRound(playerId,runId,body={}){return transact(()=>{const run=owned(playerId,runId);if(run.status==='completed')return view(run);checkRound(run,body);const round=current(run);if(round.state==='pending'){round.state='prepared';round.preparedAt=instant();save(run);}return view(run);});},
    startRound(playerId,runId,body={}){return transact(()=>{const run=owned(playerId,runId);if(run.status==='completed')return view(run);checkRound(run,body);const round=current(run);if(round.state==='active'||round.state==='final')return view(run);const at=instant();if(run.kind==='daily'&&at+DAILY_SECONDS*1000>run.expiresAt){expireRemaining(run,at);save(run);return view(run);}round.state='active';round.startedAt=at;round.deadlineAt=run.kind==='daily'?at+DAILY_SECONDS*1000:null;round.attempt={id:round.id,runId:run.id,playerId,sourcePlaceId:round.place.id,placeRevisionId:round.place.revisionId,cohortKey:cohort(run,round),roundIndex:round.index,kind:run.kind,mode:run.mode,collection:run.collection,startedAt:at,deadlineAt:round.deadlineAt,firstExposure:firstExposure(playerId,round.place.id,at),finalizedAt:null,guessCoordinates:null,centerDistanceMeters:null,edgeDistanceMeters:null,score:null,outcome:null};save(run);return view(run);});},
    saveDraft(playerId,runId,body={}){return transact(()=>{const run=owned(playerId,runId);if(run.status==='completed'||current(run).state==='final')return view(run);checkRound(run,body);const round=current(run);if(round.state!=='active')fail(409,'ROUND_NOT_STARTED','צריך להתחיל את הסיבוב.');if(body.sequence!==undefined&&(!Number.isSafeInteger(body.sequence)||body.sequence<0))fail(400,'INVALID_DRAFT_SEQUENCE','מספר עדכון לא תקין.');if(body.sequence!==undefined&&round.draftSequence!==null&&body.sequence<=round.draftSequence)return view(run);round.draftGuess=validateGuess(body.coordinates,round);round.draftSavedAt=instant();if(body.sequence!==undefined)round.draftSequence=body.sequence;save(run);return view(run);});},
    submitGuess(playerId,runId,body={}){return transact(()=>{const run=owned(playerId,runId);if(body.idempotencyKey!==undefined&&(typeof body.idempotencyKey!=='string'||body.idempotencyKey.length<1||body.idempotencyKey.length>128))fail(400,'INVALID_IDEMPOTENCY_KEY','מפתח בקשה לא תקין.');if(body.idempotencyKey&&Object.hasOwn(run.submissionKeys,body.idempotencyKey))return view(run);if(run.status==='completed'||current(run).state==='final')return view(run);checkRound(run,body);const round=current(run);if(round.state!=='active')fail(409,'ROUND_NOT_STARTED','צריך להתחיל את הסיבוב.');const point=validateGuess(body.coordinates,round);round.draftGuess=point;finalize(run,round,point,'submitted',instant());if(body.idempotencyKey)Object.defineProperty(run.submissionKeys,body.idempotencyKey,{value:round.index,enumerable:true,writable:true,configurable:true});save(run);return view(run);});},
    nextRound(playerId,runId,body={}){return transact(()=>{const run=owned(playerId,runId);if(run.status==='completed')return view(run);checkRound(run,body);if(current(run).state!=='final')fail(409,'ROUND_NOT_FINISHED','צריך להשלים את הסיבוב הנוכחי.');run.currentRoundIndex++;const round=current(run);round.state='prepared';round.preparedAt=instant();save(run);return view(run);});},
    leaderboard(playerId,{dayKey=israelDayKey(instant()),day}={}){return transact(()=>{assertPlayer(playerId);return boardView(playerId,day||dayKey);});},
    placeStatistics(playerId,runId){return transact(()=>{const run=owned(playerId,runId);return statisticsView(playerId,run);});},
    statistics(playerId,runId){return transact(()=>{const run=owned(playerId,runId);return statisticsView(playerId,run);});},
  };
}
