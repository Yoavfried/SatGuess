import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createCloudflareRepository,CLOUDFLARE_SCHEMA_VERSION_KEY} from '../server/cloudflare-storage.mjs';

const schema=readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8');

/** Real SQLite with the synchronous DO cursor/transaction surface, not mocks of repo results. */
function simulatedDurableStorage(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');
  const calls=[],cursors=[];let transactions=0,depth=0;
  const cursor=(rows,rowsWritten=0)=>{
    const value={rowsWritten,consumed:false,toArray(){this.consumed=true;return rows;},[Symbol.iterator](){this.consumed=true;return rows[Symbol.iterator]();}};
    cursors.push(value);return value;
  };
  const storage={
    sql:{exec(sql,...bindings){
      assert.ok(cursors.every(value=>value.consumed),'consume SQL cursors before executing another statement');
      if(/\bPRAGMA\b|^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(sql))throw Error('DO SQL does not accept Node transaction/PRAGMA setup');
      calls.push(sql);
      if(!bindings.length&&(sql.match(/CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)/gi)||[]).length>1){db.exec(sql);return cursor([]);}
      const statement=db.prepare(sql);
      if(statement.columns().length)return cursor(statement.all(...bindings));
      const result=statement.run(...bindings);
      // Deliberately inflate the billing metric: affected rows must come from
      // changes(), not a count that can include index maintenance.
      return cursor([],Number(result.changes)*3);
    }},
    transactionSync(fn){
      assert.equal(depth,0,'repository core must coalesce nested transactions');transactions++;depth++;
      db.exec('BEGIN IMMEDIATE');
      try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}finally{depth--;}
    },
  };
  return {storage,db,calls,get transactions(){return transactions;},close:()=>db.close()};
}
function attempt(playerId){return {id:'attempt-1',runId:'run-1',playerId,roundIndex:0,sourcePlaceId:'source-1',placeRevisionId:'revision-1',cohortKey:'cohort-1',kind:'practice',mode:'normal',collection:'landmarks',firstExposure:true,startedAt:100,deadlineAt:null,finalizedAt:120,guessCoordinates:[34.8,32.1],centerDistanceMeters:25,edgeDistanceMeters:15,score:100,outcome:'submitted'};}
function run(playerId,{finalized=true}={}){const a=attempt(playerId);if(!finalized)Object.assign(a,{finalizedAt:null,guessCoordinates:null,centerDistanceMeters:null,edgeDistanceMeters:null,score:null,outcome:null});return {id:'run-1',playerId,kind:'practice',status:'in_progress',createdAt:100,mode:'normal',collection:'landmarks',rounds:[{id:'round-1',index:0,place:{id:'source-1',revisionId:'revision-1',name:'מקום בדיקה',coordinates:[34.8,32.1]},cell:{west:34.7,east:34.8,south:32.04,north:32.13},attempt:a}]};}

test('Durable Object adapter keeps session identity, private seed and normalized attempts across repository recreation',()=>{
  const fixture=simulatedDurableStorage();
  try{
    let repo=createCloudflareRepository({storage:fixture.storage,schema,now:()=>100});
    const session=repo.resolveSession(),seed=repo.getDailySeed();repo.updateNickname(session.player.id,'  שחקן   בדיקה  ');repo.saveRun(run(session.player.id));
    assert.equal(repo.markExposure(session.player.id,'source-1',100),true);
    assert.equal(repo.markExposure(session.player.id,'source-1',200),false);
    repo.close();repo=createCloudflareRepository({storage:fixture.storage,schema,now:()=>200});
    const resumed=repo.resolveSession(session.token);assert.equal(resumed.isNew,false);assert.equal(resumed.player.id,session.player.id);assert.equal(resumed.player.nickname,'שחקן בדיקה');
    assert.equal(repo.getDailySeed(),seed);assert.match(seed,/^[a-f0-9]{64}$/);
    assert.deepEqual(repo.listAttempts({placeRevisionId:'revision-1',cohortKey:'cohort-1'}),[attempt(session.player.id)]);
    assert.equal(fixture.db.prepare('SELECT value FROM private_metadata WHERE key=?').get(CLOUDFLARE_SCHEMA_VERSION_KEY).value,'1');
    assert.ok(fixture.calls.every(sql=>!/\bPRAGMA\b/i.test(sql)));
  }finally{fixture.close();}
});

test('nested repository writes share one DO transaction and rollback their exposure/run rows together',()=>{
  const fixture=simulatedDurableStorage();
  try{
    const repo=createCloudflareRepository({storage:fixture.storage,schema}),owner=repo.resolveSession().player.id,before=fixture.transactions;
    assert.throws(()=>repo.transaction(()=>{repo.getDailySeed();repo.markExposure(owner,'source-1',100);repo.saveRun(run(owner));throw Error('abort whole command');}),/abort whole command/);
    assert.equal(fixture.transactions-before,1);assert.equal(repo.getRun('run-1'),null);assert.equal(repo.listAttempts().length,0);
    assert.equal(repo.markExposure(owner,'source-1',200),true);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM private_metadata WHERE key='daily-selection-seed-v1'").get().n,0);
    let called=false;assert.throws(()=>repo.transaction(async()=>{called=true;}),/synchronous/);assert.equal(called,false);
  }finally{fixture.close();}
});

test('shared guards reject stale source snapshots and finalized score replays through the DO adapter',()=>{
  const fixture=simulatedDurableStorage();
  try{
    const repo=createCloudflareRepository({storage:fixture.storage,schema}),owner=repo.resolveSession().player.id;
    const original=run(owner);repo.saveRun(original);
    const moved=structuredClone(original);moved.rounds[0].place.coordinates=[34.9,32.2];
    assert.throws(()=>repo.saveRun(moved),{code:'RUN_SNAPSHOT_CONFLICT'});
    const replay=structuredClone(original);replay.rounds[0].attempt.score=99;
    assert.throws(()=>repo.saveRun(replay),{code:'ATTEMPT_FINALIZED'});
    assert.equal(repo.getRun('run-1').rounds[0].attempt.score,100);
    const active=run(owner,{finalized:false});active.id='run-2';active.rounds[0].attempt.id='attempt-2';active.rounds[0].attempt.runId='run-2';repo.saveRun(active);
    const finalized=structuredClone(active);Object.assign(finalized.rounds[0].attempt,{finalizedAt:150,guessCoordinates:[34.8,32.1],centerDistanceMeters:0,edgeDistanceMeters:0,score:100,outcome:'submitted'});repo.saveRun(finalized);
    assert.equal(repo.listAttempts({playerId:owner}).length,2);
  }finally{fixture.close();}
});

test('one daily run and immutable challenge selection remain durable constraints',()=>{
  const fixture=simulatedDurableStorage();
  try{
    const repo=createCloudflareRepository({storage:fixture.storage,schema}),owner=repo.resolveSession().player.id;
    const challenge={id:'challenge-1',dayKey:'2026-11-24',places:['fixed-target']};repo.saveDailyChallenge(challenge);
    assert.deepEqual(repo.saveDailyChallenge({...challenge,id:'different',places:['changed-target']}),challenge);
    const daily={id:'daily-1',playerId:owner,kind:'daily',dayKey:challenge.dayKey,status:'in_progress',createdAt:100,rounds:[]};repo.saveRun(daily);
    assert.throws(()=>repo.saveRun({...daily,id:'daily-2'}),/UNIQUE/);
    assert.equal(repo.findDailyRun(owner,challenge.dayKey).id,'daily-1');
  }finally{fixture.close();}
});

test('schema versions fail closed and initial DDL installation is atomic',()=>{
  const fixture=simulatedDurableStorage();
  try{
    const repo=createCloudflareRepository({storage:fixture.storage,schema}),seed=repo.getDailySeed();
    const futureSchema=schema.replace(/PRAGMA user_version\s*=\s*1;/,'PRAGMA user_version = 2;');
    assert.throws(()=>createCloudflareRepository({storage:fixture.storage,schema:futureSchema}),{code:'SCHEMA_VERSION_UNAVAILABLE'});
    assert.equal(createCloudflareRepository({storage:fixture.storage,schema}).getDailySeed(),seed);
  }finally{fixture.close();}
  const fresh=simulatedDurableStorage();
  try{
    assert.throws(()=>createCloudflareRepository({storage:fresh.storage,schema:schema+'\nTHIS IS INVALID SQL;'}));
    assert.equal(fresh.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='players'").get().n,0);
    assert.ok(createCloudflareRepository({storage:fresh.storage,schema}).resolveSession().player.id);
  }finally{fresh.close();}
});
