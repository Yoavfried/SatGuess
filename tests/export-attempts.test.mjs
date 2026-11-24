import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRepository} from '../server/storage.mjs';
import {exportAttempts,ATTEMPT_EXPORT_COLUMNS} from '../scripts/export-attempts.mjs';

function fixture(t){
  const base=resolve(dirname(fileURLToPath(import.meta.url)),'../.data');mkdirSync(base,{recursive:true});
  const directory=mkdtempSync(join(base,'export-test-')),filename=join(directory,'history.sqlite');
  const repository=openRepository({filename,now:()=>100});
  const session=repository.resolveSession();repository.updateNickname(session.player.id,'כינוי פרטי');
  for(let i=0;i<3;i++){
    const attempt={id:`secret-attempt-${i}`,runId:`secret-run-${i}`,playerId:session.player.id,roundIndex:i,sourcePlaceId:i===0?'מקור,"א"':'osm/node/2',placeRevisionId:'revision-1',cohortKey:'cohort-1',kind:'practice',mode:'normal',collection:'landmarks',firstExposure:i!==1,startedAt:100+i,deadlineAt:null,finalizedAt:i===2?null:120+i,guessCoordinates:i===2?null:[34.8,32.1],centerDistanceMeters:i===2?null:25,edgeDistanceMeters:i===2?null:15,score:i===2?null:100,outcome:i===2?null:'submitted',unexportedSecret:session.token};
    repository.saveRun({id:attempt.runId,playerId:session.player.id,kind:'practice',status:'in_progress',createdAt:100,rounds:[{attempt}]});
  }
  repository.close();
  t.after(()=>{const target=realpathSync(directory);assert.equal(dirname(target),realpathSync(base));assert.ok(basename(target).startsWith('export-test-'));rmSync(target,{recursive:true,force:true});});
  return {directory,filename,session};
}
test('attempt CSV exports normalized measurements and no identity, nickname, token or raw JSON',t=>{
  const f=fixture(t),outputPath=join(f.directory,'attempts.csv');
  const result=exportAttempts({databaseFile:f.filename,outputPath});
  const csv=readFileSync(outputPath,'utf8');
  assert.equal(result.rows,3);assert.equal(csv.charCodeAt(0),0xfeff);
  assert.equal(csv.split('\r\n')[0].slice(1),ATTEMPT_EXPORT_COLUMNS.map(c=>'"'+c+'"').join(','));
  assert.match(csv,/"מקור,""א"""/);assert.match(csv,/"34\.8","32\.1","25","15","100","submitted"/);
  for(const secret of [f.session.player.id,f.session.token,'כינוי פרטי','secret-run-','secret-attempt-','session_hash','record_json'])assert.ok(!csv.includes(secret));
  assert.throws(()=>exportAttempts({databaseFile:f.filename,outputPath}),/EEXIST/);
});
test('analysis filters include only finalized first exposures and preserve unscored nulls when unfiltered',t=>{
  const f=fixture(t);
  assert.equal(exportAttempts({databaseFile:f.filename,outputPath:join(f.directory,'final.csv'),finalizedOnly:true,firstExposureOnly:true}).rows,1);
  const outputPath=join(f.directory,'all.csv');exportAttempts({databaseFile:f.filename,outputPath});
  assert.match(readFileSync(outputPath,'utf8').split('\r\n')[3],/"102","","","","","","","",""$/);
});
test('CSV output is explicit and database files cannot be used as output',()=>{
  assert.throws(()=>exportAttempts(),/explicit CSV/);
  assert.throws(()=>exportAttempts({outputPath:'history.sqlite'}),/\.csv/);
});
