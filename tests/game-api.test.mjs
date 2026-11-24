import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameApi,ApiError} from '../dist/game-api.mjs';

test('cookie transport uses the exact lifecycle endpoints and preserves server DTOs',async()=>{
  const calls=[];
  const api=createGameApi({fetchImpl:async(url,options)=>{calls.push({url,...options});return new Response(JSON.stringify({stage:'active',deadlineAt:123}),{headers:{'Content-Type':'application/json'}});}});
  assert.deepEqual(await api.bootstrap(),{stage:'active',deadlineAt:123});
  await api.startPractice({mode:'hard',collection:'all'});await api.startDaily();await api.resume('run/one');await api.prepareRound('r');await api.startRound('r');await api.saveDraft('r',[34.5,32]);await api.submitGuess('r',{coordinates:[34.5,32],idempotencyKey:'same-attempt'});await api.nextRound('r');await api.leaderboard({dayKey:'2026-11-24'});await api.runStatistics('r');await api.setNickname('שחקן בדיקה');
  assert.deepEqual(calls.map(c=>[c.method,c.url]),[['GET','/api/bootstrap'],['POST','/api/practice/start'],['POST','/api/daily/start'],['GET','/api/runs/run%2Fone'],['POST','/api/runs/r/prepare'],['POST','/api/runs/r/start'],['POST','/api/runs/r/draft'],['POST','/api/runs/r/guess'],['POST','/api/runs/r/next'],['GET','/api/leaderboard?day=2026-11-24'],['GET','/api/runs/r/statistics'],['POST','/api/profile']]);
  assert.ok(calls.every(c=>c.credentials==='same-origin'&&c.cache==='no-store'));
  assert.deepEqual(JSON.parse(calls[7].body),{coordinates:[34.5,32],idempotencyKey:'same-attempt'});
});
test('structured server rejection retains status/code and never retries a scored mutation',async()=>{
  let calls=0;const api=createGameApi({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{code:'round_expired',message:'פג הזמן',details:{stage:'committed'}}}),{status:409});}});
  await assert.rejects(api.submitGuess('r',{coordinates:[34,32]}),error=>error instanceof ApiError&&error.status===409&&error.code==='round_expired'&&error.details.stage==='committed');
  assert.equal(calls,1);
});
test('HTML fallback and network faults become explicit service errors',async()=>{
  const html=createGameApi({fetchImpl:async()=>new Response('<html>static fallback</html>')});
  await assert.rejects(html.bootstrap(),error=>error.code==='invalid_response');
  const missing=createGameApi({fetchImpl:async()=>new Response('Not found',{status:404})});
  await assert.rejects(missing.bootstrap(),error=>error.status===404);
  const network=createGameApi({fetchImpl:async()=>{throw new TypeError('offline');}});
  await assert.rejects(network.bootstrap(),error=>error.code==='network_error');
});
test('cancellation remains cancellation and timeout is distinguishable',async()=>{
  const fetchImpl=async(url,{signal})=>new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const api=createGameApi({fetchImpl,timeoutMs:5});
  await assert.rejects(api.bootstrap(),error=>error.code==='timeout');
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.bootstrap({signal:controller.signal}),error=>error.name==='AbortError');
});
test('invalid coordinate payloads are rejected before network IO',()=>{
  let calls=0;const api=createGameApi({fetchImpl:async()=>{calls++;return new Response('{}');}});
  assert.throws(()=>api.saveDraft('r',[Infinity,32]),/Coordinates/);
  assert.throws(()=>api.submitGuess('r',{coordinates:[181,32]}),/Coordinates/);
  assert.equal(calls,0);
});
test('round identity and draft ordering travel in mutation bodies rather than fetch options',async()=>{
  const calls=[];const api=createGameApi({fetchImpl:async(url,options)=>{calls.push({url,options});return new Response('{}');}});
  await api.startRound('run',{roundId:'round-1'});
  await api.saveDraft('run',[34,32],{roundId:'round-1',sequence:3});
  await api.submitGuess('run',{roundId:'round-1',coordinates:null,idempotencyKey:'retry-key'});
  await api.nextRound('run',{roundId:'round-1'});
  assert.deepEqual(calls.map(c=>JSON.parse(c.options.body)),[{roundId:'round-1'},{coordinates:[34,32],roundId:'round-1',sequence:3},{coordinates:null,idempotencyKey:'retry-key',roundId:'round-1'},{roundId:'round-1'}]);
  assert.ok(calls.every(c=>!('roundId' in c.options)&&!('sequence' in c.options)));
});
