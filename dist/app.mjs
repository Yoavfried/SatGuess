import {MODE_CONFIG,gridCell,geodesicCircle,pointInHintCell} from './rules.mjs';
import {createImageryProtocol,pointInPlayArea} from './imagery-loader.mjs';
import {createGameApi,createGuessKey} from './game-api.mjs';
import {renderDailyLeaderboard,renderGuessPercentile} from './results-view.mjs';

const $=id=>document.getElementById(id),api=createGameApi({baseUrl:new URL('./api',document.baseURI).pathname});
const fmt=n=>new Intl.NumberFormat('he-IL').format(n);
const EMPTY={type:'FeatureCollection',features:[]},countryBounds=[[34.18,29.45],[35.96,33.4]];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const collectionNames={landmarks:'אתרים ומוסדות',all:'המאגר הרחב'};
let map,playArea,imageryProtocol,boot,run,guess,guessedPoint=null,activeCell=null,mapReady=false;
let mode='normal',collection='landmarks',roadsVisible=true,gridVisible=true,busy=false,generation=0;
let clockOffset=0,timer=null,draftSequence=0,draftRequest=Promise.resolve(),submissionKey=null,retryAction=null;
const feature=(geometry,properties={})=>({type:'Feature',geometry,properties});
const fc=features=>({type:'FeatureCollection',features});
const setData=(id,data)=>map?.getSource(id)?.setData(data);
const setStatus=text=>{$('map-status').textContent=text;};
const showDialog=id=>{if(!$(id).open)$(id).showModal();};
const hideDialog=id=>$(id).close();
const active=()=>run?.state==='active'&&run.status!=='completed';
const bestKey=(m,c)=>`on-the-map-best-v4-pools-${m}-${c}`;
function readBest(m,c){try{return Number(localStorage.getItem(bestKey(m,c)))||0;}catch{return 0;}}
function distanceText(m){return m===null?'ללא ניחוש':m<1000?`${fmt(Math.round(m))} מטרים`:`${new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(m/1000)} ק״מ`;}
function clearError(){$('game-error').hidden=true;$('retry-action').hidden=true;retryAction=null;}
function showError(error,retry){$('game-error').textContent=error.message||'לא הצלחנו לשמור את הפעולה. נסו שוב.';$('game-error').hidden=false;retryAction=retry;$('retry-action').hidden=!retry;}
function syncControls(){
  $('submit-button').disabled=busy||!active()||!guessedPoint;
  $('center-pin').disabled=busy||!mapReady||!active();
  $('block-button').disabled=!mapReady||!activeCell;
  $('daily-start').disabled=busy||!mapReady;$('start-new').disabled=busy||!mapReady;
  $('next-button').disabled=busy;
  guess?.setDraggable(active()&&!busy);
}
async function action(fn){if(busy)return;busy=true;clearError();syncControls();try{await fn();}catch(error){const resumeId=run?.state==='prepared'?run.runId:null;showError(error,()=>action(resumeId?async()=>acceptRun(await api.resume(resumeId)):fn));}finally{busy=false;syncControls();}}
function updateGrid(){
  if(!mapReady)return;
  const b=map.getBounds(),cfg=MODE_CONFIG[mode],lines=[];
  const w=Math.max(33,b.getWest()),e=Math.min(37,b.getEast()),s=Math.max(28.5,b.getSouth()),n=Math.min(34.3,b.getNorth());
  for(let x=Math.floor(w/cfg.longitudeStep)*cfg.longitudeStep;x<=e+cfg.longitudeStep;x+=cfg.longitudeStep)lines.push(feature({type:'LineString',coordinates:[[x,s],[x,n]]}));
  for(let y=Math.floor(s/cfg.latitudeStep)*cfg.latitudeStep;y<=n+cfg.latitudeStep;y+=cfg.latitudeStep)lines.push(feature({type:'LineString',coordinates:[[w,y],[e,y]]}));
  setData('grid',fc(lines));
}
function homeMap(){map?.fitBounds(countryBounds,{padding:innerWidth<761?45:65,duration:reducedMotion?0:650});}
function markerElement(){
  const el=document.createElement('div');el.className='marker';
  el.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 36S2 22 2 15a13 13 0 1 1 26 0c0 7-13 21-13 21Z" fill="#d4ed8b" stroke="#17251e" stroke-width="1.7"/><circle cx="15" cy="15" r="4.7" fill="#1d2c21"/></svg>';return el;
}
function drawGuess(point){
  guessedPoint=point?[...point]:null;
  if(!point){guess?.remove();guess=null;return;}
  if(!guess){guess=new maplibregl.Marker({element:markerElement(),anchor:'bottom',draggable:active()&&!busy}).setLngLat(point).addTo(map);guess.on('dragend',()=>putGuess(guess.getLngLat()));}
  else guess.setLngLat(point);
}
function putGuess(point){
  if(!mapReady||!active()||busy)return;
  const next=[point.lng??point[0],point.lat??point[1]];
  if(!pointInHintCell(next,activeCell)||!pointInPlayArea(next,playArea)){if(guess&&guessedPoint)guess.setLngLat(guessedPoint);return;}
  drawGuess(next);$('submit-button').textContent='אישור ניחוש';syncControls();
  const runId=run.runId,roundId=run.currentRound.id,sequence=++draftSequence;
  // Send each pin in order. A failed save must not prevent a later pin from saving.
  draftRequest=draftRequest.catch(()=>{}).then(()=>api.saveDraft(runId,next,{roundId,sequence})).then(nextRun=>{
    if(run?.runId===runId&&run.currentRound.id===roundId&&nextRun.state!=='active')return action(async()=>acceptRun(nextRun));
  }).catch(error=>{if(run?.runId===runId&&run.currentRound.id===roundId&&active())showError(error,()=>action(async()=>acceptRun(await api.resume(runId))));});
  setStatus('הסיכה במקום. אפשר להזיז אותה או לאשר.');
}
function focusBlock(animate=true){
  if(!mapReady||!activeCell)return;const c=activeCell;
  setData('hint',fc([feature({type:'Polygon',coordinates:[[[c.west,c.south],[c.east,c.south],[c.east,c.north],[c.west,c.north],[c.west,c.south]]]})]));
  map.fitBounds([[c.west,c.south],[c.east,c.north]],{padding:innerWidth<761?{top:60,bottom:40,left:65,right:35}:90,duration:animate&&!reducedMotion?600:0});
}
function waitForImagery(token){return new Promise((resolve,reject)=>{
  const end=Date.now()+8000;let consecutive=0;
  const poll=()=>{if(token!==generation||!mapReady){resolve();return;}consecutive=map.isSourceLoaded('play-imagery')?consecutive+1:0;if(consecutive>=2){resolve();return;}if(Date.now()>=end){reject(Error('התצלום עדיין לא נטען. נסו שוב; הזמן לניחוש עדיין לא התחיל.'));return;}setTimeout(poll,150);};
  setTimeout(poll,150);
});}
function updateProgress(){
  $('total-score').textContent=fmt(run?.totalScore||0);
  $('round-label').textContent=run?.status==='completed'?'המשחק הסתיים':`סיבוב ${(run?.roundIndex||0)+1} מתוך 5`;
  $('round-dots').replaceChildren(...Array.from({length:5},(_,i)=>{const dot=document.createElement('i');dot.className=run?.results.some(r=>r.roundIndex===i)?'done':i===run?.roundIndex?'current':'';return dot;}));
  for(const kind of ['practice','daily']){const button=$(`nav-${kind}`);if(run?.kind===kind)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  $('settings-open').hidden=run?.kind==='daily';
}
function stopTimer(){clearInterval(timer);timer=null;$('round-timer').hidden=true;}
function startTimer(){
  stopTimer();if(!active()||run.currentRound.deadlineAt===null)return;
  $('round-timer').hidden=false;let settling=false;
  const tick=()=>{
    if(!active()){stopTimer();return;}
    const left=Math.max(0,Math.ceil((run.currentRound.deadlineAt-Date.now()-clockOffset)/1000));
    $('seconds-left').textContent=fmt(left);$('round-timer').classList.toggle('urgent',left<=5);
    if(left===0&&!settling&&!busy){settling=true;action(async()=>acceptRun(await api.resume(run.runId))).finally(()=>{settling=false;});}
  };tick();timer=setInterval(tick,250);
}
async function acceptRun(nextRun,{openSummary=true}={}){
  const token=++generation,previousId=run?.currentRound.id;
  stopTimer();run=nextRun;clockOffset=run.serverNow-Date.now();mode=run.mode;collection=run.collection;activeCell=run.currentRound.cell;
  if(previousId!==run.currentRound.id){submissionKey=null;draftSequence=0;draftRequest=Promise.resolve();}
  draftSequence=Math.max(draftSequence,run.currentRound.draftSequence??0);
  clearError();updateProgress();updateBest();
  setData('connection',EMPTY);setData('answer',EMPTY);drawGuess(run.currentRound.draftGuess);
  $('block-size').textContent=`כ־${MODE_CONFIG[mode].cellKm} ק״מ`;
  $('result').hidden=true;$('guess-section').hidden=false;$('submit-button').textContent=guessedPoint?'אישור ניחוש':'בחרו נקודה במפה';
  const prompt=run.currentRound.prompt;
  $('place-name').textContent=prompt?.name||'טוענים את המשבצת…';$('place-category').textContent=prompt?.category||'';$('place-category').hidden=!prompt?.category;
  syncControls();updateGrid();
  if(run.status==='completed'){
    const last=run.results.at(-1);if(last)showResult(last);
    if(openSummary)await showSummary();return;
  }
  if(run.state==='round_result'){
    if(run.kind==='daily'){for(const id of ['about-dialog','leaderboard-dialog','daily-dialog'])hideDialog(id);await acceptRun(await api.nextRound(run.runId,{roundId:run.currentRound.id}));return;}
    showResult(run.currentRound.result);return;
  }
  focusBlock(false);
  if(run.state==='prepared'||run.state==='pending'){
    // The question name and clock are issued only after the map has had time to load.
    await waitForImagery(token);if(token!==generation)return;
    await acceptRun(await api.startRound(run.runId,{roundId:run.currentRound.id}));return;
  }
  startTimer();setStatus('בחרו נקודה במשבצת הירוקה.');syncControls();
}
function showResult(result){
  if(!result?.answer)return;
  const answer=result.answer,point=answer.coordinates;drawGuess(result.guessCoordinates);
  activeCell=gridCell(point,mode);focusBlock(false);
  guess?.setDraggable(false);setData('answer',fc([feature(geodesicCircle(point,answer.radiusMeters))]));
  if(result.guessCoordinates)setData('connection',fc([feature({type:'LineString',coordinates:[result.guessCoordinates,point]})]));
  $('place-name').textContent=answer.name;$('place-category').textContent=answer.category;$('place-category').hidden=!answer.category;
  $('guess-section').hidden=true;$('result').hidden=false;$('round-score').textContent=fmt(result.score);
  $('result-distance').textContent=result.edgeDistanceMeters===0?'הסיכה בתוך רדיוס 10 המטרים של המקום.':result.guessCoordinates?`מרחק מגבול המקום: ${distanceText(result.edgeDistanceMeters)}.`:'לא נשלח ניחוש בזמן.';
  $('place-source').href=answer.sourceUrl||'#';$('place-source').textContent=`מקור המקום: ${answer.sourceLabel}`;
  $('next-button').textContent=run.status==='completed'?'לתוצאות המשחק':'לסיבוב הבא';
  $('guess-percentile').hidden=true;
  if(run.kind==='practice'){
    const id=run.runId;
    api.runStatistics(id).then(stats=>{const row=stats.rounds.find(r=>r.roundIndex===result.roundIndex);if(run?.runId===id&&row){renderGuessPercentile($('guess-percentile'),row);$('guess-percentile').hidden=false;}}).catch(()=>{});
  }
  $('answer-focus').onclick=()=>map.flyTo({center:point,zoom:18,duration:reducedMotion?0:650});
  const bounds=new maplibregl.LngLatBounds();bounds.extend(point);if(result.guessCoordinates)bounds.extend(result.guessCoordinates);
  map.fitBounds(bounds,{padding:innerWidth<761?65:110,maxZoom:18,duration:reducedMotion?0:650});
  setStatus('ירוק: הניחוש שלכם. אדום: רדיוס 10 מטרים סביב המקום.');syncControls();
}
async function showSummary(){
  stopTimer();const completed=run;
  $('summary-title').textContent=run.kind==='daily'?'האתגר היומי הושלם':'סוף המשחק';$('summary-score').textContent=fmt(run.totalScore);
  const old=readBest(mode,collection);
  if(run.kind==='practice'&&run.totalScore>old){try{localStorage.setItem(bestKey(mode,collection),String(run.totalScore));}catch{}}
  $('summary-best').textContent=run.kind==='daily'?`${run.dayKey} · האתגר הבא בחצות`:`${collectionNames[collection]} · ${MODE_CONFIG[mode].name} · השיא שלכם: ${fmt(Math.max(old,run.totalScore))}`;
  $('summary-rounds').replaceChildren(...run.results.map(result=>{
    const row=document.createElement('div'),name=document.createElement('button'),distance=document.createElement('small'),score=document.createElement('strong');
    name.className='text-button';name.textContent=result.answer?.name||`סיבוב ${result.roundIndex+1}`;name.onclick=()=>{hideDialog('summary-dialog');showResult(result);};
    distance.textContent=distanceText(result.edgeDistanceMeters);score.textContent=fmt(result.score);row.dataset.roundIndex=result.roundIndex;row.append(name,distance,score);return row;
  }));
  $('play-again').textContent=run.kind==='daily'?'מעבר לאימון':'משחק נוסף';
  $('daily-results').replaceChildren();$('run-statistics').replaceChildren();showDialog('summary-dialog');
  const jobs=[api.runStatistics(run.runId).then(stats=>{
    if(run?.runId!==completed.runId)return;let ready=0;
    for(const item of stats.rounds){if(item.status!=='ready'||item.sampleSize<30)continue;const row=$('summary-rounds').querySelector(`[data-round-index="${item.roundIndex}"]`);if(!row)continue;const comparison=document.createElement('div');comparison.className='summary-comparison';renderGuessPercentile(comparison,item);row.append(comparison);ready++;}
    if(!ready){const note=document.createElement('p');note.className='statistics-note';note.textContent='ההשוואה לכל מקום תופיע אחרי לפחות 30 ניחושים ראשונים של אחרים באותם תנאים.';$('run-statistics').append(note);}
  }).catch(()=>{$('run-statistics').textContent='ההשוואה לא נטענה. אפשר לפתוח שוב את התוצאות.';})];
  if(run.kind==='daily')jobs.push(api.leaderboard({dayKey:run.dayKey}).then(board=>{if(run?.runId===completed.runId)renderDailyLeaderboard($('daily-results'),board);}).catch(()=>{$('daily-results').textContent='הדירוג לא נטען. אפשר לפתוח אותו שוב.';}));
  await Promise.all(jobs);
}
async function submit(){
  if(!guessedPoint||!active())return;
  const id=run.runId,roundId=run.currentRound.id,coordinates=[...guessedPoint];submissionKey??=createGuessKey();
  await draftRequest;
  if(run?.runId!==id||run.currentRound.id!==roundId||!active())return;
  await acceptRun(await api.submitGuess(id,{roundId,coordinates,idempotencyKey:submissionKey}));
}
async function practice(){hideDialog('summary-dialog');hideDialog('settings-dialog');await acceptRun(await api.startPractice({mode,collection}));}
function updateBest(){
  const m=document.querySelector('input[name="difficulty"]:checked').value,c=document.querySelector('input[name="collection"]:checked').value;
  $('best-score').textContent=`השיא שלכם בהגדרות אלו: ${fmt(readBest(m,c))} נקודות`;
  for(const key of Object.keys(collectionNames))$(`${key}-count`).textContent=`${fmt(boot?.counts?.[m]?.[key]||0)} מקומות זמינים`;
}
function toggleLayer(button,ids,current){const next=!current;$(button).setAttribute('aria-pressed',String(next));for(const id of ids)if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',next?'visible':'none');return next;}
async function initialize(){
  try{
    const [initial,styleResponse]=await Promise.all([api.bootstrap(),fetch('map-style.json')]);boot=initial;
    if(!styleResponse.ok)throw Error('לא הצלחנו לטעון את המפה.');const style=await styleResponse.json();playArea=style.metadata.playArea;
    $('nickname').value=boot.player.nickname;$('daily-date').textContent=boot.dayKey;updateBest();
    imageryProtocol=createImageryProtocol({allowedGeoJSON:playArea,...style.metadata.imagery,onEvent:event=>{if(imageryProtocol)$('map').dataset.imageryStats=JSON.stringify(imageryProtocol.getStats());if(event.type==='coverage'&&event.fallbackPixels>0)$('eox-credit').hidden=false;}});
    maplibregl.addProtocol('surveyclip',imageryProtocol);
    map=new maplibregl.Map({container:'map',style,bounds:countryBounds,minZoom:5.7,maxZoom:18,maxBounds:[[31,27],[39,36]],dragRotate:false,pitchWithRotate:false,touchPitch:false,attributionControl:false,locale:{'Map.Title':'מפת המשחק','AttributionControl.ToggleAttribution':'מקורות מידע'}});
    map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
    map.on('moveend',updateGrid);map.on('click',e=>putGuess(e.lngLat));
    map.on('mousemove',e=>{const p=[e.lngLat.lng,e.lngLat.lat];map.getCanvas().style.cursor=active()?(pointInHintCell(p,activeCell)&&pointInPlayArea(p,playArea)?'crosshair':'not-allowed'):'';});
    map.on('sourcedata',e=>{if(e.sourceId==='play-imagery'&&e.isSourceLoaded)$('map-error').hidden=true;});
    map.on('error',e=>{if(e.sourceId==='play-imagery')setStatus('חלק מהתצלומים לא נטענו. בדקו את החיבור לאינטרנט.');});
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('טעינת המפה ארכה זמן רב מדי.')),22000);map.on('load',()=>{clearTimeout(timeout);resolve();});});
    mapReady=true;
    for(const id of ['grid','hint','connection','answer'])map.addSource(id,{type:'geojson',data:EMPTY});
    for(const layer of [
      {id:'hint-fill',type:'fill',source:'hint',paint:{'fill-color':'#d4ed8b','fill-opacity':.13}},
      {id:'grid-lines',type:'line',source:'grid',paint:{'line-color':'#e3edca','line-opacity':['interpolate',['linear'],['zoom'],6,.18,11,.38,15,.5],'line-width':.7}},
      {id:'hint-outline',type:'line',source:'hint',paint:{'line-color':'#dbf392','line-width':2.5,'line-dasharray':[4,2]}},
      {id:'connection-line',type:'line',source:'connection',paint:{'line-color':'#e6efbd','line-width':2.2,'line-dasharray':[2,2]}},
      {id:'answer-fill',type:'fill',source:'answer',paint:{'fill-color':'#ef5f63','fill-opacity':.22}},
      {id:'answer-outline',type:'line',source:'answer',paint:{'line-color':'#ff6469','line-width':2}}
    ])map.addLayer(layer,'outside-play-area');
    const resume=boot.activeRuns.find(r=>r.kind==='daily')||boot.activeRuns.find(r=>r.kind==='practice');
    await action(async()=>acceptRun(resume||await api.startPractice({mode,collection})));
  }catch(error){$('map-error').hidden=true;$('place-name').textContent='המשחק עדיין לא נטען';showError(error,()=>location.reload());}
}
$('block-button').onclick=()=>focusBlock();$('submit-button').onclick=()=>action(submit);
$('next-button').onclick=()=>action(async()=>{if(run.status==='completed')await showSummary();else await acceptRun(await api.nextRound(run.runId,{roundId:run.currentRound.id}));});
$('retry-action').onclick=()=>retryAction?.();
$('zoom-in').onclick=()=>map?.zoomIn({duration:reducedMotion?0:250});$('zoom-out').onclick=()=>map?.zoomOut({duration:reducedMotion?0:250});$('home-map').onclick=homeMap;
$('center-pin').onclick=()=>{if(map)putGuess(map.getCenter());};
$('grid-toggle').onclick=()=>{gridVisible=toggleLayer('grid-toggle',['grid-lines'],gridVisible);};
$('roads-toggle').onclick=()=>{if(map)roadsVisible=toggleLayer('roads-toggle',map.getStyle().layers.filter(l=>l.id.startsWith('osm-')).map(l=>l.id),roadsVisible);};
$('about-open').onclick=()=>showDialog('about-dialog');
$('settings-open').onclick=()=>{document.querySelector(`input[name="difficulty"][value="${mode}"]`).checked=true;document.querySelector(`input[name="collection"][value="${collection}"]`).checked=true;updateBest();showDialog('settings-dialog');};
$('nav-practice').onclick=()=>{if(run?.kind==='practice'){if(run.status==='completed')action(showSummary);else focusBlock();}else action(practice);};
$('nav-daily').onclick=()=>action(async()=>{
  boot=await api.bootstrap();$('daily-date').textContent=boot.dayKey;
  if(run?.kind==='daily'&&run.dayKey===boot.dayKey){await acceptRun(await api.resume(run.runId));return;}
  $('daily-start').textContent=boot?.daily.status==='completed'?'לתוצאות היום':boot?.daily.status==='in_progress'?'ממשיכים באתגר':'מתחילים';showDialog('daily-dialog');
});
$('daily-start').onclick=()=>action(async()=>{const daily=await api.startDaily();boot.daily={dayKey:daily.dayKey,runId:daily.runId,status:daily.status};hideDialog('daily-dialog');await acceptRun(daily);});
$('leaderboard-open').onclick=()=>action(async()=>{
  $('leaderboard-content').textContent='טוענים…';showDialog('leaderboard-dialog');
  try{const board=await api.leaderboard(run?.kind==='daily'?{dayKey:run.dayKey}:{});$('leaderboard-title').textContent=`הדירוג היומי · ${board.dayKey}`;renderDailyLeaderboard($('leaderboard-content'),board,{showHeading:false});}
  catch(error){$('leaderboard-content').textContent=error.message;}
});
$('profile-form').onsubmit=async e=>{e.preventDefault();$('profile-status').textContent='';try{const result=await api.setNickname($('nickname').value);boot.player=result.player;$('nickname').value=result.player.nickname;$('profile-status').textContent='הכינוי נשמר';const cell=$('leaderboard-content').querySelector('.is-own td');if(cell)cell.textContent=result.player.nickname+' · אתם';}catch(error){$('profile-status').textContent=error.message;}};
document.querySelectorAll('input[name="difficulty"],input[name="collection"]').forEach(el=>el.onchange=updateBest);
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
$('start-new').onclick=()=>action(async()=>{mode=document.querySelector('input[name="difficulty"]:checked').value;collection=document.querySelector('input[name="collection"]:checked').value;await practice();});
$('play-again').onclick=()=>action(practice);$('summary-close').onclick=()=>hideDialog('summary-dialog');$('reload-map').onclick=()=>location.reload();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&run?.kind==='daily'&&run.status!=='completed')action(async()=>acceptRun(await api.resume(run.runId)));});
initialize();
