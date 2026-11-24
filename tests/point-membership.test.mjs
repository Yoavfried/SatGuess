import test from 'node:test';
import assert from 'node:assert/strict';
import {pointInPlayArea} from '../dist/imagery-loader.mjs';

test('indexed membership preserves outer boundaries and excluded holes across latitude bands',()=>{
  const area={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]],[[.2,.2],[.8,.2],[.8,.8],[.2,.8],[.2,.2]]]};
  for(const point of [[0,0],[1,1],[.1,.05],[.5,.1],[.95,.95],[.2,.15]])assert.equal(pointInPlayArea(point,area),true,point.join(','));
  for(const point of [[.5,.5],[.2,.5],[.2,.2],[.5,.8],[1.01,.5],[-.01,.5]])assert.equal(pointInPlayArea(point,area),false,point.join(','));
});
test('indexed membership supports negative coordinates, diagonal edges and separate polygons',()=>{
  const area={type:'MultiPolygon',coordinates:[[[[-1,-1],[0,-1],[-1,0],[-1,-1]]],[[[2,2],[3,2],[3,3],[2,3],[2,2]]]]};
  for(const point of [[-.8,-.8],[-.5,-.5],[2.5,2.5],[3,3]])assert.equal(pointInPlayArea(point,area),true,point.join(','));
  for(const point of [[-.2,-.2],[1,1],[2,1.99]])assert.equal(pointInPlayArea(point,area),false,point.join(','));
});
