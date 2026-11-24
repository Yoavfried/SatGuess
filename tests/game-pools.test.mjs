import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGamePools} from '../scripts/build-game-pools.mjs';
const place=(id,name,coordinates=[34.8,32.1],extra={})=>({id,name,coordinates,category:'מוזיאון',poolGroup:'landmarks',sourceUrl:`https://example.org/${id}`,dataSource:'Wikidata',dataLicense:'CC0-1.0',...extra});
test('cross-source duplicates retain the original prompt and all source licenses',()=>{
  const a=place('seed','מוזיאון אור',undefined,{wikidataQid:'Q123'}),b=place('osm','מוזיאון אור',[34.8001,32.1],{dataSource:'OpenStreetMap',dataLicense:'ODbL-1.0'});
  const {dataset,audit}=buildGamePools({places:[a]},[{places:[b]}]);
  assert.equal(dataset.places.length,1);assert.equal(dataset.places[0].name,'מוזיאון אור');assert.deepEqual(dataset.places[0].sourceLicenses,['CC0-1.0','ODbL-1.0']);assert.equal(audit.merged.length,1);
});
test('repeated venue names are ineligible only for difficulties whose cells are ambiguous',()=>{
  const a=place('a','מוזיאון אור',[34.802,32.06]),b=place('b','מוזיאון אור',[34.802,32.10]);
  const {dataset}=buildGamePools({places:[a,b]},[]);
  assert.equal(dataset.poolCounts.normal.all,0);assert.equal(dataset.poolCounts.hard.all,0);assert.equal(dataset.poolCounts.easy.all,2);
  assert.deepEqual(dataset.places.map(p=>p.eligibleModes),[['easy'],['easy']]);
});
test('actionable source flags are held while unknown status is represented without claiming verification',()=>{
  const {dataset,audit}=buildGamePools({places:[]},[{places:[place('bad','מוזיאון שגוי',undefined,{qualityFlags:['coordinates_conflict']}),place('shop','חנות אור',[34.81,32.1],{poolGroup:'businesses',category:'חנות',qualityFlags:['status_unknown']})]}]);
  assert.equal(dataset.poolCounts.normal.landmarks,0);assert.equal(dataset.poolCounts.normal.businesses,1);assert.equal(dataset.places[0].reviewStatus,'source-screened');assert.equal(audit.heldReasons.source_quality_flags,1);
});
test('education numeric disambiguators cannot turn repeated classroom names into unique questions',()=>{
  const {dataset}=buildGamePools({places:[]},[{candidates:[place('a','גן שתולים 1',[34.802,32.102],{ambiguityName:'גן שתולים'}),place('b','גן שתולים 2',[34.812,32.112],{ambiguityName:'גן שתולים'})]}]);
  assert.equal(dataset.poolCounts.normal.all,0);
});
test('out-of-area and conflicting identity positions never silently move the seed answer',()=>{
  const mask={type:'Polygon',coordinates:[[[34,31],[35,31],[35,33],[34,33],[34,31]]]};
  const seed=place('wikidata/Q123','מוזיאון אור',undefined,{wikidataQid:'Q123'});
  const {dataset,audit}=buildGamePools({places:[seed]},[{places:[place('wikidata/Q123','מוזיאון אור',[34.9,32.1],{wikidataQid:'Q123'}),place('foreign','מוזיאון חוץ',[36,32])]}],{playArea:mask});
  assert.deepEqual(dataset.places[0].coordinates,seed.coordinates);assert.equal(dataset.places.length,1);assert.equal(audit.heldReasons.outside_play_area,1);assert.equal(audit.heldReasons.source_identity_coordinate_conflict,1);
});
test('reused organization Wikidata tags do not collapse distant physical branches',()=>{
  const {dataset}=buildGamePools({places:[]},[{places:[place('osm/node/1','מוזיאון דרום',[34.8,31.7],{wikidata:'Q123'}),place('osm/node/2','מוזיאון צפון',[35.4,32.7],{wikidata:'Q123'})]}]);
  assert.equal(dataset.places.length,2);
});
test('tagged chain branches cannot evade ambiguity through inconsistent source categories',()=>{
  const {dataset}=buildGamePools({places:[]},[{places:[place('a','קפה אור',[34.802,32.102],{brand:'אור',category:'בית קפה',poolGroup:'businesses'}),place('b','מסעדת אור',[34.812,32.112],{brand:'אור',category:'מסעדה',poolGroup:'businesses'})]}]);
  assert.equal(dataset.poolCounts.normal.all,0);
});
test('rerunning a merged snapshot preserves inherited licenses and approximate coordinate metadata',()=>{
  const p=place('a','מוזיאון אור',undefined,{sourceLicenses:['CC0-1.0','ODbL-1.0'],coordinateKind:'bounds_center',qualityFlags:['geometry_bounds_center']});
  const {dataset}=buildGamePools({places:[p]},[]);
  assert.deepEqual(dataset.places[0].sourceLicenses,['CC0-1.0','ODbL-1.0']);assert.equal(dataset.places[0].coordinateKind,'bounds_center');assert.equal(dataset.license,'ODbL-1.0');assert.match(dataset.licenseUrl,/odbl/);
});
test('a new build does not reintroduce excluded brand branches after a snapshot round trip',()=>{
  const input={places:[place('a','קפה אור',[34.802,32.06],{brand:'אור',category:'בית קפה'}),place('b','מסעדת אור',[34.802,32.10],{brand:'אור',category:'מסעדה'})]};
  const first=buildGamePools(input,[]).dataset,second=buildGamePools(first,[]).dataset;
  assert.equal(first.poolCounts.normal.all,0);assert.equal(first.poolCounts.easy.all,2);assert.deepEqual(second.poolCounts,first.poolCounts);
});
test('source aliases remain indexed after identity merges for later duplicates',()=>{
  const seed={places:[place('wikidata/Q1','מוזיאון ראשי',undefined,{wikidataQid:'Q1'})]};
  const aliases={places:[place('alias','מוזיאון כינוי',[34.8001,32.1],{wikidataQid:'Q1'}),place('third','מוזיאון כינוי',[34.8002,32.1])]};
  const {dataset}=buildGamePools(seed,[aliases]);assert.equal(dataset.places.length,1);assert.equal(dataset.places[0].name,'מוזיאון ראשי');
});
test('generic archaeological descriptions are held without changing authentic venue names',()=>{
  const {dataset,audit}=buildGamePools({places:[]},[{places:[place('generic','גת',undefined,{category:'אתר ארכאולוגי'}),place('real','תל צפית',[34.85,31.7],{category:'אתר ארכאולוגי'})]}]);
  assert.deepEqual(dataset.places.map(p=>p.name),['תל צפית']);assert.equal(audit.heldReasons.generic_feature_description_requires_actual_name,1);
});
