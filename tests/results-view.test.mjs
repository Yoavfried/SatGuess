import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreHistogramModel,guessPercentileCopy} from '../dist/results-view.mjs';

test('histogram retains zero/perfect scores and server bin boundaries without re-binning',()=>{
  const model=scoreHistogramModel([{min:500,max:500,count:3},{min:0,max:49,count:4},{min:50,max:99,count:0}],500);
  assert.deepEqual(model.bins,[{min:0,max:49,count:4},{min:50,max:99,count:0},{min:500,max:500,count:3}]);
  assert.equal(model.ownScore,500);assert.equal(model.total,7);assert.equal(model.maximum,4);
  assert.equal(scoreHistogramModel(model.bins,0).ownScore,0);
});
test('invalid histogram values cannot become SVG geometry or invented counts',()=>{
  const model=scoreHistogramModel([{min:0,max:50,count:-1},{min:NaN,max:500,count:2},{min:400,max:600,count:2},{min:100,max:50,count:2},{min:0,max:50,count:1.5}],Infinity);
  assert.deepEqual(model.bins,[]);assert.equal(model.total,0);assert.equal(model.ownScore,null);
});
test('guess percentiles are suppressed below thirty even if the server supplies a number',()=>{
  const copy=guessPercentileCopy({sampleSize:29,percentile:100,status:'ready'},1);
  assert.equal(copy.ready,false);assert.doesNotMatch(copy.text,/%/);assert.equal(copy.minimum,30);
});
test('strict-better copy preserves ties and accepts zero percentile at sufficient sample size',()=>{
  const copy=guessPercentileCopy({sampleSize:30,percentile:0,percentileKind:'strict-better',status:'ready'});
  assert.equal(copy.ready,true);assert.match(copy.text,/0%/);assert.match(copy.text,/מדויק יותר/);
  assert.equal(guessPercentileCopy({sampleSize:40,percentile:90,percentileKind:'at-or-better',status:'ready'}).ready,false);
  assert.equal(guessPercentileCopy({sampleSize:40,percentile:90,status:'warming_up'}).ready,false);
});
