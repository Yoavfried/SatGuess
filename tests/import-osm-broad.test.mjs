import test from 'node:test';
import assert from 'node:assert/strict';
import {broadOsmCategory,importBroadOsm,summarizeBroadOsm} from '../scripts/import-osm-broad.mjs';
const node=(id,name,lon,tags={})=>({type:'node',id,lon,lat:32.06,tags:{name,...tags}});
const area={type:'Polygon',coordinates:[[[34,31],[36,31],[36,33],[34,33],[34,31]]]};

test('uses source tags for Hebrew category hints and separates landmark and business pools',()=>{
  assert.deepEqual(broadOsmCategory({amenity:'place_of_worship',religion:'jewish'}),{category:'בית כנסת',poolGroup:'landmarks',categoryEvidence:{key:'amenity',value:'place_of_worship',religion:'jewish'}});
  assert.equal(broadOsmCategory({shop:'mall'}).poolGroup,'landmarks');
  assert.equal(broadOsmCategory({shop:'supermarket'}).category,'סופרמרקט');
  assert.equal(broadOsmCategory({amenity:'pharmacy'}).poolGroup,'businesses');
  assert.equal(broadOsmCategory({amenity:'hospital'}).poolGroup,'landmarks');
  assert.equal(broadOsmCategory({amenity:'waste_basket'}),null);
});

test('keeps only Hebrew-named physical venues inside the exact play area',()=>{
  const result=importBroadOsm({elements:[
    node(1,'שם מקור',34.8,{shop:'books','name:he':'שם עברי מקורי'}),
    node(2,'מחוץ לתחום',36.2,{shop:'books'}),
    node(3,'English name',34.9,{shop:'books'}),
    node(4,'תחנת אוטובוס',34.9,{amenity:'shelter',highway:'bus_stop'}),
    node(5,'בית פרטי',34.9,{building:'house',office:'company'}),
    node(6,'עסק פרטי',34.9,{shop:'books',access:'private'}),
    node(7,'מקום צבאי',34.9,{amenity:'school',military:'base'}),
    node(8,'עסק עתידי',34.9,{shop:'books',construction:'yes'}),
  ]},{allowedGeoJSON:area});
  assert.equal(result.places.length,1);
  assert.equal(result.places[0].name,'שם עברי מקורי');
  assert.equal(result.places[0].poolGroup,'businesses');
  assert.equal(result.rejected.length,7);
});

test('collapses nearby node/area duplicates while retaining independent branches and provenance',()=>{
  const result=importBroadOsm({elements:[
    node(1,'חנות ספרים',34.72,{shop:'books'}),
    {type:'way',id:2,center:{lon:34.7201,lat:32.06},tags:{name:'חנות ספרים',shop:'books'}},
    node(3,'חנות ספרים',34.78,{shop:'books'}),
  ]});
  assert.equal(result.places.length,2);
  assert.equal(result.places[0].coordinateKind,'node');
  assert.equal(result.places[0].sources.length,2);
});

test('same-name/category branches in one hint cell are all excluded from usable-question counts',()=>{
  const result=importBroadOsm({elements:[
    node(1,'סופר לדוגמה',34.72,{shop:'supermarket'}),node(2,'סופר לדוגמה',34.78,{shop:'supermarket'}),node(3,'סופר לדוגמה',35.12,{shop:'supermarket'}),
  ]});
  const summary=summarizeBroadOsm(result);
  assert.equal(summary.stats.places,3);
  assert.equal(summary.globalUniqueNamesAndCategories,1);
  assert.equal(summary.nameAmbiguity.find(p=>p.mode==='normal').usableQuestions,1);
  assert.equal(summary.nameAmbiguity.find(p=>p.mode==='normal').nameCollisionQuestions,2);
});

test('stricter counts also hold same tagged brand even when branch labels differ',()=>{
  const result=importBroadOsm({elements:[
    node(1,'המותג סניף ראשון',34.72,{shop:'supermarket','brand:wikidata':'Q123'}),
    node(2,'המותג סניף שני',34.78,{shop:'supermarket','brand:wikidata':'Q123'}),
  ]});
  const summary=summarizeBroadOsm(result);
  assert.equal(summary.nameAmbiguity.find(p=>p.mode==='normal').usableQuestions,2);
  assert.equal(summary.strictNameAndTaggedBrandAmbiguity.find(p=>p.mode==='normal').usableQuestions,0);
});

test('strict brand ambiguity spans category variants while valid named parks survive nonadministrative boundaries',()=>{
  const result=importBroadOsm({elements:[
    node(1,'מותג א',34.72,{shop:'supermarket','brand:wikidata':'Q123'}),
    node(2,'מותג ב',34.78,{shop:'convenience','brand:wikidata':'Q123'}),
    node(3,'שמורת דוגמה',35.12,{leisure:'nature_reserve',boundary:'protected_area'}),
  ]});
  assert.equal(result.places.length,3);
  assert.equal(summarizeBroadOsm(result).strictNameAndTaggedBrandAmbiguity.find(p=>p.mode==='normal').usableQuestions,1);
});

test('proximity does not prove distinct nodes over 10m apart are the same venue',()=>{
  const result=importBroadOsm({elements:[
    node(1,'חנות דוגמה',34.72,{shop:'books'}),
    node(2,'חנות דוגמה',34.7203,{shop:'books'}),
  ]});
  assert.equal(result.places.length,1);
  const group=result.places[0];
  assert.ok(group.qualityFlags.includes('uncertain_multi_node_merge'));
  assert.equal(group.mergeEvidence.sourceNodes.length,2);
  assert.ok(group.mergeEvidence.maxNodeSeparationMeters>10);
  assert.equal(result.stats.uncertainMultiNodeMergeGroups,1);
  const normal=summarizeBroadOsm(result).strictNameAndTaggedBrandAmbiguity.find(p=>p.mode==='normal');
  assert.equal(normal.sourceQualityHeldQuestions,1);
  assert.equal(normal.usableQuestions,0);
});

test('uncertainty compares all source nodes even when the representative moves between nearby nodes',()=>{
  const result=importBroadOsm({elements:[
    node(1,'חנות דוגמה',34.72,{shop:'books'}),
    node(2,'חנות דוגמה',34.72009,{shop:'books','name:he':'חנות דוגמה'}),
    node(3,'חנות דוגמה',34.72018,{shop:'books','name:he':'חנות דוגמה'}),
  ]});
  assert.equal(result.places.length,1);
  assert.ok(result.places[0].qualityFlags.includes('uncertain_multi_node_merge'));
  assert.equal(result.places[0].mergeEvidence.sourceNodes.length,3);
});

test('a close duplicate node pair and node/area representation alone do not trigger the uncertainty hold',()=>{
  const close=importBroadOsm({elements:[
    node(1,'חנות קרובה',34.72,{shop:'books'}),node(2,'חנות קרובה',34.72005,{shop:'books'}),
  ]});
  assert.equal(close.places.length,1);
  assert.ok(!close.places[0].qualityFlags.includes('uncertain_multi_node_merge'));
  const area=importBroadOsm({elements:[
    node(1,'חנות דוגמה',34.72,{shop:'books'}),
    {type:'way',id:2,center:{lon:34.7203,lat:32.06},tags:{name:'חנות דוגמה',shop:'books'}},
  ]});
  assert.equal(area.places.length,1);
  assert.ok(!area.places[0].qualityFlags.includes('uncertain_multi_node_merge'));
});
