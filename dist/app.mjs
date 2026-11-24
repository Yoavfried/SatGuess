import { MODE_CONFIG, gridCell, haversineMeters, scoreGuess, maxRoundScore, answerRadiusMeters, geodesicCircle, pointInHintCell } from './rules.mjs';
import { createImageryProtocol, pointInPlayArea } from './imagery-loader.mjs';

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('he-IL').format(n);
const EMPTY = {type:'FeatureCollection',features:[]};
const countryBounds = [[34.18,29.45],[35.96,33.4]];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let map, pool=[], rounds=[], results=[], roundIndex=0, mode='normal', guess=null, playArea=null, imageryProtocol=null;
let guessedPoint=null, activeCell=null, submitted=false, mapReady=false, roadsVisible=true, gridVisible=true;
let loadedImagery=false, tilesFailed=false, finished=false;
let collection='landmarks';
const COLLECTION_NAMES={landmarks:'אתרים ומוסדות',all:'המאגר הרחב'};
const bestKey = (m,c=collection) => `on-the-map-best-v4-pools-${m}-${c}`;
const readBest = (m,c=collection) => {try{return Number(localStorage.getItem(bestKey(m,c)))||0;}catch{return 0;}};
function saveBest(m,value){try{localStorage.setItem(bestKey(m),String(value));}catch{}}
const totalScore = () => results.reduce((sum,r)=>sum+r.score,0);
function setStatus(text){$('map-status').textContent=text;}
function showDialog(id){if(!$(id).open)$(id).showModal();}
function hideDialog(id){$(id).close();}
function shuffled(items){const out=[...items];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
function playablePool(m=mode,c=collection){return pool.filter(p=>(c==='all'||p.poolGroup!=='businesses')&&(!p.eligibleModes||p.eligibleModes.includes(m)));}
function chooseRounds(items){const candidates=shuffled(items),chosen=[],cells=new Set();for(const p of candidates){const id=gridCell(p.coordinates,'hard').id;if(cells.has(id))continue;chosen.push(p);cells.add(id);if(chosen.length===5)return chosen;}return [...chosen,...candidates.filter(p=>!chosen.includes(p))].slice(0,5);}
function distanceText(m){return m<1000?`${fmt(Math.round(m))} מטרים`:`${new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(m/1000)} ק״מ`;}
function feature(geometry,properties={}){return {type:'Feature',geometry,properties};}
function fc(features){return {type:'FeatureCollection',features};}
function setData(id,data){map?.getSource(id)?.setData(data);}
function updateGrid(){
  if(!mapReady)return;
  const b=map.getBounds(),cfg=MODE_CONFIG[mode],lines=[];
  const w=Math.max(33,b.getWest()),e=Math.min(37,b.getEast()),s=Math.max(28.5,b.getSouth()),n=Math.min(34.3,b.getNorth());
  for(let x=Math.floor(w/cfg.longitudeStep)*cfg.longitudeStep;x<=e+cfg.longitudeStep;x+=cfg.longitudeStep){lines.push(feature({type:'LineString',coordinates:[[x,s],[x,n]]}));}
  for(let y=Math.floor(s/cfg.latitudeStep)*cfg.latitudeStep;y<=n+cfg.latitudeStep;y+=cfg.latitudeStep){lines.push(feature({type:'LineString',coordinates:[[w,y],[e,y]]}));}
  setData('grid',fc(lines));
}
function homeMap(){map?.fitBounds(countryBounds,{padding:innerWidth<761?{top:45,bottom:55,left:45,right:28}:65,duration:reducedMotion?0:750});}
function markerElement(color){
  const el=document.createElement('div');el.className='marker';el.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 36S2 22 2 15a13 13 0 1 1 26 0c0 7-13 21-13 21Z" fill="${color}" stroke="#17251e" stroke-width="1.7"/><circle cx="15" cy="15" r="4.7" fill="#1d2c21"/></svg>`;return el;
}
function putGuess(point){
  if(!mapReady||submitted||finished||!rounds.length)return;
  const next=[point.lng??point[0],point.lat??point[1]];
  if(!pointInHintCell(next,activeCell)||!pointInPlayArea(next,playArea)){if(guess&&guessedPoint)guess.setLngLat(guessedPoint);return;}
  guessedPoint=next;
  if(!guess){guess=new maplibregl.Marker({element:markerElement('#d4ed8b'),anchor:'bottom',draggable:true}).setLngLat(guessedPoint).addTo(map);guess.on('dragend',()=>{const p=guess.getLngLat();putGuess(p);});}
  else guess.setLngLat(guessedPoint);
  $('submit-button').disabled=false;$('submit-button').textContent='אישור ניחוש';
  setStatus('הסיכה במקום. אפשר להזיז אותה או לאשר את הניחוש.');
}
function updateRoundDots(){
  $('round-label').textContent=`סיבוב ${Math.min(roundIndex+1,5)} מתוך 5`;
  $('round-dots').replaceChildren(...Array.from({length:5},(_,i)=>{const dot=document.createElement('i');dot.className=i<results.length?'done':i===roundIndex?'current':'';return dot;}));
}
function startGame(newMode=mode,selectedRounds=null,newCollection=collection){
  const available=playablePool(newMode,newCollection);
  if(available.length<5){setStatus('אין מספיק מקומות זמינים בבחירה הזו. בחרו מאגר או רמה אחרים.');return false;}
  mode=newMode;collection=newCollection;rounds=selectedRounds||chooseRounds(available);results=[];roundIndex=0;finished=false;
  $('total-score').textContent='0';startRound();
  return true;
}
function startRound(){
  guessedPoint=null;submitted=false;guess?.remove();guess=null;
  setData('hint',EMPTY);setData('connection',EMPTY);setData('answer',EMPTY);
  const place=rounds[roundIndex];
  $('place-name').textContent=place.name;
  $('place-category').textContent=place.category||'';$('place-category').hidden=!place.category;
  activeCell=gridCell(place.coordinates,mode);
  $('block-button').disabled=!mapReady;
  $('block-size').textContent=`כ־${MODE_CONFIG[mode].cellKm} ק״מ`;
  $('guess-section').hidden=false;$('result').hidden=true;$('submit-button').disabled=true;$('submit-button').textContent='בחרו נקודה במפה';
  $('center-pin').disabled=!mapReady;updateRoundDots();updateGrid();focusBlock(false);
}
function focusBlock(animate=true){
  if(!mapReady||!activeCell||submitted||finished)return;
  const c=activeCell;
  setData('hint',fc([feature({type:'Polygon',coordinates:[[[c.west,c.south],[c.east,c.south],[c.east,c.north],[c.west,c.north],[c.west,c.south]]]})]));
  map.fitBounds([[c.west,c.south],[c.east,c.north]],{padding:innerWidth<761?{top:65,bottom:45,left:65,right:35}:90,duration:animate&&!reducedMotion?650:0});
  setStatus('המקום בתוך המשבצת הירוקה. לחצו כדי להניח סיכה.');
}
function submitGuess(){
  if(!guessedPoint||submitted||finished||!mapReady)return;
  submitted=true;guess.setDraggable(false);const place=rounds[roundIndex];
  const centerDistance=haversineMeters(guessedPoint,place.coordinates),distance=Math.max(0,centerDistance-answerRadiusMeters),score=scoreGuess(centerDistance,activeCell);
  results.push({place,distance,centerDistance,score,block:activeCell.id,guess:[...guessedPoint]});
  setData('answer',fc([feature(geodesicCircle(place.coordinates,answerRadiusMeters))]));
  setData('connection',fc([feature({type:'LineString',coordinates:[guessedPoint,place.coordinates]})]));
  $('guess-section').hidden=true;$('result').hidden=false;$('block-button').disabled=true;$('center-pin').disabled=true;
  $('round-score').textContent=fmt(score);$('result-distance').textContent=distance===0?'הסיכה בתוך רדיוס 10 המטרים של המקום.':`מרחק מגבול אזור המקום: ${distanceText(distance)}.`;
  $('total-score').textContent=fmt(totalScore());
  $('place-source').href=place.sourceUrl;$('place-source').textContent=`מקור המקום: ${place.sourceLabel||(/wikidata/.test(place.sourceUrl)?'Wikidata':/openstreetmap/.test(place.sourceUrl)?'OpenStreetMap':place.dataSource||'מקור הנתונים')}`;
  $('next-button').textContent=roundIndex===4?'לתוצאות המשחק':'לסיבוב הבא';updateRoundDots();
  const b=new maplibregl.LngLatBounds();b.extend(guessedPoint);b.extend(place.coordinates);
  map.fitBounds(b,{padding:innerWidth<761?{top:65,bottom:55,left:65,right:40}:110,maxZoom:18,duration:reducedMotion?0:1000});
  setStatus('ירוק: הניחוש שלכם · אדום: רדיוס 10 מטרים סביב המקום');
}
function showSummary(){
  finished=true;const score=totalScore(),old=readBest(mode);if(score>old)saveBest(mode,score);
  $('summary-title').textContent='סוף המשחק';
  $('summary-score').textContent=fmt(score);
  $('summary-best').textContent=score>old?`שיא אישי חדש · ${COLLECTION_NAMES[collection]} · ${MODE_CONFIG[mode].name}!`:`${COLLECTION_NAMES[collection]} · ${MODE_CONFIG[mode].name} · השיא שלכם: ${fmt(Math.max(old,score))}`;
  $('summary-rounds').replaceChildren(...results.map(r=>{const row=document.createElement('div'),name=document.createElement('span'),dist=document.createElement('small'),points=document.createElement('strong');name.textContent=r.place.name;dist.textContent=distanceText(r.distance);points.textContent=fmt(r.score);row.append(name,dist,points);return row;}));
  showDialog('summary-dialog');
}
function toggleLayer(button,ids,current){const next=!current;$(button).setAttribute('aria-pressed',String(next));for(const id of ids)if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',next?'visible':'none');return next;}

async function initialize(){
  try{
    const [p,s]=await Promise.all([fetch('places.json'),fetch('map-style.json')]);
    if(!p.ok||!s.ok)throw Error('Local data unavailable');
    const data=await p.json(),style=await s.json();
    playArea=style.metadata?.playArea;
    if(!playArea)throw Error('Missing play-area geometry');
    pool=data.places.filter(p=>Array.isArray(p.coordinates)&&p.coordinates.every(Number.isFinite)&&p.name&&p.sourceUrl&&pointInPlayArea(p.coordinates,playArea));
    if(pool.length<5)throw Error('Not enough places');
      if(!globalThis.maplibregl?.Map)throw Error('WebGL unavailable');
    imageryProtocol=createImageryProtocol({allowedGeoJSON:playArea,...style.metadata.imagery,onEvent:event=>{if(imageryProtocol)$('map').dataset.imageryStats=JSON.stringify(imageryProtocol.getStats());if(event.type==='coverage'&&event.fallbackPixels>0)$('eox-credit').hidden=false;}});
    maplibregl.addProtocol('surveyclip',imageryProtocol);
    const initialRounds=chooseRounds(playablePool()),initialCell=gridCell(initialRounds[0].coordinates,mode);
    map=new maplibregl.Map({container:'map',style,bounds:[[initialCell.west,initialCell.south],[initialCell.east,initialCell.north]],fitBoundsOptions:{padding:innerWidth<761?{top:65,bottom:45,left:65,right:35}:90},minZoom:5.7,maxZoom:18,maxBounds:[[31,27],[39,36]],dragRotate:false,pitchWithRotate:false,touchPitch:false,attributionControl:false,locale:{'Map.Title':'מפת המשחק','AttributionControl.ToggleAttribution':'מקורות מידע'}});
    map.touchZoomRotate.disableRotation();
    
    map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
    map.on('load',()=>{
      mapReady=true;loadedImagery=map.isSourceLoaded('play-imagery');
      for(const id of ['grid','hint','connection','answer'])map.addSource(id,{type:'geojson',data:EMPTY});
      map.addLayer({id:'hint-fill',type:'fill',source:'hint',paint:{'fill-color':'#d4ed8b','fill-opacity':.13}},'outside-play-area');
      map.addLayer({id:'grid-lines',type:'line',source:'grid',paint:{'line-color':'#e3edca','line-opacity':['interpolate',['linear'],['zoom'],6,.18,11,.38,15,.5],'line-width':.7}},'outside-play-area');
      map.addLayer({id:'hint-outline',type:'line',source:'hint',paint:{'line-color':'#dbf392','line-width':2.5,'line-dasharray':[4,2]}},'outside-play-area');
      map.addLayer({id:'connection-line',type:'line',source:'connection',paint:{'line-color':'#e6efbd','line-width':2.2,'line-dasharray':[2,2]}},'outside-play-area');
      map.addLayer({id:'answer-fill',type:'fill',source:'answer',paint:{'fill-color':'#ef5f63','fill-opacity':.22}},'outside-play-area');
      map.addLayer({id:'answer-outline',type:'line',source:'answer',paint:{'line-color':'#ff6469','line-width':2}},'outside-play-area');
      startGame(mode,initialRounds);updateBest();
    });
    map.on('moveend',updateGrid);
    map.on('click',e=>putGuess(e.lngLat));
    map.on('mousemove',e=>{if(!submitted&&!finished){const p=[e.lngLat.lng,e.lngLat.lat];map.getCanvas().style.cursor=pointInHintCell(p,activeCell)&&pointInPlayArea(p,playArea)?'crosshair':'not-allowed';}});
    map.on('sourcedata',e=>{if(e.sourceId==='play-imagery'&&e.isSourceLoaded){loadedImagery=true;$('map-error').hidden=true;}});
    map.on('error',e=>{console.warn('Map resource failed',e.error?.message);if(e.sourceId==='play-imagery'||/imagery|eox\.at|tiles\.arcgis\.com/.test(e.error?.message||'')){tilesFailed=true;if(mapReady)setStatus('חלק מהתצלומים לא נטענו. בדקו את החיבור לאינטרנט.');}});
    setTimeout(()=>{if(!mapReady||(!loadedImagery&&tilesFailed))$('map-error').hidden=false;},22000);
  }catch(error){console.error(error);$('map-error').hidden=false;$('place-name').textContent='המשחק עדיין לא נטען';setStatus('בדקו חיבור לאינטרנט ונסו שוב.');}
}
$('block-button').addEventListener('click',()=>focusBlock());
$('submit-button').addEventListener('click',submitGuess);
$('next-button').addEventListener('click',()=>{if(!submitted)return;if(roundIndex===4)showSummary();else{roundIndex++;startRound();}});
$('zoom-in').addEventListener('click',()=>map?.zoomIn({duration:reducedMotion?0:250}));
$('zoom-out').addEventListener('click',()=>map?.zoomOut({duration:reducedMotion?0:250}));
$('home-map').addEventListener('click',homeMap);
$('center-pin').addEventListener('click',()=>{if(map)putGuess(map.getCenter());});
$('answer-focus').addEventListener('click',()=>{if(submitted&&rounds.length)map.flyTo({center:rounds[roundIndex].coordinates,zoom:18,duration:reducedMotion?0:650});});
$('grid-toggle').addEventListener('click',()=>{gridVisible=toggleLayer('grid-toggle',['grid-lines'],gridVisible);});
$('roads-toggle').addEventListener('click',()=>{if(map)roadsVisible=toggleLayer('roads-toggle',map.getStyle().layers.filter(l=>l.id.startsWith('osm-')).map(l=>l.id),roadsVisible);});
$('about-open').addEventListener('click',()=>showDialog('about-dialog'));
$('settings-open').addEventListener('click',()=>{document.querySelector(`input[name="difficulty"][value="${mode}"]`).checked=true;document.querySelector(`input[name="collection"][value="${collection}"]`).checked=true;updateBest();showDialog('settings-dialog');});
function updateBest(){const m=document.querySelector('input[name="difficulty"]:checked').value,c=document.querySelector('input[name="collection"]:checked').value;$('best-score').textContent=`השיא שלכם בהגדרות אלו: ${fmt(readBest(m,c))} נקודות`;for(const key of Object.keys(COLLECTION_NAMES))$(`${key}-count`).textContent=`${fmt(playablePool(m,key).length)} מקומות זמינים`;const available=playablePool(m,c).length;$('start-new').disabled=!mapReady||available<5;}
document.querySelectorAll('input[name="difficulty"],input[name="collection"]').forEach(el=>el.addEventListener('change',updateBest));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
$('start-new').addEventListener('click',()=>{if(!pool.length)return;const m=document.querySelector('input[name="difficulty"]:checked').value,c=document.querySelector('input[name="collection"]:checked').value;if(startGame(m,null,c))hideDialog('settings-dialog');});
$('play-again').addEventListener('click',()=>{hideDialog('summary-dialog');startGame();});
$('summary-close').addEventListener('click',()=>hideDialog('summary-dialog'));
$('reload-map').addEventListener('click',()=>location.reload());
initialize();
