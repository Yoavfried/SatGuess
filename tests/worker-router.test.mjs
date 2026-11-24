import test from 'node:test';
import assert from 'node:assert/strict';
import {routeWorker} from '../server/worker-router.mjs';

test('worker owns only the game prefix and canonicalizes the trailing slash',async()=>{
  const untouched=()=>{throw Error('An unrelated URL must not reach game storage or assets.');};
  const env={GAME:{idFromName:untouched},ASSETS:{fetch:untouched}};
  const root=await routeWorker(new Request('https://example.test/'),env);assert.equal(root.status,404);
  const prefixed=await routeWorker(new Request('https://example.test/mappax/'),env);assert.equal(prefixed.status,404);
  const redirect=await routeWorker(new Request('https://example.test/mappa'),env);assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Location'),'/mappa/');
});
test('API requests share a persistent object; static assets bypass game storage',async()=>{
  let objectCalls=0,assetCalls=0;
  const env={GAME:{idFromName:name=>{assert.equal(name,'game-v1');return 'fixed-id';},get:id=>{assert.equal(id,'fixed-id');return {fetch:async request=>{objectCalls++;assert.match(new URL(request.url).pathname,/^\/mappa\/api\//);return Response.json({ok:true});}};}},ASSETS:{fetch:async request=>{assetCalls++;assert.equal(new URL(request.url).pathname,'/mappa/app.mjs');return new Response('module source');}}};
  const api=await routeWorker(new Request('https://example.test/mappa/api/bootstrap'),env);assert.deepEqual(await api.json(),{ok:true});assert.equal(objectCalls,1);assert.equal(assetCalls,0);
  const asset=await routeWorker(new Request('https://example.test/mappa/app.mjs'),env);assert.equal(await asset.text(),'module source');assert.equal(objectCalls,1);assert.equal(assetCalls,1);assert.equal(asset.headers.get('X-Robots-Tag'),'noindex');
  const post=await routeWorker(new Request('https://example.test/mappa/app.mjs',{method:'POST'}),env);assert.equal(post.status,405);assert.equal(assetCalls,1);
});
