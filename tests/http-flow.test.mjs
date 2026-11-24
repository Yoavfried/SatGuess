import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApplication} from '../server/http.mjs';
import {createCatalog} from '../server/catalog.mjs';
import {haversineMeters} from '../dist/rules.mjs';

function fixtureCatalog(){
  return createCatalog({
    playArea:{type:'Polygon',coordinates:[[[34,29],[36,29],[36,34],[34,34],[34,29]]]},
    places:[[34.8,32.1],[35.1,32.5],[35.4,32.9],[34.8,31.2],[35,30.5]].map((coordinates,index)=>({
      id:`osm/node/${index+1}`,name:`מוזיאון בדיקה ${['אור','גליל','גולן','נגב','ערבה'][index]}`,
      category:'מוזיאון',coordinates,poolGroup:'landmarks',coordinateKind:'node',eligibleModes:['easy','normal','hard'],
      sourceUrl:`https://www.openstreetmap.org/node/${index+1}`,dataSource:'OpenStreetMap',dataLicense:'ODbL-1.0',
    })),
  });
}
async function fixture(t){
  const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..'),baseDirectory=join(workspace,'.data');
  mkdirSync(baseDirectory,{recursive:true});
  const directory=mkdtempSync(join(baseDirectory,'http-flow-')),databaseFile=join(directory,'game.sqlite');
  writeFileSync(join(directory,'index.html'),'<!doctype html><title>HTTP fixture</title>');
  const catalog=fixtureCatalog();let clock=Date.parse('2026-11-24T10:00:00Z'),application=null,base;
  async function open(){
    application=await createApplication({catalog,databaseFile,staticRoot:directory,now:()=>clock});
    await new Promise((resolveListening,reject)=>{application.server.once('error',reject);application.server.listen(0,'127.0.0.1',resolveListening);});
    base=`http://127.0.0.1:${application.server.address().port}`;
  }
  t.after(async()=>{
    if(application)await application.close();
    const target=realpathSync(directory);assert.equal(dirname(target),realpathSync(baseDirectory));assert.ok(basename(target).startsWith('http-flow-'));
    rmSync(target,{recursive:true,force:true});
  });
  await open();
  function browser(){
    let cookie='';
    return {get cookie(){return cookie;},async request(path,{method='GET',body}={}){
      const headers={Accept:'application/json',...(cookie?{Cookie:cookie}:{})};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(method==='POST')headers.Origin=base;
      const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
      return {status:response.status,body:await response.json(),headers:response.headers};
    }};
  }
  return {
    browser,catalog,now:()=>clock,advance:milliseconds=>{clock+=milliseconds;},
    get repository(){return application.repository;},
    async restart(){await application.close();application=null;await open();},
    targetFor:view=>catalog.places.find(place=>place.name===view.currentRound.prompt?.name)?.coordinates,
  };
}
async function ok(browser,path,body){const response=await browser.request(path,{method:body===undefined?'GET':'POST',body});assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
const runRoute=(run,suffix='')=>`/api/runs/${run.runId}${suffix}`;
function farLegalPoint(view,target){const c=view.currentRound.cell,epsilon=.000001;return [[c.west+epsilon,c.south+epsilon],[c.west+epsilon,c.north-epsilon],[c.east-epsilon,c.south+epsilon],[c.east-epsilon,c.north-epsilon]].sort((a,b)=>haversineMeters(b,target)-haversineMeters(a,target))[0];}
function assertPreparedIsBlind(view,catalog){
  assert.equal(view.currentRound.prompt,null);const serialized=JSON.stringify(view);
  for(const place of catalog.places)for(const value of [place.name,place.id,place.sourceUrl])assert.ok(!serialized.includes(value));
  assert.doesNotMatch(serialized,/sourceUrl|coordinates|dailySeed|session_hash/);
}

test('HTTP cookie identity and active practice survive SQLite restart; guesses cannot forge a score',async t=>{
  const f=await fixture(t),alice=f.browser(),other=f.browser();
  const initial=await alice.request('/api/bootstrap');assert.equal(initial.status,200);
  assert.match(initial.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(JSON.stringify(initial.body),/session_hash|dailySeed|coordinates|sourceUrl/);
  const playerId=initial.body.player.id,cookie=alice.cookie;
  await ok(alice,'/api/profile',{nickname:'שחקנית בדיקה'});
  let run=await ok(alice,'/api/practice/start',{mode:'normal',collection:'landmarks'});
  assertPreparedIsBlind(run,f.catalog);
  assert.deepEqual((await ok(alice,runRoute(run,'/statistics'))).rounds,[]);
  run=await ok(alice,runRoute(run,'/start'),{roundId:run.currentRound.id});
  const target=f.targetFor(run);assert.ok(target);assert.equal(run.currentRound.deadlineAt,null);
  await ok(alice,runRoute(run,'/draft'),{roundId:run.currentRound.id,coordinates:target,sequence:1});
  await f.restart();
  const boot=await ok(alice,'/api/bootstrap');
  assert.equal(alice.cookie,cookie);assert.equal(boot.player.id,playerId);assert.equal(boot.player.nickname,'שחקנית בדיקה');
  assert.ok(boot.activeRuns.some(active=>active.runId===run.runId));
  run=await ok(alice,runRoute(run));assert.deepEqual(run.currentRound.draftGuess,target);assert.equal(run.state,'active');
  const unauthorized=await other.request(runRoute(run));assert.equal(unauthorized.status,404);assert.equal(unauthorized.body.error.code,'RUN_NOT_FOUND');
  const input={roundId:run.currentRound.id,coordinates:farLegalPoint(run,target),idempotencyKey:'forged-client-score',score:100,totalScore:500,centerDistanceMeters:0};
  run=await ok(alice,runRoute(run,'/guess'),input);
  assert.equal(run.results[0].score,0);assert.equal(run.totalScore,0);assert.deepEqual(run.results[0].answer.coordinates,target);
  const repeated=await ok(alice,runRoute(run,'/guess'),input);assert.deepEqual(repeated.results,run.results);
  assert.equal(f.repository.listAttempts({playerId}).length,1);
  const statistics=await ok(alice,runRoute(run,'/statistics'));
  assert.equal(statistics.rounds.length,1);assert.equal(statistics.rounds[0].name,run.currentRound.prompt.name);assert.equal(statistics.rounds[0].percentile,null);
  assert.ok(f.catalog.places.filter(p=>p.name!==run.currentRound.prompt.name).every(p=>!JSON.stringify(statistics).includes(p.name)));
});

test('two HTTP browsers share a daily challenge with withheld answers, durable single attempts and a real leaderboard',async t=>{
  const f=await fixture(t),alice=f.browser(),bob=f.browser();
  const aProfile=await ok(alice,'/api/bootstrap'),bProfile=await ok(bob,'/api/bootstrap');assert.notEqual(aProfile.player.id,bProfile.player.id);
  let a=await ok(alice,'/api/daily/start',{}),b=await ok(bob,'/api/daily/start',{});
  assert.notEqual(a.runId,b.runId);assertPreparedIsBlind(a,f.catalog);assertPreparedIsBlind(b,f.catalog);
  assert.equal((await ok(alice,'/api/daily/start',{})).runId,a.runId);
  assert.equal((await bob.request(runRoute(a))).status,404);
  assert.equal((await alice.request('/api/leaderboard')).status,409);
  assert.equal((await alice.request(runRoute(a,'/statistics'))).status,409);
  const aNames=[],bNames=[];
  for(let index=0;index<5;index++){
    a=await ok(alice,runRoute(a,'/start'),{roundId:a.currentRound.id});b=await ok(bob,runRoute(b,'/start'),{roundId:b.currentRound.id});
    aNames.push(a.currentRound.prompt.name);bNames.push(b.currentRound.prompt.name);
    assert.equal(a.currentRound.deadlineAt-a.currentRound.startedAt,30000);
    assert.doesNotMatch(JSON.stringify(a),/sourceUrl|placeRevisionId/);
    const target=f.targetFor(a);
    a=await ok(alice,runRoute(a,'/guess'),{roundId:a.currentRound.id,coordinates:target,idempotencyKey:`alice-${index}`,score:0});
    b=await ok(bob,runRoute(b,'/guess'),{roundId:b.currentRound.id,coordinates:farLegalPoint(b,target),idempotencyKey:`bob-${index}`,score:100,totalScore:500});
    if(index<4){
      assert.ok(a.results.every(result=>result.answer===null));assert.ok(b.results.every(result=>result.answer===null));
      assert.equal((await alice.request(runRoute(a,'/statistics'))).status,409);
      a=await ok(alice,runRoute(a,'/next'),{roundId:a.currentRound.id});b=await ok(bob,runRoute(b,'/next'),{roundId:b.currentRound.id});
      assert.equal(a.currentRound.prompt,null);assert.equal(b.currentRound.prompt,null);
    }
  }
  assert.deepEqual(aNames,bNames);assert.equal(new Set(aNames).size,5);
  assert.equal(a.status,'completed');assert.equal(a.totalScore,500);assert.equal(b.totalScore,0);
  assert.ok(a.results.every(result=>result.answer?.coordinates&&result.answer.sourceUrl));
  assert.equal((await ok(alice,'/api/daily/start',{})).runId,a.runId);
  const board=await ok(alice,`/api/leaderboard?day=${a.dayKey}`);
  assert.equal(board.participants,2);assert.equal(board.own.rank,1);assert.equal(board.own.totalScore,500);assert.equal(board.own.percentile,null);
  assert.equal(board.entries.find(row=>row.isYou).totalScore,500);
  assert.doesNotMatch(JSON.stringify(board),/playerId|session_hash|sessionToken/);
  assert.equal(board.histogram.reduce((sum,bin)=>sum+bin.count,0),2);
  assert.equal(board.histogram.find(bin=>bin.min===500).count,1);assert.equal(board.histogram.find(bin=>bin.min===0).count,1);
  const statistics=await ok(alice,runRoute(a,'/statistics'));assert.equal(statistics.rounds.length,5);
  assert.ok(statistics.rounds.every(round=>round.sampleSize===1&&round.percentile===null&&round.status==='warming_up'));
});

test('HTTP daily deadlines survive restart and settle saved pins or no-pin zeroes using server time',async t=>{
  const f=await fixture(t),browser=f.browser();await ok(browser,'/api/bootstrap');
  let run=await ok(browser,'/api/daily/start',{});run=await ok(browser,runRoute(run,'/start'),{roundId:run.currentRound.id});
  const firstDeadline=run.currentRound.deadlineAt,target=f.targetFor(run);
  const initialPin=farLegalPoint(run,target);
  await ok(browser,runRoute(run,'/draft'),{roundId:run.currentRound.id,coordinates:initialPin,sequence:2});
  f.advance(15000);await f.restart();
  run=await ok(browser,runRoute(run));assert.equal(run.currentRound.deadlineAt,firstDeadline);assert.deepEqual(run.currentRound.draftGuess,initialPin);
  assert.equal(run.currentRound.draftSequence,2);
  // A freshly reloaded client continues the persisted sequence before moving its pin.
  run=await ok(browser,runRoute(run,'/draft'),{roundId:run.currentRound.id,coordinates:target,sequence:run.currentRound.draftSequence+1});
  assert.deepEqual(run.currentRound.draftGuess,target);assert.equal(run.currentRound.draftSequence,3);
  f.advance(15000);run=await ok(browser,runRoute(run));
  assert.equal(run.state,'round_result');assert.equal(run.results[0].outcome,'auto_submitted');assert.equal(run.results[0].score,100);assert.equal(run.results[0].answer,null);assert.deepEqual(run.results[0].guessCoordinates,target);
  assert.equal(f.repository.listAttempts()[0].finalizedAt,firstDeadline);
  run=await ok(browser,runRoute(run,'/next'),{roundId:run.currentRound.id});run=await ok(browser,runRoute(run,'/start'),{roundId:run.currentRound.id});
  const secondDeadline=run.currentRound.deadlineAt,secondTarget=f.targetFor(run),roundId=run.currentRound.id;
  f.advance(30000);
  run=await ok(browser,runRoute(run,'/guess'),{roundId,coordinates:secondTarget,idempotencyKey:'late-forged-perfect',score:100,totalScore:500,deadlineAt:f.now()+999999});
  assert.equal(run.results[1].outcome,'timeout');assert.equal(run.results[1].score,0);assert.equal(run.results[1].guessCoordinates,null);assert.equal(run.totalScore,100);
  assert.equal(f.repository.listAttempts().find(attempt=>attempt.roundIndex===1).finalizedAt,secondDeadline);
  const repeated=await ok(browser,runRoute(run));assert.deepEqual(repeated.results,run.results);assert.equal(f.repository.listAttempts().length,2);
});
