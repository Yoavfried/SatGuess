/** Cookie-based, same-origin API transport. Answers and scores stay server-owned. */
export class ApiError extends Error {
  constructor(message,{status=0,code='request_failed',details=null,retryAfterSeconds=null,cause}={}){
    super(message,cause?{cause}:undefined);this.name='ApiError';this.status=status;this.code=code;this.details=details;this.retryAfterSeconds=retryAfterSeconds;
  }
}

function apiRunId(value){
  if(typeof value!=='string'||!value.trim()||value.length>160)throw new TypeError('A run ID is required.');
  return encodeURIComponent(value);
}
function apiCoordinates(value){
  if(value===null||value===undefined)return value;
  if(!Array.isArray(value)||value.length!==2||!value.every(Number.isFinite)||Math.abs(value[0])>180||Math.abs(value[1])>90)throw new TypeError('Coordinates must be a finite [longitude, latitude] pair.');
  return [...value];
}
export function createGuessKey(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  if(!globalThis.crypto?.getRandomValues)throw new Error('Secure random IDs are unavailable.');
  return [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function createGameApi({baseUrl='/api',fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('A fetch implementation is required.');
  const base=String(baseUrl).replace(/\/+$/,'');
  async function request(path,{method='GET',body,signal}={}){
    const controller=new AbortController();
    let timedOut=false;
    const abort=()=>controller.abort(signal.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=Number.isFinite(timeoutMs)&&timeoutMs>0?setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs):null;
    try{
      const headers={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      const response=await fetchImpl(base+path,{method,headers,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=response.status===204?'':await response.text();
      let data=null;
      if(text){try{data=JSON.parse(text);}catch{
        if(response.ok)throw new ApiError('שירות המשחק החזיר תשובה לא תקינה.',{status:response.status,code:'invalid_response'});
      }}
      if(!response.ok){
        const error=data?.error;
        const code=typeof error==='string'?error:error?.code??data?.code??'http_error';
        const message=error?.message??data?.message??'שירות המשחק אינו זמין כרגע.';
        const retry=Number(response.headers?.get('Retry-After'));
        throw new ApiError(String(message),{status:response.status,code:String(code),details:error?.details??data?.details??null,retryAfterSeconds:Number.isFinite(retry)&&retry>0?retry:null});
      }
      if(data===null&&response.status!==204)throw new ApiError('שירות המשחק החזיר תשובה ריקה.',{status:response.status,code:'invalid_response'});
      return data;
    }catch(error){
      if(error instanceof ApiError)throw error;
      if(signal?.aborted)throw error;
      if(timedOut)throw new ApiError('הבקשה ארכה זמן רב מדי. אפשר לנסות שוב.',{code:'timeout',cause:error});
      throw new ApiError('לא הצלחנו להתחבר לשירות המשחק.',{code:'network_error',cause:error});
    }finally{if(timer!==null)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  const runPath=id=>`/runs/${apiRunId(id)}`;
  const post=(path,body,options={})=>request(path,{...options,method:'POST',body});
  const roundOptions=({roundId,...options}={})=>({body:roundId?{roundId}:{},options});
  return Object.freeze({
    bootstrap:(options={})=>request('/bootstrap',options),
    setNickname:(nickname,options={})=>post('/profile',{nickname},options),
    updateProfile:({nickname}={},options={})=>post('/profile',{nickname},options),
    startPractice:({mode='normal',collection='landmarks'}={},options={})=>post('/practice/start',{mode,collection},options),
    startDaily:(options={})=>post('/daily/start',{},options),
    resume:(runId,options={})=>request(runPath(runId),options),
    prepareRound:(runId,options={})=>post(`${runPath(runId)}/prepare`,{},options),
    startRound:(runId,input={})=>{const {body,options}=roundOptions(input);return post(`${runPath(runId)}/start`,body,options);},
    saveDraft:(runId,coordinates,{roundId,sequence,...options}={})=>{if(sequence!==undefined&&(!Number.isSafeInteger(sequence)||sequence<0))throw new TypeError('Draft sequence must be a non-negative integer.');return post(`${runPath(runId)}/draft`,{coordinates:apiCoordinates(coordinates),...(roundId?{roundId}:{}),...(sequence===undefined?{}:{sequence})},options);},
    submitGuess:(runId,{coordinates,idempotencyKey=createGuessKey(),roundId}={},options={})=>post(`${runPath(runId)}/guess`,{coordinates:apiCoordinates(coordinates)??null,idempotencyKey,...(roundId?{roundId}:{})},options),
    nextRound:(runId,input={})=>{const {body,options}=roundOptions(input);return post(`${runPath(runId)}/next`,body,options);},
    leaderboard:({dayKey}={},options={})=>request('/leaderboard'+(dayKey?'?'+new URLSearchParams({day:dayKey}):''),options),
    runStatistics:(runId,options={})=>request(`${runPath(runId)}/statistics`,options),
  });
}
