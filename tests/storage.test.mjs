import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../server/storage.mjs';

test('anonymous identity and nickname survive a database restart without exposing the cookie secret',()=>{
  const directory=mkdtempSync(join(tmpdir(),'satguess-store-')),filename=join(directory,'test.sqlite');
  let db=openRepository({filename,now:()=>100});
  try{const first=db.resolveSession();assert.equal(first.isNew,true);assert.notEqual(first.player.id,first.token);assert.equal(first.player.session_hash,undefined);db.updateNickname(first.player.id,'  שחקן   חדש  ');db.close();db=openRepository({filename,now:()=>200});const resumed=db.resolveSession(first.token);assert.equal(resumed.isNew,false);assert.equal(resumed.player.id,first.player.id);assert.equal(resumed.player.nickname,'שחקן חדש');assert.notEqual(db.resolveSession().player.id,first.player.id);}
  finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
test('one daily attempt and first exposure are enforced by durable constraints',()=>{
  const db=openRepository({filename:':memory:',now:()=>100});
  try{const p=db.resolveSession().player;const run={id:'run-one',playerId:p.id,kind:'daily',dayKey:'2026-11-24',status:'active',createdAt:100,rounds:[]};db.saveRun(run);assert.throws(()=>db.saveRun({...run,id:'run-two'}),/UNIQUE/);assert.equal(db.listRuns({kind:'daily',dayKey:run.dayKey}).length,1);assert.equal(db.markExposure(p.id,'place',100),true);assert.equal(db.markExposure(p.id,'place',200),false);assert.equal(db.findDailyRun(p.id,run.dayKey).id,run.id);}
  finally{db.close();}
});
test('accepted coordinates and both derived distances are saved once in normalized attempt history',()=>{
  const db=openRepository({filename:':memory:',now:()=>100});
  try{const p=db.resolveSession().player;const attempt={id:'a',runId:'r',playerId:p.id,roundIndex:0,sourcePlaceId:'p',placeRevisionId:'v1',cohortKey:'normal',kind:'practice',mode:'normal',collection:'landmarks',firstExposure:true,startedAt:100,deadlineAt:null,finalizedAt:120,guessCoordinates:[34.8,32.1],centerDistanceMeters:25,edgeDistanceMeters:15,score:100,outcome:'submitted'};const run={id:'r',playerId:p.id,kind:'practice',status:'active',createdAt:100,rounds:[{attempt}]};db.saveRun(run);db.saveRun(run);assert.deepEqual(db.listAttempts({placeRevisionId:'v1',cohortKey:'normal'}),[attempt]);assert.equal(db.listAttempts({playerId:'other'}).length,0);assert.equal(db.getRun('r').rounds[0].attempt.edgeDistanceMeters,15);}
  finally{db.close();}
});
test('a failed transaction rolls back exposure and run changes together',()=>{
  const db=openRepository({filename:':memory:'});
  try{const p=db.resolveSession().player;assert.throws(()=>db.transaction(()=>{db.markExposure(p.id,'p',1);throw Error('abort');}));assert.equal(db.markExposure(p.id,'p',2),true);assert.throws(()=>db.updateNickname(p.id,'<script>'),/כינוי/);}
  finally{db.close();}
});
