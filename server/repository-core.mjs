import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const hash=value=>createHash('sha256').update(value).digest('hex');
const parse=row=>row?JSON.parse(row.state_json||row.record_json):null;
const player=row=>row?{id:row.id,nickname:row.nickname,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const storageFailure=(code,message)=>Object.assign(Error(message),{code});
const identity=(value,keys)=>keys.map(key=>value[key]??null);
const runIdentityKeys=['id','playerId','kind','dayKey','createdAt','mode','collection','catalogSnapshotId','rulesVersion','mapVersion','timerVersion','challengeId','expiresAt'];
const attemptIdentityKeys=['id','runId','playerId','roundIndex','sourcePlaceId','placeRevisionId','cohortKey','kind','mode','collection','firstExposure','startedAt','deadlineAt'];
const roundSnapshots=run=>(run.rounds||[]).map(round=>({id:round.id,index:round.index,place:round.place,cell:round.cell}));

/** Shared synchronous repository logic; drivers provide SQL and atomic transactions. */
export function createRepository({driver,now=Date.now}={}){
  if(!driver||typeof driver.prepare!=='function'||typeof driver.transaction!=='function')throw new TypeError('A synchronous SQL driver is required.');
  const statements=new Map();
  const statement=sql=>{if(!statements.has(sql))statements.set(sql,driver.prepare(sql));return statements.get(sql);};
  let transactionDepth=0;
  const repo={
    transaction(fn){
      // Reject declared async callbacks before invocation; throwing after their
      // first await cannot cancel continuations that might write outside a lock.
      if(typeof fn!=='function'||fn.constructor.name==='AsyncFunction')throw Error('Repository transactions must be synchronous');
      const invoke=()=>{const value=fn();if(value&&typeof value.then==='function')throw Error('Repository transactions must be synchronous');return value;};
      if(transactionDepth)return invoke();
      return driver.transaction(()=>{transactionDepth++;try{return invoke();}finally{transactionDepth--;}});
    },
    getDailySeed(){return repo.transaction(()=>{
      let row=statement("SELECT value FROM private_metadata WHERE key='daily-selection-seed-v1'").get();
      if(!row){
        statement("INSERT INTO private_metadata(key,value) VALUES('daily-selection-seed-v1',?) ON CONFLICT(key) DO NOTHING").run(randomBytes(32).toString('hex'));
        row=statement("SELECT value FROM private_metadata WHERE key='daily-selection-seed-v1'").get();
      }
      if(!/^[a-f0-9]{64}$/.test(row.value))throw storageFailure('INVALID_PRIVATE_SEED','The private daily selection seed is invalid.');
      return row.value;
    });},
    resolveSession(token){
      if(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token)){
        const found=player(statement('SELECT * FROM players WHERE session_hash=?').get(hash(token)));
        if(found)return {player:found,token,isNew:false};
      }
      const freshToken=randomBytes(32).toString('base64url'),id=randomUUID(),at=now();
      const nickname=`שחקן ${id.replaceAll('-','').slice(0,5).toUpperCase()}`;
      statement('INSERT INTO players(id,session_hash,nickname,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,hash(freshToken),nickname,at,at);
      return {player:{id,nickname,createdAt:at,updatedAt:at},token:freshToken,isNew:true};
    },
    getPlayer(id){return player(statement('SELECT * FROM players WHERE id=?').get(id));},
    updateNickname(id,value){
      if(typeof value!=='string')throw Object.assign(Error('יש להזין כינוי.'),{status:400,code:'INVALID_NICKNAME'});
      const nickname=value.normalize('NFKC').trim().replace(/\s+/g,' ');
      if([...nickname].length<2||[...nickname].length>24||/[\p{Cc}\p{Cf}<>]/u.test(nickname))throw Object.assign(Error('הכינוי צריך להכיל 2–24 תווים, בלי סימני בקרה.'),{status:400,code:'INVALID_NICKNAME'});
      statement('UPDATE players SET nickname=?,updated_at=? WHERE id=?').run(nickname,now(),id);
      return repo.getPlayer(id);
    },
    getRun(id){return parse(statement('SELECT state_json FROM runs WHERE id=?').get(id));},
    saveRun(run){return repo.transaction(()=>{
      const previous=statement('SELECT state_json FROM runs WHERE id=?').get(run.id),state=JSON.stringify(run),at=now();
      if(previous?.state_json===state)return run;
      if(previous){
        const old=JSON.parse(previous.state_json),next=JSON.parse(state);
        if(isDeepStrictEqual(old,next))return run;
        if(!isDeepStrictEqual(identity(old,runIdentityKeys),identity(next,runIdentityKeys))||!isDeepStrictEqual(roundSnapshots(old),roundSnapshots(next)))throw storageFailure('RUN_SNAPSHOT_CONFLICT','A saved run identity and source snapshot cannot change.');
        if(old.status==='completed')throw storageFailure('RUN_FINALIZED','A completed run cannot be changed.');
      }
      statement(`INSERT INTO runs(id,player_id,kind,day_key,status,created_at,updated_at,state_json) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,state_json=excluded.state_json`).run(run.id,run.playerId,run.kind,run.dayKey||null,run.status,run.createdAt??at,at,state);
      for(const round of run.rounds||[]){
        const a=round.attempt;if(!a)continue;
        const record=JSON.stringify(a),old=statement('SELECT record_json FROM round_attempts WHERE id=?').get(a.id);
        if(a.playerId!==run.playerId||a.runId!==run.id||round.index!==undefined&&a.roundIndex!==round.index||round.place&&(a.sourcePlaceId!==round.place.id||a.placeRevisionId!==round.place.revisionId))throw storageFailure('ATTEMPT_SNAPSHOT_CONFLICT','An attempt must belong to its saved run and source snapshot.');
        if(old?.record_json===record)continue;
        if(old){
          const before=JSON.parse(old.record_json),after=JSON.parse(record);
          if(!isDeepStrictEqual(identity(before,attemptIdentityKeys),identity(after,attemptIdentityKeys)))throw storageFailure('ATTEMPT_SNAPSHOT_CONFLICT','A saved attempt identity and cohort cannot change.');
          if(before.finalizedAt!==null&&before.finalizedAt!==undefined&&!isDeepStrictEqual(before,after))throw storageFailure('ATTEMPT_FINALIZED','An accepted attempt cannot be changed.');
        }
        statement(`INSERT INTO round_attempts(id,run_id,player_id,round_index,source_place_id,place_revision_id,cohort_key,kind,mode,collection,first_exposure,started_at,deadline_at,finalized_at,guess_lng,guess_lat,center_distance_m,edge_distance_m,score,outcome,record_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET finalized_at=excluded.finalized_at,guess_lng=excluded.guess_lng,guess_lat=excluded.guess_lat,center_distance_m=excluded.center_distance_m,edge_distance_m=excluded.edge_distance_m,score=excluded.score,outcome=excluded.outcome,record_json=excluded.record_json`).run(a.id,run.id,run.playerId,a.roundIndex,a.sourcePlaceId,a.placeRevisionId,a.cohortKey,a.kind,a.mode,a.collection,a.firstExposure?1:0,a.startedAt,a.deadlineAt??null,a.finalizedAt??null,a.guessCoordinates?.[0]??null,a.guessCoordinates?.[1]??null,a.centerDistanceMeters??null,a.edgeDistanceMeters??null,a.score??null,a.outcome??null,record);
      }
      return run;
    });},
    findDailyRun(playerId,dayKey){return parse(statement("SELECT state_json FROM runs WHERE player_id=? AND day_key=? AND kind='daily'").get(playerId,dayKey));},
    listRuns(filters={}){
      const names={kind:'kind',dayKey:'day_key',playerId:'player_id',status:'status'},where=[],args=[];
      for(const [key,column] of Object.entries(names))if(filters[key]!==undefined){where.push(`${column}=?`);args.push(filters[key]);}
      return statement(`SELECT state_json FROM runs${where.length?' WHERE '+where.join(' AND '):''} ORDER BY created_at DESC,id`).all(...args).map(parse);
    },
    getDailyChallenge(dayKey){return parse(statement('SELECT state_json FROM daily_challenges WHERE day_key=?').get(dayKey));},
    saveDailyChallenge(challenge){
      const dayKey=challenge.dayKey||challenge.date;
      statement('INSERT INTO daily_challenges(day_key,id,state_json) VALUES(?,?,?) ON CONFLICT(day_key) DO NOTHING').run(dayKey,challenge.id,JSON.stringify(challenge));
      return repo.getDailyChallenge(dayKey);
    },
    markExposure(playerId,sourcePlaceId,at){return statement('INSERT INTO place_exposures(player_id,source_place_id,first_seen_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(playerId,sourcePlaceId,at).changes===1;},
    listAttempts(filters={}){
      const names={placeRevisionId:'place_revision_id',cohortKey:'cohort_key',playerId:'player_id'},where=[],args=[];
      for(const [key,column] of Object.entries(names))if(filters[key]!==undefined){where.push(`${column}=?`);args.push(filters[key]);}
      return statement(`SELECT record_json FROM round_attempts${where.length?' WHERE '+where.join(' AND '):''} ORDER BY started_at,id`).all(...args).map(parse);
    },
    close(){driver.close?.();},
  };
  return repo;
}
