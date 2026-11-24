import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerApiHandler} from '../server/worker-http.mjs';
import {openRepository} from '../server/storage.mjs';
import {createCatalog} from '../server/catalog.mjs';
import {gridCell,pointInHintCell} from '../dist/rules.mjs';
import {pointInPlayArea} from '../dist/imagery-loader.mjs';

function fixture(t,{basePath='/mappa',publicOrigin='https://yoavfried.com'}={}){
  const points=[[34.8,32.1],[35.1,32.5],[35.4,32.9],[34.8,31.2],[35,30.5]];
  const holeFor=cell=>[cell.west+.04,cell.south+.04];
  const holes=points.map(point=>{const [x,y]=holeFor(gridCell(point));return [[x-.002,y-.002],[x+.002,y-.002],[x+.002,y+.002],[x-.002,y+.002],[x-.002,y-.002]];});
  const playArea={type:'Polygon',coordinates:[[[34,29],[36,29],[36,34],[34,34],[34,29]],...holes]};
  const catalog=createCatalog({playArea,places:points.map((coordinates,index)=>({id:`osm/node/${index+1}`,name:`מוזיאון בדיקה ${index+1}`,category:'מוזיאון',coordinates,poolGroup:'landmarks',coordinateKind:'node',eligibleModes:['easy','normal','hard'],sourceUrl:`https://www.openstreetmap.org/node/${index+1}`,dataSource:'OpenStreetMap',dataLicense:'ODbL-1.0'}))});
  let clock=Date.parse('2026-11-24T10:00:00Z'),sessions=0;
  const repository=openRepository({filename:':memory:',now:()=>clock});t.after(()=>repository.close());
  const counted={...repository,resolveSession(token){sessions++;return repository.resolveSession(token);}};
  const handler=createWorkerApiHandler({repository:counted,catalog,now:()=>clock,basePath,publicOrigin});
  function browser(origin=publicOrigin){let cookie='';return {async request(path,{method='GET',body,headers={}}={}){
    const request=new Request(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const response=await handler(request);if(response.headers.get('Set-Cookie'))cookie=response.headers.get('Set-Cookie').split(';')[0];
    return {status:response.status,body:await response.json(),headers:response.headers};
  }};}
  return {handler,browser,catalog,repository,playArea,holeFor,advance:milliseconds=>{clock+=milliseconds;},get sessions(){return sessions;},api:`${basePath.replace(/\/+$/,'')}/api`};
}
async function ok(browser,path,body){const response=await browser.request(path,{method:body===undefined?'GET':'POST',body});assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}

test('Fetch health is stateless and bootstrap creates an HTTPS host-only cookie scoped to the game',async t=>{
  const f=fixture(t),health=await f.handler(new Request('https://yoavfried.com/mappa/api/health'));
  assert.equal(health.status,200);assert.equal(health.headers.get('Set-Cookie'),null);assert.deepEqual(await health.json(),{ok:true});assert.equal(f.sessions,0);
  const browser=f.browser(),boot=await browser.request('/mappa/api/bootstrap');assert.equal(boot.status,200);
  assert.match(boot.headers.get('Set-Cookie'),/; Path=\/mappa; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000$/);
  assert.doesNotMatch(boot.headers.get('Set-Cookie'),/Domain=/i);
  assert.equal(boot.headers.get('Cache-Control'),'no-store');assert.equal(boot.headers.get('Vary'),'Cookie');assert.equal(boot.headers.get('X-Content-Type-Options'),'nosniff');
  assert.doesNotMatch(JSON.stringify(boot.body),/session_hash|dailySeed|sourceUrl|coordinates/);
  const again=await ok(browser,'/mappa/api/bootstrap');assert.equal(again.player.id,boot.body.player.id);
});

test('unknown paths and invalid or oversized JSON never create sessions',async t=>{
  const f=fixture(t);
  const cases=[
    ['/api/bootstrap',{},404],['/mappa-other/api/bootstrap',{},404],['/mappa/api/unknown',{},404],['/mappa/api/%ZZ',{},400],
    ['/mappa/api/daily/start',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'},415],
    ['/mappa/api/daily/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},400],
    ['/mappa/api/daily/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'},400],
    ['/mappa/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'א'.repeat(9000)})},413],
    ['/mappa/api/profile',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'16385'},body:'{}'},413],
  ];
  for(const [path,options,status] of cases){const response=await f.handler(new Request('https://yoavfried.com'+path,options));assert.equal(response.status,status,path);assert.equal(response.headers.get('Set-Cookie'),null);}
  assert.equal(f.sessions,0);
});

test('POST origin matches exact configured or Request URL origins and ignores forwarded or Host claims',async t=>{
  const f=fixture(t);
  for(const headers of [
    {Origin:'https://evil.example'}, {Origin:'http://yoavfried.com'}, {Origin:'https://yoavfried.com:444'}, {Origin:'https://yoavfried.com/path'}, {Origin:'null'},
    {Origin:'https://evil.example',Host:'evil.example','X-Forwarded-Host':'evil.example',Forwarded:'host=evil.example;proto=https'},
    {Origin:'https://yoavfried.com','Sec-Fetch-Site':'cross-site'},
  ]){const response=await f.handler(new Request('https://yoavfried.com/mappa/api/daily/start',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'}));assert.equal(response.status,403);assert.equal(response.headers.get('Set-Cookie'),null);}
  assert.equal(f.sessions,0);
  const preview=f.browser('https://example.account.workers.dev');assert.equal((await preview.request('/mappa/api/daily/start',{method:'POST',body:{}})).status,200);
  const configured=await f.handler(new Request('https://example.account.workers.dev/mappa/api/practice/start',{method:'POST',headers:{Origin:'https://yoavfried.com','Content-Type':'application/json'},body:'{}'}));assert.equal(configured.status,200);
});

test('custom-prefix Fetch practice keeps prompts blind, enforces mask holes and calculates the score',async t=>{
  const f=fixture(t,{basePath:'/games/map/',publicOrigin:'https://preview.example'}),browser=f.browser(),other=f.browser();
  await ok(browser,f.api+'/bootstrap');await ok(browser,f.api+'/profile',{nickname:'כינוי בדיקה'});
  let run=await ok(browser,f.api+'/practice/start',{mode:'normal',collection:'landmarks'});
  assert.equal(run.currentRound.prompt,null);
  for(const place of f.catalog.places)for(const value of [place.id,place.name,place.sourceUrl])assert.ok(!JSON.stringify(run).includes(value));
  const route=suffix=>`${f.api}/runs/${run.runId}${suffix}`;
  run=await ok(browser,route('/start'),{roundId:run.currentRound.id});assert.doesNotMatch(JSON.stringify(run),/sourceUrl|coordinates/);
  const target=f.catalog.places.find(place=>place.name===run.currentRound.prompt.name).coordinates;
  const excluded=f.holeFor(run.currentRound.cell);assert.equal(pointInHintCell(excluded,run.currentRound.cell),true);assert.equal(pointInPlayArea(excluded,f.playArea),false);
  const bad=await browser.request(route('/draft'),{method:'POST',body:{roundId:run.currentRound.id,coordinates:excluded}});assert.equal(bad.status,400);assert.equal(bad.body.error.code,'GUESS_OUTSIDE_ALLOWED_AREA');
  run=await ok(browser,route('/guess'),{roundId:run.currentRound.id,coordinates:target,idempotencyKey:'first',score:0,totalScore:0});
  assert.equal(run.totalScore,100);assert.deepEqual(run.results[0].answer.coordinates,target);assert.equal(f.repository.listAttempts().length,1);
  assert.equal((await other.request(route(''))).status,404);
  assert.equal((await ok(browser,route('/statistics'))).rounds.length,1);
});

test('Fetch daily resumes one run, uses saved pins at deadlines, withholds answers and exposes the completed board',async t=>{
  const f=fixture(t),browser=f.browser();await ok(browser,f.api+'/bootstrap');
  let run=await ok(browser,f.api+'/daily/start',{}),runId=run.runId;
  assert.equal((await ok(browser,f.api+'/daily/start',{})).runId,runId);
  for(let index=0;index<5;index++){
    const route=suffix=>`${f.api}/runs/${runId}${suffix}`;
    run=await ok(browser,route('/start'),{roundId:run.currentRound.id});
    const target=f.catalog.places.find(place=>place.name===run.currentRound.prompt.name).coordinates;
    if(index===0){await ok(browser,route('/draft'),{roundId:run.currentRound.id,coordinates:target,sequence:1});f.advance(30000);run=await ok(browser,route(''));assert.equal(run.results[0].outcome,'auto_submitted');}
    else if(index===1){f.advance(30000);run=await ok(browser,route(''));assert.equal(run.results[1].score,0);}
    else run=await ok(browser,route('/guess'),{roundId:run.currentRound.id,coordinates:target,idempotencyKey:`daily-${index}`});
    if(index<4){assert.ok(run.results.every(result=>result.answer===null));assert.equal((await browser.request(f.api+'/leaderboard')).status,409);run=await ok(browser,route('/next'),{roundId:run.currentRound.id});}
  }
  assert.equal(run.status,'completed');assert.equal(run.totalScore,400);assert.ok(run.results.every(result=>result.answer?.coordinates));
  const board=await ok(browser,f.api+'/leaderboard?day='+run.dayKey);assert.equal(board.participants,1);assert.equal(board.own.totalScore,400);assert.equal(board.histogram.reduce((sum,bin)=>sum+bin.count,0),1);
  assert.doesNotMatch(JSON.stringify(board),/playerId|session_hash/);
});
