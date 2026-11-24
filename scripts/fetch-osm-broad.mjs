import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const countOnly=process.argv.includes('--count');
if(process.argv.slice(2).some(arg=>arg!=='--count'))throw Error('Usage: node scripts/fetch-osm-broad.mjs [--count]');
const queryPath=resolve(projectRoot,'data/israel-pois-broad.overpass');
const savedQuery=await readFile(queryPath,'utf8');
const query=countOnly?savedQuery.replace('out center tags;','out count;'):savedQuery;
const endpoint='https://overpass-api.de/api/interpreter';
const body=new URLSearchParams({data:query});
console.log(`Starting one ${countOnly?'count':'POI'} query on ${endpoint}`);
const response=await fetch(endpoint,{method:'POST',body,headers:{Accept:'application/json','User-Agent':'PinpointIsraelPOIResearch/0.1 (open-data geography game prototype)'},signal:AbortSignal.timeout(210000)});
if(!response.ok)throw Error(`Overpass returned HTTP ${response.status}: ${(await response.text()).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,1800)}`);
const chunks=[];
let bytes=0;
for await(const chunk of response.body){
  bytes+=chunk.byteLength;
  if(bytes>75*1024*1024)throw Error('Raw response exceeded the 75 MB bounded acquisition limit');
  chunks.push(Buffer.from(chunk));
}
const source=Buffer.concat(chunks).toString('utf8');
const result=JSON.parse(source);
if(result.remark)throw Error(`Overpass response is incomplete: ${result.remark}`);
if(!Array.isArray(result.elements))throw Error('Overpass response has no elements array');
const basename=countOnly?'osm-broad-count':'osm-broad-raw';
const output=resolve(projectRoot,'data',`${basename}.json`);
await mkdir(dirname(output),{recursive:true});
await writeFile(output+'.tmp',source);
await rename(output+'.tmp',output);
await writeFile(resolve(projectRoot,'data',`${basename}-provenance.json`),JSON.stringify({source:'OpenStreetMap contributors',license:'ODbL-1.0',attributionUrl:'https://www.openstreetmap.org/copyright',endpoint,queryFile:'data/israel-pois-broad.overpass',queryMode:countOnly?'count':'center tags',querySha256:createHash('sha256').update(query).digest('hex'),sourceTimestamp:result.osm3s?.timestamp_osm_base,retrievedAtUTC:new Date().toISOString(),bytes,elements:result.elements.length,bbox:[34.2,29.45,35.95,33.45],count:countOnly?result.elements[0]?.tags:undefined},null,2)+'\n');
console.log(JSON.stringify({output:basename+'.json',bytes,elements:result.elements.length,count:countOnly?result.elements[0]?.tags:undefined}));
