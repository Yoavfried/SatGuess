import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameService,israelDayKey,israelDayWindow,strictBetterPercentile,RULES_VERSION} from '../server/game-service.mjs';
import {gridCell} from '../dist/rules.mjs';

const MASK={type:'Polygon',coordinates:[[[34,29],[36,29],[36,34],[34,34],[34,29]],[[34.71,32.065],[34.73,32.065],[34.73,32.08],[34.71,32.08],[34.71,32.065]]]};
const POINTS=[[34.75,32.06],[34.95,31.86],[35.15,31.66],[35.35,31.46],[35.55,31.26]];
const places=POINTS.map((coordinates,i)=>({id:`fixture-place-${i}`,revisionId:`revision-${i}`,name:`מקום לדוגמה ${i}`,category:'מוזיאון',coordinates,poolGroup:'landmarks',eligibleModes:['easy','normal','hard'],dailyPriority:2,sourceUrl:`https://example.test/place/${i}`,sourceLabel:'מקור בדיקה'}));
const catalog={places,dailyPlaces:places,snapshotId:'fixture-snapshot',mapVersion:'fixture-map',rulesVersion:RULES_VERSION,playArea:MASK};
function memoryRepository(){
  const runs=new Map(),challenges=new Map(),exposures=new Set(),players=new Map();
  return {
    transaction:fn=>fn(),getRun:id=>runs.has(id)?structuredClone(runs.get(id)):null,
    saveRun:run=>{runs.set(run.id,structuredClone(run));return run;},
    findDailyRun:(playerId,dayKey)=>structuredClone([...runs.values()].find(r=>r.playerId===playerId&&r.kind==='daily'&&r.dayKey===dayKey)||null),
    listRuns:filters=>[...runs.values()].filter(run=>Object.entries(filters||{}).every(([key,value])=>run[key]===value)).map(value=>structuredClone(value)),
    getDailyChallenge:dayKey=>structuredClone(challenges.get(dayKey)||null),saveDailyChallenge:challenge=>challenges.set(challenge.dayKey,structuredClone(challenge)),
    listAttempts:filters=>[...runs.values()].flatMap(r=>r.rounds.map(round=>round.attempt).filter(Boolean)).filter(a=>Object.entries(filters||{}).every(([key,value])=>a[key]===value)).map(value=>structuredClone(value)),
    markExposure(playerId,id){const key=`${playerId}:${id}`;if(exposures.has(key))return false;exposures.add(key);return true;},
    getPlayer:id=>players.get(id)||{id,nickname:`שחקן ${id}`},
  };
}
function fixture({repository=memoryRepository(),fixtureCatalog=catalog,at=Date.parse('2026-11-24T10:00:00Z')}={}){
  let clock=at,id=0;const now=()=>clock,idFactory=()=>`fixture-id-${++id}`;
  const service=createGameService({repository,catalog:fixtureCatalog,now,idFactory,dailySeed:'fixed-private-fixture-seed'});
  return {service,repository,now,idFactory,advance:ms=>{clock+=ms;},setTime:at=>{clock=at;}};
}
function finishRun(f,playerId,view,{offset=0,timeouts=false}={}){
  for(let i=view.roundIndex;i<5;i++){
    view=f.service.startRound(playerId,view.runId,{roundId:view.currentRound.id});
    const target=f.repository.getRun(view.runId).rounds[i].place.coordinates;
    if(timeouts){f.advance(30000);view=f.service.submitGuess(playerId,view.runId,{roundId:view.currentRound.id,coordinates:null});}
    else view=f.service.submitGuess(playerId,view.runId,{roundId:view.currentRound.id,coordinates:[target[0]+offset,target[1]],idempotencyKey:`${view.runId}-${i}`});
    if(i<4)view=f.service.nextRound(playerId,view.runId,{roundId:view.currentRound.id});
  }
  return view;
}
const code=expected=>error=>error.code===expected;

test('prepared and active DTOs reveal no answer coordinates, source IDs, future names or URLs',()=>{
  const f=fixture();let view=f.service.createPractice('alice');
  assert.equal(view.state,'prepared');assert.equal(view.currentRound.prompt,null);
  const prepared=JSON.stringify(view);
  for(const place of places){assert.ok(!prepared.includes(place.id));assert.ok(!prepared.includes(place.name));assert.ok(!prepared.includes(place.sourceUrl));}
  assert.equal(Object.hasOwn(view,'rounds'),false);
  view=f.service.startRound('alice',view.runId,{roundId:view.currentRound.id});
  assert.equal(view.state,'active');assert.ok(view.currentRound.prompt.name);
  assert.equal(view.currentRound.deadlineAt,null);
  const privateRun=f.repository.getRun(view.runId),active=JSON.stringify(view);
  for(const round of privateRun.rounds.slice(1)){assert.ok(!active.includes(round.place.name));assert.ok(!active.includes(round.place.id));}
  assert.ok(!active.includes('sourceUrl'));assert.ok(!active.includes('answerCoordinates'));
});

test('practice is untimed, validates both cell and play mask, persists guesses and reveals only committed answers',()=>{
  const sameCell=places.map((p,i)=>({...p,coordinates:[34.75+i*.008,32.06+i*.005]}));
  const f=fixture({fixtureCatalog:{...catalog,places:sameCell,dailyPlaces:sameCell}});
  let view=f.service.createPractice('alice');view=f.service.startRound('alice',view.runId,{roundId:view.currentRound.id});
  f.advance(24*60*60*1000);assert.equal(f.service.getRun('alice',view.runId).state,'active');
  assert.throws(()=>f.service.saveDraft('alice',view.runId,{coordinates:[35.5,32.06]}),code('GUESS_OUTSIDE_ALLOWED_AREA'));
  assert.throws(()=>f.service.saveDraft('alice',view.runId,{coordinates:[34.72,32.07]}),code('GUESS_OUTSIDE_ALLOWED_AREA'));
  assert.throws(()=>f.service.submitGuess('alice',view.runId,{coordinates:[NaN,32]}),code('GUESS_REQUIRED'));
  const target=f.repository.getRun(view.runId).rounds[0].place.coordinates;
  view=f.service.saveDraft('alice',view.runId,{roundId:view.currentRound.id,coordinates:target,sequence:2});
  f.service.saveDraft('alice',view.runId,{roundId:view.currentRound.id,coordinates:[target[0]+.001,target[1]],sequence:1});
  assert.deepEqual(f.service.getRun('alice',view.runId).currentRound.draftGuess,target);
  view=f.service.submitGuess('alice',view.runId,{roundId:view.currentRound.id,coordinates:target,idempotencyKey:'first'});
  assert.equal(view.state,'round_result');assert.equal(view.results[0].score,100);
  assert.deepEqual(view.results[0].answer.coordinates,target);
  assert.equal(view.results[0].centerDistanceMeters,0);assert.equal(view.results[0].edgeDistanceMeters,0);
  assert.equal(f.repository.getRun(view.runId).rounds[0].attempt.score,100);
});

test('daily selection is shared, region-diverse, frozen across catalog updates and one run per player/day',()=>{
  const f=fixture();const alice=f.service.getDaily('alice'),bob=f.service.getDaily('bob');
  const a=f.repository.getRun(alice.runId),b=f.repository.getRun(bob.runId);
  assert.deepEqual(a.rounds.map(r=>r.place.id),b.rounds.map(r=>r.place.id));
  assert.equal(new Set(a.rounds.map(r=>gridCell(r.place.coordinates,'hard').id)).size,5);
  assert.equal(f.service.getDaily('alice').runId,alice.runId);
  const replacement=createGameService({repository:f.repository,catalog:{...catalog,snapshotId:'changed',places:places.map(p=>({...p,name:'שם שונה'})),dailyPlaces:[]},now:f.now,idFactory:f.idFactory});
  const c=replacement.getDaily('carol'),stored=f.repository.getRun(c.runId);
  assert.deepEqual(stored.rounds.map(r=>r.place.name),a.rounds.map(r=>r.place.name));
  assert.equal(stored.catalogSnapshotId,a.catalogSnapshotId);
  const done=finishRun(f,'alice',alice);assert.equal(done.status,'completed');
  assert.equal(f.service.getDaily('alice').runId,alice.runId);
});

test('daily timer starts only on prompt issue, refresh never resets it, and saved draft wins on timeout',()=>{
  const f=fixture();let view=f.service.getDaily('alice');f.advance(60000);
  assert.equal(f.service.getRun('alice',view.runId).currentRound.deadlineAt,null);
  view=f.service.startRound('alice',view.runId,{roundId:view.currentRound.id});
  const deadline=view.currentRound.deadlineAt,target=f.repository.getRun(view.runId).rounds[0].place.coordinates;
  assert.equal(deadline-f.now(),30000);
  f.service.saveDraft('alice',view.runId,{roundId:view.currentRound.id,coordinates:target});f.advance(15000);
  assert.equal(f.service.startRound('alice',view.runId).currentRound.deadlineAt,deadline);
  const restarted=createGameService({repository:f.repository,catalog,now:f.now,idFactory:f.idFactory});
  assert.deepEqual(restarted.getRun('alice',view.runId).currentRound.draftGuess,target);
  f.advance(15000);view=restarted.getRun('alice',view.runId);
  assert.equal(view.state,'round_result');assert.equal(view.results[0].outcome,'auto_submitted');
  assert.equal(view.results[0].score,100);assert.equal(view.results[0].answer,null);
  assert.equal(f.repository.getRun(view.runId).rounds[0].attempt.finalizedAt,deadline);
});

test('no-marker timeout scores zero, late coordinates cannot change it, and no future daily answers leak',()=>{
  const f=fixture();let view=f.service.getDaily('alice');view=f.service.startRound('alice',view.runId);
  const target=f.repository.getRun(view.runId).rounds[0].place.coordinates;f.advance(30000);
  view=f.service.submitGuess('alice',view.runId,{coordinates:target});
  assert.equal(view.results[0].score,0);assert.equal(view.results[0].outcome,'timeout');assert.equal(view.results[0].guessCoordinates,null);
  assert.equal(view.results[0].centerDistanceMeters,null);assert.equal(view.results[0].answer,null);
  assert.throws(()=>f.service.leaderboard('alice'),code('DAILY_NOT_COMPLETED'));
  view=f.service.nextRound('alice',view.runId,{roundId:view.currentRound.id});
  assert.equal(view.currentRound.prompt,null);assert.equal(view.currentRound.deadlineAt,null);
  assert.ok(!JSON.stringify(view).includes('sourceUrl'));
});

test('guess commits are idempotent across rounds and stale round tokens cannot mutate the next round',()=>{
  const f=fixture();let view=f.service.createPractice('alice');view=f.service.startRound('alice',view.runId);
  const firstId=view.currentRound.id,target=f.repository.getRun(view.runId).rounds[0].place.coordinates;
  view=f.service.submitGuess('alice',view.runId,{roundId:firstId,coordinates:target,idempotencyKey:'same-request'});
  f.service.submitGuess('alice',view.runId,{roundId:firstId,coordinates:[target[0]+.002,target[1]],idempotencyKey:'same-request'});
  view=f.service.nextRound('alice',view.runId,{roundId:firstId});view=f.service.startRound('alice',view.runId,{roundId:view.currentRound.id});
  const replay=f.service.submitGuess('alice',view.runId,{roundId:firstId,coordinates:target,idempotencyKey:'same-request'});
  assert.equal(replay.roundIndex,1);assert.equal(replay.results.length,1);assert.equal(replay.state,'active');
  assert.throws(()=>f.service.saveDraft('alice',view.runId,{roundId:firstId,coordinates:target}),code('STALE_ROUND'));
  assert.equal(f.repository.getRun(view.runId).rounds[1].attempt.finalizedAt,null);
});

test('completed daily reveals five answers and produces tied ranks, score histogram and own marker',()=>{
  const f=fixture();const a=finishRun(f,'alice',f.service.getDaily('alice'));
  finishRun(f,'bob',f.service.getDaily('bob'));finishRun(f,'carol',f.service.getDaily('carol'),{timeouts:true});
  assert.equal(a.totalScore,500);assert.ok(a.results.every(result=>result.answer?.coordinates.length===2));
  const board=f.service.leaderboard('alice');assert.equal(board.participants,3);
  assert.deepEqual(board.entries.map(e=>e.rank),[1,1,3]);assert.equal(board.own.tiedCount,2);
  assert.equal(board.own.percentile,null);assert.equal(board.own.sampleSize,2);
  assert.equal(board.histogram.find(b=>b.min===500).count,2);assert.equal(board.histogram.find(b=>b.min===0).count,1);
  assert.equal(board.histogram.filter(b=>b.isOwnBin).length,1);assert.equal(board.histogram.find(b=>b.isOwnBin).min,500);
  assert.ok(board.entries.every(row=>!Object.hasOwn(row,'playerId')));assert.ok(!Object.hasOwn(board.own,'playerId'));
});

test('leaderboard returns top50 plus a complete own row while ranks and histogram cover every participant',()=>{
  const f=fixture();for(let i=0;i<60;i++)finishRun(f,`ranked-${i}`,f.service.getDaily(`ranked-${i}`));
  finishRun(f,'outside-top50',f.service.getDaily('outside-top50'),{timeouts:true});
  const board=f.service.leaderboard('outside-top50');
  assert.equal(board.participants,61);assert.equal(board.entries.length,50);assert.ok(board.entries.every(row=>!row.isYou));
  assert.equal(board.own.rank,61);assert.equal(board.own.totalScore,0);assert.equal(board.own.isYou,true);assert.equal(board.own.nickname,'שחקן outside-top50');
  assert.equal(board.own.sampleSize,60);assert.equal(board.own.percentile,0);assert.equal(board.own.tiedCount,1);
  assert.ok(board.entries.every(row=>row.rank===1&&row.tiedCount===60&&!Object.hasOwn(row,'playerId')));
  assert.equal(board.histogram.reduce((sum,bin)=>sum+bin.count,0),61);
  assert.equal(board.histogram.find(bin=>bin.min===500).count,60);assert.equal(board.histogram.find(bin=>bin.min===0).count,1);
  assert.equal(board.histogram.find(bin=>bin.isOwnBin).min,0);assert.equal(board.minSampleSize,30);
});

test('overall expiry finalizes unseen rounds without inventing per-place attempts',()=>{
  const f=fixture();const initial=f.service.getDaily('alice');f.advance(10*60*1000);
  const view=f.service.getRun('alice',initial.runId);assert.equal(view.status,'completed');assert.equal(view.results.length,5);
  assert.ok(view.results.every(r=>r.outcome==='unseen'));assert.equal(view.totalScore,0);
  assert.ok(f.repository.getRun(view.runId).rounds.every(r=>r.attempt===null));
  assert.equal(f.service.bootstrap('alice').activeRuns.length,0);
});

test('first-attempt comparable statistics use 30 distinct other players and strict-better ties',()=>{
  const f=fixture();const runs=[];
  for(let i=0;i<31;i++)runs.push(finishRun(f,`p${i}`,f.service.createPractice(`p${i}`),{offset:i>15?.001:0}));
  const stats=f.service.placeStatistics('p0',runs[0].runId);
  assert.ok(stats.rounds.every(r=>r.sampleSize===30&&r.status==='ready'&&r.percentile===50));
  finishRun(f,'p1',f.service.createPractice('p1'),{offset:.002});
  finishRun(f,'different-mode',f.service.createPractice('different-mode',{mode:'easy'}));
  finishRun(f,'different-pool',f.service.createPractice('different-pool',{collection:'all'}));
  const after=f.service.placeStatistics('p0',runs[0].runId);
  assert.ok(after.rounds.every(r=>r.sampleSize===30&&r.percentile===50));
  const stored=f.repository.listRuns({playerId:'p1'}).flatMap(r=>r.rounds.map(x=>x.attempt));
  assert.equal(stored.filter(a=>a.firstExposure).length,5);
});

test('statistics stay in warmup below 30 and daily statistics are hidden until completion',()=>{
  const f=fixture();const initial=f.service.createPractice('alice');assert.deepEqual(f.service.placeStatistics('alice',initial.runId).rounds,[]);
  const daily=f.service.getDaily('daily-player');assert.throws(()=>f.service.placeStatistics('daily-player',daily.runId),code('RUN_NOT_COMPLETED'));
  const done=finishRun(f,'alice',initial),stats=f.service.placeStatistics('alice',done.runId);
  assert.ok(stats.rounds.every(r=>r.sampleSize===0&&r.percentile===null&&r.status==='warming_up'));
  assert.equal(strictBetterPercentile(0,Array(30).fill(0)),0);
  assert.equal(strictBetterPercentile(0,Array(30).fill(1)),100);
  assert.equal(strictBetterPercentile(0,Array(29).fill(1)),null);
  assert.equal(strictBetterPercentile(500,Array(30).fill(500),{higherIsBetter:true}),0);
});

test('practice feedback exposes only finalized rounds while future target names remain hidden',()=>{
  const f=fixture();let view=f.service.createPractice('alice');view=f.service.startRound('alice',view.runId);
  const stored=f.repository.getRun(view.runId),target=stored.rounds[0].place.coordinates;
  view=f.service.submitGuess('alice',view.runId,{coordinates:target});
  const stats=f.service.statistics('alice',view.runId);assert.equal(stats.rounds.length,1);assert.equal(stats.rounds[0].roundIndex,0);
  assert.equal(stats.rounds[0].name,stored.rounds[0].place.name);assert.equal(stats.rounds[0].sampleSize,0);
  for(const round of stored.rounds.slice(1))assert.ok(!JSON.stringify(stats).includes(round.place.name));
});

test('a private daily seed keeps selection deterministic without exposing the seed in DTOs',()=>{
  const first=fixture(),second=fixture();
  const a=first.service.getDaily('alice'),b=second.service.getDaily('bob');
  assert.deepEqual(first.repository.getRun(a.runId).rounds.map(r=>r.place.id),second.repository.getRun(b.runId).rounds.map(r=>r.place.id));
  assert.ok(!JSON.stringify(a).includes('fixed-private-fixture-seed'));
  assert.ok(!JSON.stringify(first.repository.getDailyChallenge(a.dayKey)).includes('fixed-private-fixture-seed'));
});

test('Israel calendar boundaries use timezone midnight rather than a fixed 24-hour day',()=>{
  const normal=israelDayWindow('2026-11-24');assert.equal(israelDayKey(normal.opensAt),'2026-11-24');assert.equal(israelDayKey(normal.closesAt),'2026-11-25');
  assert.equal(israelDayKey(normal.opensAt-1),'2026-11-23');
  assert.equal(israelDayWindow('2026-03-27').closesAt-israelDayWindow('2026-03-27').opensAt,23*60*60*1000);
  assert.equal(israelDayWindow('2026-10-25').closesAt-israelDayWindow('2026-10-25').opensAt,25*60*60*1000);
  assert.throws(()=>israelDayWindow('2026-02-30'),code('INVALID_DAY'));
});

test('ownership and requested practice settings are validated server-side',()=>{
  const business={...places[0],id:'business',revisionId:'business-rev',name:'עסק בדיקה',poolGroup:'businesses'};
  const f=fixture({fixtureCatalog:{...catalog,places:[...places,business]}});
  const view=f.service.createPractice('alice');assert.throws(()=>f.service.getRun('bob',view.runId),code('RUN_NOT_FOUND'));
  assert.throws(()=>f.service.createPractice('alice',{mode:'unknown'}),code('INVALID_MODE'));
  assert.throws(()=>f.service.createPractice('alice',{collection:'unknown'}),code('INVALID_COLLECTION'));
  const narrow=f.repository.getRun(view.runId);assert.ok(narrow.rounds.every(r=>r.place.id!=='business'));
});

test('incompatible active versions fail closed before scoring and do not block a new practice bootstrap',()=>{
  const f=fixture();let view=f.service.getDaily('alice');view=f.service.startRound('alice',view.runId);
  const target=f.repository.getRun(view.runId).rounds[0].place.coordinates;
  f.service.saveDraft('alice',view.runId,{coordinates:target});f.advance(30000);
  const newer=createGameService({repository:f.repository,catalog:{...catalog,mapVersion:'different-map'},now:f.now,idFactory:f.idFactory});
  assert.throws(()=>newer.getRun('alice',view.runId),code('VERSION_UNAVAILABLE'));
  assert.throws(()=>newer.getDaily('bob'),code('VERSION_UNAVAILABLE'));
  assert.equal(f.repository.getRun(view.runId).rounds[0].attempt.finalizedAt,null);
  const bootstrap=newer.bootstrap('alice');assert.equal(bootstrap.activeRuns.length,0);assert.equal(bootstrap.unavailableRuns.length,1);assert.equal(bootstrap.daily.status,'unavailable');
  assert.equal(newer.createPractice('alice').state,'prepared');
});

test('next Jerusalem day grants a new daily run while the prior day retains its original identity',()=>{
  const f=fixture();const first=f.service.getDaily('alice'),window=israelDayWindow(first.dayKey);
  f.setTime(window.closesAt+1);const next=f.service.getDaily('alice');
  assert.notEqual(next.runId,first.runId);assert.notEqual(next.dayKey,first.dayKey);
  assert.equal(f.repository.findDailyRun('alice',first.dayKey).id,first.runId);
});

test('real SQLite repository persists normalized server-computed attempts and first-exposure markers',async()=>{
  const {openRepository}=await import('../server/storage.mjs');
  let at=Date.parse('2026-11-24T10:00:00Z');const now=()=>at,repository=openRepository({filename:':memory:',now});
  try{
    const actor=repository.resolveSession(null).player.id,f=fixture({repository,at});
    const done=finishRun(f,actor,f.service.createPractice(actor));
    assert.equal(done.totalScore,500);
    const attempts=repository.listAttempts({playerId:actor});assert.equal(attempts.length,5);assert.ok(attempts.every(a=>a.firstExposure&&a.score===100&&a.finalizedAt!==null));
    const restarted=createGameService({repository,catalog,now:f.now,idFactory:f.idFactory});
    assert.equal(restarted.getRun(actor,done.runId).status,'completed');
    const second=restarted.createPractice(actor);restarted.startRound(actor,second.runId);
    assert.equal(repository.getRun(second.runId).rounds[0].attempt.firstExposure,false);
  }finally{repository.close();}
});
