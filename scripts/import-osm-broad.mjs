import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gridCell,haversineMeters} from '../dist/rules.mjs';
import {pointInPlayArea} from '../dist/imagery-loader.mjs';

const HEBREW=/[\u05d0-\u05ea]/;
export const normalizeOsmQuestionName=value=>String(value??'').normalize('NFKD').replace(/[\u0591-\u05c7]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const AMENITY={
  school:'בית ספר',kindergarten:'גן ילדים',college:'מכללה',university:'אוניברסיטה',hospital:'בית חולים',clinic:'מרפאה',doctors:'מרפאה',dentist:'מרפאת שיניים',pharmacy:'בית מרקחת',veterinary:'מרפאה וטרינרית',
  library:'ספרייה',theatre:'תיאטרון',cinema:'קולנוע',arts_centre:'מרכז אמנות',community_centre:'מרכז קהילתי',social_centre:'מרכז קהילתי',
  restaurant:'מסעדה',cafe:'בית קפה',fast_food:'מזון מהיר',bar:'בר',pub:'בר',food_court:'מתחם אוכל',ice_cream:'גלידרייה',
  bank:'בנק',atm:'כספומט',bureau_de_change:'המרת מטבע',post_office:'דואר',post_depot:'מרכז דואר',townhall:'עירייה',courthouse:'בית משפט',police:'תחנת משטרה',fire_station:'תחנת כיבוי אש',
  place_of_worship:'בית תפילה',marketplace:'שוק',fuel:'תחנת דלק',charging_station:'עמדת טעינה',car_rental:'השכרת רכב',car_wash:'שטיפת רכב',bicycle_rental:'השכרת אופניים',bus_station:'תחנה מרכזית',ferry_terminal:'מסוף מעבורות',
  social_facility:'שירות חברתי',nursing_home:'בית אבות',research_institute:'מכון מחקר',music_school:'בית ספר למוזיקה',language_school:'בית ספר לשפות',driving_school:'בית ספר לנהיגה',conference_centre:'מרכז כנסים',exhibition_centre:'מרכז תערוכות',animal_shelter:'מקלט לבעלי חיים',
};
const LANDMARK_AMENITIES=new Set(['school','kindergarten','college','university','hospital','library','theatre','cinema','arts_centre','community_centre','social_centre','townhall','courthouse','police','fire_station','place_of_worship','marketplace','bus_station','ferry_terminal','social_facility','nursing_home','research_institute','conference_centre','exhibition_centre','animal_shelter']);
const SHOPS={
  mall:'קניון',supermarket:'סופרמרקט',convenience:'חנות נוחות',bakery:'מאפייה',butcher:'אטליז',greengrocer:'ירקנייה',seafood:'חנות דגים',dairy:'מחלבה',alcohol:'חנות משקאות',beverages:'חנות משקאות',cheese:'מעדנייה',deli:'מעדנייה',confectionery:'חנות ממתקים',chocolate:'חנות שוקולד',coffee:'חנות קפה',tea:'חנות תה',
  clothes:'חנות בגדים',shoes:'חנות נעליים',fabric:'חנות בדים',jewelry:'חנות תכשיטים',watches:'חנות שעונים',bag:'חנות תיקים',books:'חנות ספרים',stationery:'חנות כלי כתיבה',toys:'חנות צעצועים',sports:'חנות ספורט',bicycle:'חנות אופניים',
  car:'סוכנות רכב',car_repair:'מוסך',car_parts:'חלפי רכב',tyres:'צמיגייה',motorcycle:'חנות אופנועים',electronics:'חנות אלקטרוניקה',computer:'חנות מחשבים',mobile_phone:'חנות סלולר',appliance:'חנות מכשירי חשמל',furniture:'חנות רהיטים',hardware:'חנות כלי עבודה',doityourself:'חנות לבית',garden_centre:'משתלה',florist:'חנות פרחים',pet:'חנות חיות מחמד',
  beauty:'מכון יופי',hairdresser:'מספרה',cosmetics:'חנות קוסמטיקה',optician:'אופטיקה',hearing_aids:'מכשירי שמיעה',medical_supply:'ציוד רפואי',department_store:'כלבו',general:'חנות',gift:'חנות מתנות',variety_store:'חנות לבית',laundry:'מכבסה',dry_cleaning:'ניקוי יבש',travel_agency:'סוכנות נסיעות',ticket:'מכירת כרטיסים',copyshop:'בית דפוס',photo:'חנות צילום',music:'חנות מוזיקה',musical_instrument:'חנות כלי נגינה',chemist:'חנות פארם',
};
const TOURISM={museum:'מוזיאון',gallery:'גלריה',attraction:'אתר תיירות',artwork:'יצירת אמנות',zoo:'גן חיות',aquarium:'אקווריום',theme_park:'פארק שעשועים',viewpoint:'תצפית',picnic_site:'חניון נופש',hotel:'מלון',motel:'מוטל',hostel:'אכסניה',guest_house:'בית הארחה',camp_site:'אתר קמפינג',caravan_site:'אתר קמפינג',resort:'אתר נופש'};
const BUSINESS_TOURISM=new Set(['hotel','motel','hostel','guest_house','camp_site','caravan_site','resort']);
const LEISURE={park:'פארק',nature_reserve:'שמורת טבע',garden:'גן',stadium:'אצטדיון',sports_centre:'מרכז ספורט',fitness_centre:'חדר כושר',swimming_pool:'בריכת שחייה',water_park:'פארק מים',marina:'מרינה',golf_course:'מגרש גולף',beach_resort:'חוף רחצה',amusement_arcade:'משחקייה',escape_game:'חדר בריחה',bowling_alley:'באולינג',ice_rink:'משטח החלקה',trampoline_park:'פארק טרמפולינות',dog_park:'גינת כלבים',playground:'גן משחקים',pitch:'מגרש ספורט'};
const BUSINESS_LEISURE=new Set(['fitness_centre','amusement_arcade','escape_game','bowling_alley','trampoline_park']);
const HISTORIC={archaeological_site:'אתר ארכאולוגי',castle:'מצודה',monument:'אנדרטה',memorial:'אתר הנצחה',building:'מבנה היסטורי',ruins:'אתר עתיקות',fort:'מצודה',tomb:'קבר היסטורי',city_gate:'שער היסטורי',ship:'כלי שיט היסטורי',aircraft:'כלי טיס היסטורי',locomotive:'קטר היסטורי'};
const OFFICES={government:'משרד ממשלתי',administrative:'משרד ציבורי',diplomatic:'נציגות דיפלומטית',ngo:'משרדי עמותה',association:'משרדי אגודה',charity:'משרדי עמותה',educational_institution:'מוסד חינוכי',research:'מכון מחקר',newspaper:'מערכת עיתון',publisher:'הוצאה לאור',insurance:'סוכנות ביטוח',estate_agent:'תיווך נדל״ן',lawyer:'משרד עורכי דין',accountant:'משרד רואי חשבון',architect:'משרד אדריכלים',advertising_agency:'משרד פרסום',financial:'שירות פיננסי',employment_agency:'שירות תעסוקה',travel_agent:'סוכנות נסיעות',it:'משרד טכנולוגיה',telecommunication:'שירות תקשורת',tax_advisor:'יועץ מס',therapist:'מרפאה טיפולית',consulting:'משרד ייעוץ',company:'משרדי חברה'};
const LANDMARK_OFFICES=new Set(['government','administrative','diplomatic','ngo','association','charity','educational_institution','research']);
const CRAFTS={carpenter:'נגרייה',shoemaker:'סנדלרייה',electrician:'חשמלאי',plumber:'אינסטלטור',photographer:'סטודיו לצילום',tailor:'חייטות',locksmith:'מנעולן',metal_construction:'מסגרייה',brewery:'מבשלה',winery:'יקב',handicraft:'בית מלאכה',printer:'בית דפוס',caterer:'קייטרינג',stonemason:'עבודות אבן',pottery:'קדרייה'};
const HEALTHCARE={doctor:'מרפאה',doctors:'מרפאה',clinic:'מרפאה',hospital:'בית חולים',dentist:'מרפאת שיניים',pharmacy:'בית מרקחת',physiotherapist:'פיזיותרפיה',laboratory:'מעבדה רפואית',rehabilitation:'מרכז שיקום',centre:'מרכז בריאות',psychotherapist:'מרפאה טיפולית',optometrist:'אופטומטריה'};
const INVALID_VALUES=new Set(['no','vacant','closed','disused','abandoned','construction','proposed','demolished','yes_no']);

export function broadOsmCategory(tags){
  let sourceKey,sourceValue,category,poolGroup='businesses';
  if(AMENITY[tags.amenity]){
    sourceKey='amenity';sourceValue=tags.amenity;category=AMENITY[sourceValue];
    if(LANDMARK_AMENITIES.has(sourceValue))poolGroup='landmarks';
    if(sourceValue==='place_of_worship')category=({jewish:'בית כנסת',muslim:'מסגד',christian:'כנסייה',druze:'בית תפילה דרוזי',bahai:'אתר בהאי'})[tags.religion]||category;
  }else if(tags.shop&&!INVALID_VALUES.has(tags.shop)){
    sourceKey='shop';sourceValue=tags.shop;category=SHOPS[sourceValue]||'חנות';if(sourceValue==='mall')poolGroup='landmarks';
  }else if(TOURISM[tags.tourism]){
    sourceKey='tourism';sourceValue=tags.tourism;category=TOURISM[sourceValue];if(!BUSINESS_TOURISM.has(sourceValue))poolGroup='landmarks';
  }else if(LEISURE[tags.leisure]){
    sourceKey='leisure';sourceValue=tags.leisure;category=LEISURE[sourceValue];if(!BUSINESS_LEISURE.has(sourceValue))poolGroup='landmarks';
  }else if(HISTORIC[tags.historic]){
    sourceKey='historic';sourceValue=tags.historic;category=HISTORIC[sourceValue];poolGroup='landmarks';
  }else if(tags.office&&!INVALID_VALUES.has(tags.office)){
    sourceKey='office';sourceValue=tags.office;category=OFFICES[sourceValue]||'משרד';if(LANDMARK_OFFICES.has(sourceValue))poolGroup='landmarks';
  }else if(tags.craft&&!INVALID_VALUES.has(tags.craft)){
    sourceKey='craft';sourceValue=tags.craft;category=CRAFTS[sourceValue]||'בית מלאכה';
  }else if(tags.healthcare&&!INVALID_VALUES.has(tags.healthcare)){
    sourceKey='healthcare';sourceValue=tags.healthcare;category=HEALTHCARE[sourceValue]||'שירותי רפואה';if(sourceValue==='hospital')poolGroup='landmarks';
  }else return null;
  return {category,poolGroup,categoryEvidence:{key:sourceKey,value:sourceValue,...(sourceValue==='place_of_worship'&&tags.religion?{religion:tags.religion}:{})}};
}

function rejectionReason(element,tags){
  if(!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id))return'invalid_osm_identity';
  if(tags.military&&tags.military!=='no'||tags.landuse==='military')return'military_feature';
  if(['private','no'].includes(tags.access))return'nonpublic_access';
  if(['construction','proposed','abandoned','disused','demolished'].some(key=>tags[key]&&!['no','false','0'].includes(tags[key])))return'inactive_or_unbuilt';
  if(tags.highway==='bus_stop'||tags.public_transport==='platform')return'bus_stop_or_platform';
  if(['city','town','village','hamlet','isolated_dwelling','suburb','quarter','neighbourhood','borough','region','province','state','country','municipality'].includes(tags.place)
    ||tags.highway&&!['services','rest_area'].includes(tags.highway)
    ||['administrative','political','postal_code'].includes(tags.boundary))return'settlement_road_or_boundary';
  if(['house','residential','apartments','detached','semidetached_house','terrace','hut'].includes(tags.building)&&!tags.shop&&!AMENITY[tags.amenity])return'private_residential_building';
  return null;
}
const coordinatesOf=e=>{const p=e.type==='node'?e:e.center;return p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90?[p.lon,p.lat]:null;};
const candidateRank=p=>(p.coordinateKind==='node'?2:0)+(p.nameSource==='name:he'?1:0);
const brandKey=p=>p.brandWikidata?`wikidata:${p.brandWikidata}`:p.brand?`name:${normalizeOsmQuestionName(p.brand)}`:null;

/** Offline broad public-venue import; source tags stay in the ignored raw cache. */
export function importBroadOsm(document,{allowedGeoJSON}={}){
  if(!Array.isArray(document?.elements))throw new TypeError('Expected an Overpass elements array');
  if(document.remark)throw Error(`Incomplete Overpass response: ${document.remark}`);
  const candidates=[],rejected=[],seen=new Set();
  const reject=(element,reason)=>rejected.push({id:`osm/${element.type}/${element.id}`,reason});
  for(const element of document.elements){
    const tags=element.tags||{};
    const id=`osm/${element.type}/${element.id}`;
    if(seen.has(id))continue;seen.add(id);
    const invalid=rejectionReason(element,tags);if(invalid){reject(element,invalid);continue;}
    const nameSource=typeof tags['name:he']==='string'&&HEBREW.test(tags['name:he'])?'name:he':'name';
    const name=tags[nameSource];
    if(typeof name!=='string'||!name.trim()||!HEBREW.test(name)){reject(element,'no_hebrew_source_name');continue;}
    const classification=broadOsmCategory(tags);if(!classification){reject(element,'not_supported_physical_venue');continue;}
    const coordinates=coordinatesOf(element);if(!coordinates){reject(element,'no_usable_coordinates');continue;}
    if(allowedGeoJSON&&!pointInPlayArea(coordinates,allowedGeoJSON)){reject(element,'outside_play_area');continue;}
    const sourceUrl=`https://www.openstreetmap.org/${element.type}/${element.id}`;
    const qualityFlags=[];
    if(element.type!=='node')qualityFlags.push('geometry_bounds_center');
    if(/[()（）]/.test(name))qualityFlags.push('parenthetical_source_name');
    candidates.push({id,name,coordinates,...classification,nameSource,coordinateKind:element.type==='node'?'node':'bounds-center',sourceUrl,dataSource:'OpenStreetMap',dataLicense:'ODbL-1.0',wikidata:/^Q[1-9]\d*$/.test(tags.wikidata||'')?tags.wikidata:null,
      brand:tags['brand:he']||tags.brand||null,brandWikidata:/^Q[1-9]\d*$/.test(tags['brand:wikidata']||'')?tags['brand:wikidata']:null,
      city:tags['addr:city']||'',qualityFlags,sources:[{id,url:sourceUrl}],...(tags['official_name:he']?{officialName:tags['official_name:he']}:{})});
  }
  const nodeCoordinates=new Map(candidates.filter(p=>p.coordinateKind==='node').map(p=>[p.id,p.coordinates]));
  const places=[],index=new Map();
  for(const candidate of candidates){
    const nameKey=`${candidate.category}:${normalizeOsmQuestionName(candidate.name)}`;
    const identityKey=candidate.wikidata?`${candidate.category}:wikidata:${candidate.wikidata}`:null;
    const nearby=[...new Set([...(index.get(nameKey)||[]),...(identityKey?index.get(identityKey)||[]:[])])].find(i=>haversineMeters(places[i].coordinates,candidate.coordinates)<80);
    if(nearby===undefined){
      const i=places.push(candidate)-1;index.set(nameKey,[...(index.get(nameKey)||[]),i]);if(identityKey)index.set(identityKey,[...(index.get(identityKey)||[]),i]);
    }else{
      const old=places[nearby],chosen=candidateRank(candidate)>candidateRank(old)?candidate:old;
      const sources=[...new Map([...old.sources,...candidate.sources].map(s=>[s.id,s])).values()];
      const sourceNodes=sources.filter(source=>nodeCoordinates.has(source.id)).map(source=>({id:source.id,coordinates:nodeCoordinates.get(source.id)}));
      let maxNodeSeparationMeters=0;
      for(let i=0;i<sourceNodes.length;i++)for(let j=i+1;j<sourceNodes.length;j++)maxNodeSeparationMeters=Math.max(maxNodeSeparationMeters,haversineMeters(sourceNodes[i].coordinates,sourceNodes[j].coordinates));
      const uncertainMultiNodeMerge=maxNodeSeparationMeters>10+0.000001;
      const qualityFlags=[...new Set([...old.qualityFlags,...candidate.qualityFlags,...(uncertainMultiNodeMerge?['uncertain_multi_node_merge']:[])])];
      places[nearby]={...chosen,sources,qualityFlags,sourceNames:[...new Set([...(old.sourceNames||[old.name]),candidate.name])],...(uncertainMultiNodeMerge?{mergeEvidence:{sourceNodes,maxNodeSeparationMeters,reviewThresholdMeters:10}}:{})};
      if(!(index.get(nameKey)||[]).includes(nearby))index.set(nameKey,[...(index.get(nameKey)||[]),nearby]);
      if(identityKey&&!(index.get(identityKey)||[]).includes(nearby))index.set(identityKey,[...(index.get(identityKey)||[]),nearby]);
    }
  }
  return {source:'OpenStreetMap contributors',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright',sourceTimestamp:document.osm3s?.timestamp_osm_base,places,rejected,
    stats:{sourceElements:document.elements.length,retainedBeforeDedup:candidates.length,places:places.length,deduplicated:candidates.length-places.length,rejected:rejected.length,uncertainMultiNodeMergeGroups:places.filter(p=>p.qualityFlags.includes('uncertain_multi_node_merge')).length}};
}

function ambiguityReport(places,mode,{strictBrands=false}={}){
  const named=new Map(),branded=new Map(),blocked=new Set(),nameBlocked=new Set();
  for(let i=0;i<places.length;i++)if(places[i].qualityFlags?.includes('uncertain_multi_node_merge'))blocked.add(i);
  const sourceQualityHeldQuestions=blocked.size;
  for(let i=0;i<places.length;i++){
    const p=places[i],cell=gridCell(p.coordinates,mode).id,key=`${cell}:${p.category}:${normalizeOsmQuestionName(p.name)}`;
    named.set(key,[...(named.get(key)||[]),i]);
    const brand=brandKey(p);if(brand){const brandGroup=`${cell}:${brand}`;branded.set(brandGroup,[...(branded.get(brandGroup)||[]),i]);}
  }
  const nameCollisions=[...named.values()].filter(group=>group.length>1),brandCollisions=[...branded.values()].filter(group=>group.length>1);
  for(const group of nameCollisions)for(const i of group){blocked.add(i);nameBlocked.add(i);}
  const nameOnlyBlocked=blocked.size;
  if(strictBrands)for(const group of brandCollisions)for(const i of group)blocked.add(i);
  const usable=places.filter((p,i)=>!blocked.has(i));
  return {mode,places:places.length,sourceQualityHeldQuestions,nameCollisionGroups:nameCollisions.length,nameCollisionQuestions:nameBlocked.size,taggedBrandCollisionGroups:brandCollisions.length,strictBrandAdditionalQuestions:blocked.size-nameOnlyBlocked,usableQuestions:usable.length,distinctUsableNamesAndCategories:new Set(usable.map(p=>`${p.category}:${normalizeOsmQuestionName(p.name)}`)).size,
    usableByPool:{landmarks:usable.filter(p=>p.poolGroup==='landmarks').length,businesses:usable.filter(p=>p.poolGroup==='businesses').length},
    examples:nameCollisions.slice(0,10).map(group=>({name:places[group[0]].name,category:places[group[0]].category,cell:gridCell(places[group[0]].coordinates,mode).id,count:group.length})),
  };
}

export function summarizeBroadOsm(imported){
  const {places}=imported,counts={};for(const p of places)counts[p.category]=(counts[p.category]||0)+1;
  const rejectedReasons={};for(const p of imported.rejected)rejectedReasons[p.reason]=(rejectedReasons[p.reason]||0)+1;
  return {source:'OpenStreetMap contributors',license:'ODbL-1.0',sourceTimestamp:imported.sourceTimestamp,stats:imported.stats,countsByPool:{landmarks:places.filter(p=>p.poolGroup==='landmarks').length,businesses:places.filter(p=>p.poolGroup==='businesses').length},globalUniqueNamesAndCategories:new Set(places.map(p=>`${p.category}:${normalizeOsmQuestionName(p.name)}`)).size,categories:Object.entries(counts).sort((a,b)=>b[1]-a[1]),rejectedReasons,
    nameAmbiguity:['normal','hard'].map(mode=>ambiguityReport(places,mode)),strictNameAndTaggedBrandAmbiguity:['normal','hard'].map(mode=>ambiguityReport(places,mode,{strictBrands:true})),
    limitations:'Source-screened OSM snapshot, not an on-site venue verification. Hebrew source names only. Point-in-polygon clipping follows the selected play area. Way/relation targets use bounds centres. Proximity merges containing distinct source nodes over 10m apart are flagged and excluded from usable-question counts pending review. Same-name/category and tagged-brand collision groups are held in full rather than counted as separate usable questions within a hinted block.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [input,output,mask,report]=process.argv.slice(2);
  if(!input||!output||!mask)throw Error('Usage: node scripts/import-osm-broad.mjs raw.json output.json play-area.geojson [report.json]');
  if([input,mask].some(path=>resolve(path)===resolve(output))||report&&[input,mask,output].some(path=>resolve(path)===resolve(report)))throw Error('Output paths must not overwrite an input or each other');
  const [raw,allowedGeoJSON]=await Promise.all([readFile(input,'utf8').then(JSON.parse),readFile(mask,'utf8').then(JSON.parse)]);
  const result=importBroadOsm(raw,{allowedGeoJSON});
  await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  const summary=summarizeBroadOsm(result);if(report)await writeFile(report,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({stats:result.stats,pools:summary.countsByPool,uniqueNamesAndCategories:summary.globalUniqueNamesAndCategories,strictUsable:summary.strictNameAndTaggedBrandAmbiguity.map(({mode,usableQuestions})=>({mode,usableQuestions}))}));
}
