import {createGameService} from './game-service.mjs';

const WORKER_COOKIE='satguess_player_v1';
const WORKER_BODY_LIMIT=16384;
const workerFailure=(status,code,message)=>Object.assign(Error(message),{status,code});
function workerBasePath(value){
  if(typeof value!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(value)&&value!=='')throw new TypeError('basePath must be a literal absolute path.');
  return value.replace(/\/+$/,'');
}
function workerOrigin(value){
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new TypeError('publicOrigin must contain only an HTTP(S) origin.');
  return url.origin;
}
function workerSameOrigin(request,url,publicOrigin){
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return false;
  const origin=request.headers.get('Origin');
  return origin===null||origin===publicOrigin||origin===url.origin;
}
function workerCookieToken(request){
  return (request.headers.get('Cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(WORKER_COOKIE+'='))?.slice(WORKER_COOKIE.length+1);
}
async function workerJsonBody(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw workerFailure(415,'JSON_REQUIRED','יש לשלוח בקשת JSON.');
  if(Number(request.headers.get('Content-Length'))>WORKER_BODY_LIMIT)throw workerFailure(413,'BODY_TOO_LARGE','הבקשה גדולה מדי.');
  const chunks=[];let size=0;
  if(request.body){
    const reader=request.body.getReader();
    try{
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        if(!(value instanceof Uint8Array))throw workerFailure(400,'INVALID_JSON','הבקשה אינה תקינה.');
        size+=value.byteLength;
        if(size>WORKER_BODY_LIMIT){try{await reader.cancel();}catch{}throw workerFailure(413,'BODY_TOO_LARGE','הבקשה גדולה מדי.');}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
  }
  try{
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)||'{}');
    if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;
  }catch{throw workerFailure(400,'INVALID_JSON','הבקשה אינה תקינה.');}
}

/** Fetch API boundary; the caller owns repository lifetime, assets and routing. */
export function createWorkerApiHandler({repository,catalog,now=Date.now,publicOrigin='https://yoavfried.com',basePath='/mappa'}={}){
  if(!repository||!catalog)throw new TypeError('A repository and catalog are required.');
  const prefix=workerBasePath(basePath),origin=workerOrigin(publicOrigin),apiPrefix=prefix+'/api';
  const service=createGameService({repository,catalog,playArea:catalog.playArea,now,dailySeed:repository.getDailySeed?.()});
  const counts=Object.fromEntries(['easy','normal','hard'].map(mode=>{const places=catalog.placesForMode(mode);return [mode,{landmarks:places.filter(place=>place.poolGroup!=='businesses').length,all:places.length}];}));
  function reply(status,data,cookie){
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    if(cookie)headers.set('Set-Cookie',cookie);
    return new Response(JSON.stringify(data),{status,headers});
  }
  return async function handleWorkerApi(request){
    let cookie;
    try{
      const url=new URL(request.url);let pathname;
      try{pathname=decodeURIComponent(url.pathname);}catch{throw workerFailure(400,'INVALID_PATH','כתובת הבקשה אינה תקינה.');}
      if(pathname.includes('\\')||!pathname.startsWith(apiPrefix+'/'))throw workerFailure(404,'NOT_FOUND','העמוד המבוקש לא נמצא.');
      const path=pathname.slice(apiPrefix.length);
      if(request.method==='POST'&&!workerSameOrigin(request,url,origin))throw workerFailure(403,'ORIGIN_REJECTED','הבקשה אינה מאתר המשחק.');
      if(path==='/health'&&request.method==='GET')return reply(200,{ok:true});
      const match=/^\/runs\/([A-Za-z0-9_-]{1,160})(?:\/(prepare|start|draft|guess|next|statistics))?$/.exec(path);
      const methods={prepare:'prepareRound',start:'startRound',draft:'saveDraft',guess:'submitGuess',next:'nextRound'};
      const recognized=request.method==='GET'&&(['/bootstrap','/leaderboard'].includes(path)||match&&(!match[2]||match[2]==='statistics'))
        ||request.method==='POST'&&(['/profile','/practice/start','/daily/start'].includes(path)||match&&methods[match[2]]);
      if(!recognized)throw workerFailure(404,'NOT_FOUND','העמוד המבוקש לא נמצא.');
      const body=request.method==='POST'?await workerJsonBody(request):null;
      const session=repository.resolveSession(workerCookieToken(request)),player=session.player;
      cookie=`${WORKER_COOKIE}=${session.token}; Path=${prefix||'/'}; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000`;
      if(path==='/bootstrap')return reply(200,{...service.bootstrap(player.id),player,counts},cookie);
      if(path==='/profile')return reply(200,{player:repository.updateNickname(player.id,body.nickname)},cookie);
      if(path==='/practice/start')return reply(200,service.createPractice(player.id,body),cookie);
      if(path==='/daily/start')return reply(200,service.getDaily(player.id),cookie);
      if(path==='/leaderboard')return reply(200,service.leaderboard(player.id,{dayKey:url.searchParams.get('day')||undefined}),cookie);
      const [,id,action]=match;
      if(!action)return reply(200,service.getRun(player.id,id),cookie);
      if(action==='statistics')return reply(200,service.statistics(player.id,id),cookie);
      return reply(200,service[methods[action]](player.id,id,body),cookie);
    }catch(error){
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;
      if(status>=500)console.error('Worker game request failed:',error.code||error.name);
      return reply(status,{error:{code:status>=500?'INTERNAL_ERROR':error.code||'NOT_FOUND',message:status>=500?'שירות המשחק אינו זמין כרגע. נסו שוב.':error.message,...(status<500&&error.details?{details:error.details}:{})}},cookie);
    }
  };
}
