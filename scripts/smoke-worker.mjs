/** Development-only HTTP smoke: reads local answer fixtures, never browser code. */
import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const USAGE='node scripts/smoke-worker.mjs [--origin http://127.0.0.1:4174] [--base-path /mappa] [--catalog FILE] [--daily] [--state-file .data/worker-smoke.json] [--checkpoint]';
const inside=(base,path)=>{const part=relative(base,path);return part===''||!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};

async function targetFixture(filename){
  const source=await readFile(filename,'utf8');let document;
  if(filename.endsWith('.mjs')){
    // Parse the builder's lazy string literal; do not import it or hydrate all
    // catalog objects, recompute geometry, initialize SQLite, or execute code.
    const line=source.split('\n').find(value=>value.startsWith('const encoded = '));
    if(!line?.endsWith(';'))throw Error('Local compact catalog format is not recognized.');
    document=JSON.parse(JSON.parse(line.slice('const encoded = '.length,-1)));
  }else document=JSON.parse(source);
  let places;
  if(document.format==='satguess-private-worker-catalog'&&document.formatVersion===1){
    places=document.rows.map(row=>({name:row[2],category:document.categories[row[3]],coordinates:[row[4],row[5]],eligibleModes:['easy','normal','hard'].filter((_,index)=>row[9]&(1<<index))}));
  }else places=document.places;
  if(!Array.isArray(places)||places.length<5)throw Error('Local target fixture is missing or invalid.');
  const byPrompt=new Map();
  for(const place of places){const key=JSON.stringify([place.name,place.category]);if(!byPrompt.has(key))byPrompt.set(key,[]);byPrompt.get(key).push(place);}
  return view=>{
    const prompt=view.currentRound?.prompt,cell=view.currentRound?.cell;
    if(!prompt||!cell)throw Error('An active prompt is required to resolve a smoke fixture.');
    const matches=(byPrompt.get(JSON.stringify([prompt.name,prompt.category]))||[]).filter(place=>{
      const [x,y]=place.coordinates??[];
      return Number.isFinite(x)&&Number.isFinite(y)&&x>=cell.west&&x<cell.east&&y>=cell.south&&y<cell.north&&(!place.eligibleModes||place.eligibleModes.includes(view.mode));
    });
    if(matches.length!==1)throw Error('Active prompt does not uniquely match the local catalog; rebuild the fixture for this server version.');
    return [...matches[0].coordinates];
  };
}

export async function runWorkerSmoke({origin='http://127.0.0.1:4174',basePath='/mappa',catalogFile=resolve(ROOT,'.worker/catalog.mjs'),daily=false,stateFile,checkpoint=false}={}){
  const url=new URL(origin);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Provide an HTTP(S) origin without a path or credentials.');
  origin=url.origin;basePath=basePath.replace(/\/+$/,'');
  if(!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(basePath)&&basePath!=='')throw Error('Provide a literal game base path.');
  if(checkpoint&&!stateFile)throw Error('--checkpoint requires an ignored --state-file.');
  const api=basePath+'/api',dataDirectory=resolve(ROOT,'.data');
  const filename=stateFile?resolve(stateFile):null;
  if(filename&&!inside(dataDirectory,filename))throw Error('Smoke state must be stored inside the ignored project .data directory.');
  let state={version:1,origin,basePath},cookie='',saved=false,resumed=false,checks=0;
  const check=(condition,message)=>{if(!condition)throw Error(message);checks++;};
  if(filename){
    try{
      if((await lstat(filename)).isSymbolicLink())throw Error('Smoke state cannot be a symbolic link.');
      try{state=JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code)throw error;throw Error('Saved smoke state is invalid JSON.');}
      check(state.version===1&&state.origin===origin&&state.basePath===basePath,'Saved smoke state belongs to another origin or game path.');
      check(typeof state.cookie==='string'&&/^satguess_player_v1=[A-Za-z0-9_-]+$/.test(state.cookie),'Saved smoke identity is invalid.');cookie=state.cookie;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async function saveState(){
    if(!filename)return;state.cookie=cookie;
    await mkdir(dirname(filename),{recursive:true});
    const temporary=filename+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,filename);saved=true;
  }
  async function request(path,{body,expected=200,requestOrigin=origin,useCookie=true}={}){
    const method=body===undefined?'GET':'POST';
    const response=await fetch(origin+path,{method,redirect:'manual',headers:{Accept:'application/json',...(useCookie&&cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
    check(response.status===expected,`Unexpected HTTP status in ${method} smoke check: expected ${expected}, received ${response.status}.`);
    const setCookie=response.headers.get('set-cookie');
    if(expected===200&&setCookie){check(setCookie.includes(`; Path=${basePath||'/'};`)&&!/; Domain=/i.test(setCookie)&&/; HttpOnly/.test(setCookie)&&/; Secure/.test(setCookie)&&/; SameSite=Lax/.test(setCookie),'Identity cookie attributes are incomplete.');cookie=setCookie.split(';')[0];}
    const text=await response.text();let value;
    try{value=JSON.parse(text);}catch{if(expected===200)throw Error('API smoke received a non-JSON success response.');}
    return {value,response};
  }
  const {value:health,response:healthResponse}=await request(api+'/health',{useCookie:false});check(health?.ok===true,'Health response is not ready.');check(!healthResponse.headers.has('set-cookie'),'Health unexpectedly created an identity.');
  for(const path of ['/places.json','/PLACES.JSON','/.worker/catalog.mjs','/server/catalog.mjs','/.data/satguess.sqlite','/fonts%5c..%5cplaces.json','/fonts/%2e%2e%5cplaces.json'])await request(basePath+path,{expected:404,useCookie:false});
  const rejected=await request(api+'/profile',{body:{nickname:'smoke'},requestOrigin:'https://invalid-origin.example',expected:403,useCookie:false});check(!rejected.response.headers.has('set-cookie'),'Rejected origin unexpectedly created an identity.');
  const unknown=await request(api+'/not-a-route',{expected:404,useCookie:false});check(!unknown.response.headers.has('set-cookie'),'Unknown route unexpectedly created an identity.');
  const {value:bootstrap}=await request(api+'/bootstrap');check(Boolean(bootstrap?.player?.id),'Anonymous bootstrap is missing its local identity.');
  if(state.playerId)check(bootstrap.player.id===state.playerId,'Browser identity did not survive the server restart.');
  state.playerId=bootstrap.player.id;await saveState();
  const targetFor=await targetFixture(resolve(catalogFile));
  const route=(view,suffix='')=>`${api}/runs/${encodeURIComponent(view.runId)}${suffix}`;
  function checkStatistics(statistics,count){
    check(Array.isArray(statistics?.rounds)&&statistics.rounds.length===count,'Statistics do not match finalized rounds.');
    check(statistics.minSampleSize>=30,'Statistics minimum is below thirty.');
    for(const round of statistics.rounds){
      check(Number.isSafeInteger(round.sampleSize)&&round.sampleSize>=0,'Statistics sample size is invalid.');
      if(round.sampleSize<statistics.minSampleSize)check(round.percentile===null&&round.status==='warming_up','A small sample exposed a percentile.');
      else check(Number.isFinite(round.percentile)&&round.percentile>=0&&round.percentile<=100,'Ready statistics have no valid percentile.');
    }
  }
  async function finish(view,{isDaily=false}={}){
    while(view.status!=='completed'){
      if(view.state==='round_result'){view=(await request(route(view,'/next'),{body:{roundId:view.currentRound.id}})).value;continue;}
      if(view.state==='prepared'){
        check(view.currentRound.prompt===null,'Prepared round revealed a name.');
        view=(await request(route(view,'/prepare'),{body:{roundId:view.currentRound.id}})).value;
        view=(await request(route(view,'/start'),{body:{roundId:view.currentRound.id}})).value;
      }
      check(view.state==='active','Run did not enter an active round.');
      check(Boolean(view.currentRound.prompt?.name)&&Boolean(view.currentRound.prompt?.category),'Active round has no prompt.');
      const coordinates=targetFor(view),roundId=view.currentRound.id;
      if(isDaily)check(view.currentRound.deadlineAt-view.currentRound.startedAt===30000,'Daily deadline is not thirty seconds.');
      view=(await request(route(view,'/draft'),{body:{roundId,coordinates,sequence:1000000}})).value;
      if(checkpoint&&!isDaily){
        state.checkpoint={roundId,startedAt:view.currentRound.startedAt,deadlineAt:view.currentRound.deadlineAt,coordinates};await saveState();return view;
      }
      view=(await request(route(view,'/guess'),{body:{roundId,coordinates,idempotencyKey:randomUUID(),score:0,totalScore:0}})).value;
      check(view.results.at(-1)?.score===100,'A local exact-target guess did not receive one hundred points.');
      if(isDaily&&view.status!=='completed')check(view.results.every(result=>result.answer===null),'Daily answer was exposed before completion.');
      if(!isDaily){const statistics=(await request(route(view,'/statistics'))).value;checkStatistics(statistics,view.results.length);}
      await saveState();
    }
    check(view.results.length===5&&view.totalScore===500,'Perfect smoke run did not finish with five hundred points.');
    check(view.results.every(result=>Array.isArray(result.answer?.coordinates)&&result.answer?.sourceUrl),'Completed run is missing revealed source answers.');
    return view;
  }
  let practice;
  if(state.practiceRunId){practice=(await request(`${api}/runs/${encodeURIComponent(state.practiceRunId)}`)).value;resumed=true;}
  else{practice=(await request(api+'/practice/start',{body:{mode:'normal',collection:'landmarks'}})).value;state.practiceRunId=practice.runId;await saveState();}
  if(checkpoint&&practice.status==='completed'){practice=(await request(api+'/practice/start',{body:{mode:'normal',collection:'landmarks'}})).value;state.practiceRunId=practice.runId;await saveState();}
  check(practice.kind==='practice','Saved smoke run is not practice.');
  if(state.checkpoint){
    check(practice.state==='active'&&practice.currentRound.id===state.checkpoint.roundId,'Checkpoint did not resume its active round.');
    check(practice.currentRound.startedAt===state.checkpoint.startedAt&&practice.currentRound.deadlineAt===state.checkpoint.deadlineAt,'Checkpoint timing changed during restart.');
    check(JSON.stringify(practice.currentRound.draftGuess)===JSON.stringify(state.checkpoint.coordinates),'Checkpoint draft did not survive restart.');
    delete state.checkpoint;await saveState();
  }
  practice=await finish(practice);state.practiceCompleted=practice.status==='completed';await saveState();
  if(checkpoint)return {checks,practiceRounds:practice.results.length,dailyRounds:0,checkpointSaved:true,stateSaved:saved,resumed};
  checkStatistics((await request(route(practice,'/statistics'))).value,5);
  let dailyRounds=0;
  if(daily){
    let challenge=(await request(api+'/daily/start',{body:{}})).value;
    if(challenge.status!=='completed'){await request(api+'/leaderboard?day='+challenge.dayKey,{expected:409});await request(route(challenge,'/statistics'),{expected:409});}
    const repeated=(await request(api+'/daily/start',{body:{}})).value;check(repeated.runId===challenge.runId,'One browser received multiple daily runs.');
    challenge=await finish(challenge,{isDaily:true});dailyRounds=challenge.results.length;
    const board=(await request(api+'/leaderboard?day='+challenge.dayKey)).value;
    check(board.own?.totalScore===500&&board.participants>=1,'Completed daily result is absent from the leaderboard.');
    check(board.histogram.reduce((sum,bin)=>sum+bin.count,0)===board.participants,'Daily histogram does not match its sample.');
    checkStatistics((await request(route(challenge,'/statistics'))).value,5);
    state.dailyCompleted=true;await saveState();
  }
  return {checks,practiceRounds:practice.results.length,dailyRounds,checkpointSaved:false,stateSaved:saved,resumed};
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index++){
    if(args[index]==='--help'){console.log(USAGE);return;}
    if(args[index]==='--daily'){options.daily=true;continue;}
    if(args[index]==='--checkpoint'){options.checkpoint=true;continue;}
    const key={'--origin':'origin','--base-path':'basePath','--catalog':'catalogFile','--state-file':'stateFile'}[args[index]];
    if(!key||!args[index+1])throw Error(USAGE);options[key]=args[++index];
  }
  console.log(JSON.stringify(await runWorkerSmoke(options),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await main();}catch(error){console.error('Worker smoke failed: '+error.message);process.exitCode=1;}}
