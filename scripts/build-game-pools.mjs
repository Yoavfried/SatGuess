import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gridCell,haversineMeters} from '../dist/rules.mjs';
import {pointInPlayArea} from '../dist/imagery-loader.mjs';

export const normalizePlaceName=value=>String(value??'').normalize('NFKD').replace(/[\u0591-\u05c7]/g,'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
const MODES=['easy','normal','hard'];
const INFORMATIONAL_FLAGS=new Set(['source_screened_not_manually_verified','imagery_date_not_checked','status_unknown','unknown_operating_status','geometry_bounds_center']);
const categoryName=value=>({'בית קולנוע':'קולנוע','מרכז קניות':'קניון'}[value]||value);
const qid=p=>p.wikidataQid||p.wikidataId||p.wikidata||/^wikidata\/(Q\d+)$/.exec(p.id)?.[1];
const canonicalId=id=>String(id).replace(/^osm:(node|way|relation)\//,'osm/$1/');
const identities=p=>[p.id,...(p.sources||[]).map(s=>s.id)].filter(Boolean).map(canonicalId);
const sourceLabel=p=>p.sourceLabel||(/משרד החינוך|Education/.test(p.dataSource)?'משרד החינוך':/Overture/i.test(p.dataSource)?'Overture Maps':/OpenStreetMap/.test(p.dataSource)?'OpenStreetMap':p.dataSource);
const evidence=p=>({id:p.id,dataSource:p.dataSource,dataLicense:p.dataLicense,url:p.sourceUrl});
const licenses=p=>[...new Set([p.dataLicense,...(p.sourceLicenses||[]),...(p.sources||[]).map(s=>s.dataLicense||s.license)].filter(Boolean))];
const uniqueSources=sources=>[...new Map(sources.map(s=>[canonicalId(s.id||s.url),s])).values()];
const GENERIC_ARCHAEOLOGY_NAMES=new Set(['גת','בור מים','באר','סביל','בית בד','מערה','קבר','קברים','חציבה','מחצבה','שרידים','שרידי מבנה','שרידי קיר','קיר','מגדל','מבנה','מאגר מים'].map(normalizePlaceName));
function genericFeatureName(p){const name=normalizePlaceName(p.name);return name===normalizePlaceName(p.category)||/אתר (?:ארכאולוגי|עתיקות|מורשת)/.test(p.category)&&GENERIC_ARCHAEOLOGY_NAMES.has(name);}

/** Merge source-screened snapshots; never invent names or add city qualifiers. */
export function buildGamePools(seed,snapshots,{playArea}={}){
  const held=[],merged=[],records=[],identityIndex=new Map(),nameIndex=new Map(),qidIndex=new Map();
  const hold=(p,reason)=>held.push({id:p.id,name:p.name,category:p.category,coordinates:p.coordinates,reason});
  const incoming=[...seed.places.map(p=>({...p,poolGroup:p.poolGroup||'landmarks',seed:true})),...snapshots.flatMap(d=>d.places||d.candidates||[])];
  for(const raw of incoming){
    const p={...raw,category:categoryName(raw.category)};
    if(!p.id||!/[א-ת]/.test(p.name)||!/[א-ת]/.test(p.category)||!p.sourceUrl||!p.dataSource||!p.dataLicense||!['landmarks','businesses'].includes(p.poolGroup)||!Array.isArray(p.coordinates)||p.coordinates.length!==2||!p.coordinates.every(Number.isFinite)){hold(p,'invalid_or_incomplete_record');continue;}
    if(p.qualityFlags?.some(flag=>!INFORMATIONAL_FLAGS.has(flag))){hold(p,'source_quality_flags');continue;}
    if(!p.seed&&genericFeatureName(p)){hold(p,'generic_feature_description_requires_actual_name');continue;}
    if(playArea&&!pointInPlayArea(p.coordinates,playArea)){hold(p,'outside_play_area');continue;}
    const key=`${p.category}:${normalizePlaceName(p.name)}`;
    let index=identities(p).map(id=>identityIndex.get(id)).find(i=>i!==undefined);
    if(index!==undefined&&haversineMeters(records[index].coordinates,p.coordinates)>150){hold(p,'source_identity_coordinate_conflict');continue;}
    // An OSM wikidata tag can identify a chain/organization, not an individual branch.
    // Use it only as a nearby same-category hint; OSM feature IDs remain primary.
    if(index===undefined&&qid(p))index=(qidIndex.get(qid(p))||[]).find(i=>records[i].category===p.category&&haversineMeters(records[i].coordinates,p.coordinates)<=80);
    if(index===undefined)index=(nameIndex.get(key)||[]).find(i=>haversineMeters(records[i].coordinates,p.coordinates)<=80);
    if(index!==undefined){
      const prior=records[index];
      prior.sources=uniqueSources([...prior.sources,...(p.sources||[]),evidence(p)]);
      prior.sourceLicenses=[...new Set([...prior.sourceLicenses,...licenses(p)])];
      prior.brand=prior.brand||p.brand;prior.brandWikidata=prior.brandWikidata||p.brandWikidata;
      // Any landmark/institution classification keeps the combined venue in that pool.
      if(p.poolGroup==='landmarks')prior.poolGroup='landmarks';
      merged.push({retainedId:prior.id,mergedId:p.id});
    }else{
      index=records.push({...p,sources:uniqueSources([...(p.sources||[]),evidence(p)]),sourceLicenses:licenses(p)})-1;
      nameIndex.set(key,[...(nameIndex.get(key)||[]),index]);
    }
    for(const id of identities(p))identityIndex.set(id,index);
    if(!(nameIndex.get(key)||[]).includes(index))nameIndex.set(key,[...(nameIndex.get(key)||[]),index]);
    if(qid(p)){if(!qidIndex.has(qid(p)))qidIndex.set(qid(p),[]);if(!qidIndex.get(qid(p)).includes(index))qidIndex.get(qid(p)).push(index);}
  }
  // Compare all venues, including cross-pool branches, before selecting a pool.
  // Education classroom numbers are not useful geographic disambiguators.
  const ambiguous=new Map(MODES.map(m=>[m,new Set()])),collisionGroups=[];
  for(const mode of MODES){
    const contexts=new Map();
    for(const p of records){
      const ambiguityName=p.ambiguityName||p.name;
      const key=`${gridCell(p.coordinates,mode).id}:${p.category}:${normalizePlaceName(ambiguityName)}`;
      if(!contexts.has(key))contexts.set(key,[]);contexts.get(key).push(p);
      const brands=[p.brandWikidata?`brand-id:${p.brandWikidata}`:null,p.brand?`brand-name:${normalizePlaceName(p.brand)}`:null].filter(Boolean);
      for(const brand of brands){const brandKey=`${gridCell(p.coordinates,mode).id}:${brand}`;if(!contexts.has(brandKey))contexts.set(brandKey,[]);contexts.get(brandKey).push(p);}
    }
    for(const [key,group] of contexts)if(group.length>1){
      for(const p of group)ambiguous.get(mode).add(p.id);
      collisionGroups.push({mode,key,ids:group.map(p=>p.id)});
    }
  }
  const places=[];
  for(const p of records){
    const eligibleModes=MODES.filter(m=>!ambiguous.get(m).has(p.id)&&(!p.eligibleModes||p.eligibleModes.includes(m)));
    if(!eligibleModes.length){hold(p,'ambiguous_name_category_in_all_modes');continue;}
    places.push({id:p.id,name:p.name,coordinates:p.coordinates,category:p.category,poolGroup:p.poolGroup,eligibleModes,sourceUrl:p.sourceUrl,dataSource:p.dataSource,sourceLabel:sourceLabel(p),dataLicense:p.dataLicense,sourceLicenses:p.sourceLicenses,...(p.coordinateKind?{coordinateKind:p.coordinateKind}:{}),...(p.brand?{brand:p.brand}:{}),...(p.brandWikidata?{brandWikidata:p.brandWikidata}:{}),...(p.ambiguityName?{ambiguityName:p.ambiguityName}:{}),...(p.qualityFlags?.length?{qualityFlags:p.qualityFlags}:{}),...(p.sources.length>1?{sources:p.sources}:{}),...(qid(p)?{wikidataQid:qid(p)}:{}),reviewStatus:p.seed?p.reviewStatus||'seed':'source-screened'});
  }
  const counts={};
  for(const mode of MODES){counts[mode]={landmarks:0,businesses:0,all:0,blocks:0};const blocks=new Set();for(const p of places)if(p.eligibleModes.includes(mode)){counts[mode][p.poolGroup]++;counts[mode].all++;blocks.add(gridCell(p.coordinates,mode).id);}counts[mode].blocks=blocks.size;}
  const reasons={};for(const p of held)reasons[p.reason]=(reasons[p.reason]||0)+1;
  const dataset={source:[...new Set(places.map(p=>p.dataSource))].join(' + '),license:'ODbL-1.0',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',attribution:'© OpenStreetMap contributors · https://www.openstreetmap.org/copyright ; Wikidata source records CC0-1.0 · https://www.wikidata.org/wiki/Wikidata:Licensing',retrievedAt:'2026-11-24',limitations:'Source-screened playtest pools, not manually surveyed or verified open. OSM way/relation bounds centres remain approximate representative points, not verified entrances. No city qualifiers are added. Ambiguous source name/category/block and tagged-brand combinations are excluded per difficulty. Coordinate and image-date limitations remain source dependent.',poolCounts:counts,places};
  return {dataset,audit:{createdAt:'2026-11-24',inputCount:incoming.length,retainedCount:places.length,counts,heldReasons:reasons,merged,held,collisionGroups,policy:'Original source names; exact playable mask; actionable quality flags held; OSM geometry bounds centres allowed as approximate representative points for playtesting, not surveyed entrances; identity and nearby same-name/category deduplication; repeated names/categories or tagged brands in the same fixed grid cell excluded per difficulty. Source identity conflicts hold the incoming record rather than silently moving the earlier target.'}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [seedPath,output,...inputPaths]=process.argv.slice(2);
  if(!seedPath||!output||!inputPaths.length)throw Error('Usage: node scripts/build-game-pools.mjs seed.json output.json candidates.json [...]');
  const read=async p=>JSON.parse(await readFile(p,'utf8'));
  const [seed,playArea,...inputs]=await Promise.all([read(seedPath),read('data/play-area.geojson'),...inputPaths.map(read)]);
  const result=buildGamePools(seed,inputs,{playArea});
  await writeFile(output,JSON.stringify(result.dataset)+'\n');
  await writeFile('data/game-pool-audit.json',JSON.stringify(result.audit,null,2)+'\n');
  console.log(JSON.stringify({retained:result.audit.retainedCount,counts:result.audit.counts,heldReasons:result.audit.heldReasons,merged:result.audit.merged.length}));
}
