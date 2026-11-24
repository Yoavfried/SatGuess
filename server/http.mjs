import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {loadCatalog} from './catalog.mjs';
import {openRepository} from './storage.mjs';
import {createGameService} from './game-service.mjs';

const COOKIE='satguess_player_v1';
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.woff2':'font/woff2','.jpg':'image/jpeg'};
// A URL allowlist, rather than a filename denylist: case variations and decoded
// Windows separators must never turn an answer snapshot into a public asset.
const PUBLIC_ASSETS=new Map([
  ['/','index.html'],...['index.html','app.mjs','game-api.mjs','results-view.mjs','rules.mjs','imagery-loader.mjs','style.css','map-style.json','maplibre-gl.js','maplibre-gl.css','icon.svg','MAPLIBRE-LICENSE.txt','MAP-STYLE-LICENSE.md',
    'fonts/rubik-hebrew.woff2','fonts/rubik-latin.woff2','fonts/fredoka-hebrew.woff2','fonts/fredoka-latin.woff2'].map(file=>['/'+file,file]),
]);
const failure=(status,code,message)=>Object.assign(Error(message),{status,code});
function cookieToken(req){const pair=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));return pair?.slice(COOKIE.length+1);}
async function jsonBody(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw failure(415,'JSON_REQUIRED','יש לשלוח בקשת JSON.');
  if(Number(req.headers['content-length'])>16384)throw failure(413,'BODY_TOO_LARGE','הבקשה גדולה מדי.');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>16384)throw failure(413,'BODY_TOO_LARGE','הבקשה גדולה מדי.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;}
  catch{throw failure(400,'INVALID_JSON','הבקשה אינה תקינה.');}
}
function sameOrigin(req){
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  if(!req.headers.origin)return true;
  try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}
}

export async function createApplication({repository,catalog,now=Date.now,staticRoot=resolve('dist'),databaseFile,secureCookies=false,serviceOptions={}}={}){
  catalog??=await loadCatalog();
  const ownsRepository=!repository;
  repository??=openRepository({...(databaseFile?{filename:databaseFile}:{}),now});
  const service=createGameService({repository,catalog,playArea:catalog.playArea,now,dailySeed:repository.getDailySeed?.(),...serviceOptions});
  const counts=Object.fromEntries(['easy','normal','hard'].map(mode=>{const places=catalog.placesForMode(mode);return [mode,{landmarks:places.filter(p=>p.poolGroup!=='businesses').length,all:places.length}];}));
  const root=resolve(staticRoot);
  function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Cookie'});res.end(JSON.stringify(data));}
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    try{
      const url=new URL(req.url,'http://localhost');let path;
      try{path=decodeURIComponent(url.pathname);}catch{throw failure(400,'INVALID_PATH','כתובת הבקשה אינה תקינה.');}
      if(path.startsWith('/api/')){
        if(req.method==='POST'&&!sameOrigin(req))throw failure(403,'ORIGIN_REJECTED','הבקשה אינה מאתר המשחק.');
        if(path==='/api/health'&&req.method==='GET'){reply(res,200,{ok:true});return;}
        const match=/^\/api\/runs\/([A-Za-z0-9_-]{1,160})(?:\/(prepare|start|draft|guess|next|statistics))?$/.exec(path);
        const methods={prepare:'prepareRound',start:'startRound',draft:'saveDraft',guess:'submitGuess',next:'nextRound'};
        const recognized=req.method==='GET'&&(['/api/bootstrap','/api/leaderboard'].includes(path)||match&&(!match[2]||match[2]==='statistics'))
          ||req.method==='POST'&&(['/api/profile','/api/practice/start','/api/daily/start'].includes(path)||match&&methods[match[2]]);
        if(!recognized)throw failure(404,'NOT_FOUND','העמוד המבוקש לא נמצא.');
        const body=req.method==='POST'?await jsonBody(req):null;
        const session=repository.resolveSession(cookieToken(req)),player=session.player;
        res.setHeader('Set-Cookie',`${COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000${secureCookies?'; Secure':''}`);
        if(path==='/api/bootstrap'&&req.method==='GET'){reply(res,200,{...service.bootstrap(player.id),player,counts});return;}
        if(path==='/api/profile'&&req.method==='POST'){reply(res,200,{player:repository.updateNickname(player.id,body.nickname)});return;}
        if(path==='/api/practice/start'&&req.method==='POST'){reply(res,200,service.createPractice(player.id,body));return;}
        if(path==='/api/daily/start'&&req.method==='POST'){reply(res,200,service.getDaily(player.id));return;}
        if(path==='/api/leaderboard'&&req.method==='GET'){reply(res,200,service.leaderboard(player.id,{dayKey:url.searchParams.get('day')||undefined}));return;}
        if(match){
          const [,id,action]=match;
          if(!action&&req.method==='GET'){reply(res,200,service.getRun(player.id,id));return;}
          if(action==='statistics'&&req.method==='GET'){reply(res,200,service.statistics(player.id,id));return;}
          if(req.method==='POST'&&methods[action]){reply(res,200,service[methods[action]](player.id,id,body));return;}
        }
        throw failure(404,'NOT_FOUND','העמוד המבוקש לא נמצא.');
      }
      if(!['GET','HEAD'].includes(req.method))throw failure(405,'METHOD_NOT_ALLOWED','הפעולה אינה זמינה.');
      const asset=PUBLIC_ASSETS.get(path);
      if(!asset)throw failure(404,'NOT_FOUND','העמוד המבוקש לא נמצא.');
      const file=resolve(root,asset);
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){
      const status=error.status||(error.code==='ENOENT'||error.code==='ENOTDIR'?404:500);
      if(status>=500)console.error('Game request failed:',error.code||error.name);
      if(!res.headersSent)reply(res,status,{error:{code:status>=500?'INTERNAL_ERROR':error.code||'NOT_FOUND',message:status>=500?'שירות המשחק אינו זמין כרגע. נסו שוב.':error.message,...(error.details?{details:error.details}:{})}});
      else res.end();
    }
  });
  return {server,service,repository,catalog,async close(){if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));if(ownsRepository)repository.close();}};
}
