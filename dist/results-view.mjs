/** Small accessible result views. All source/user text is assigned with textContent. */
const resultNumber=new Intl.NumberFormat('he-IL',{maximumFractionDigits:1});
const resultInteger=new Intl.NumberFormat('he-IL',{maximumFractionDigits:0});
let resultViewSequence=0;
const resultCount=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const resultScore=value=>Number.isFinite(value)&&value>=0&&value<=500?value:null;
function resultElement(document,tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
function resultDocument(container){if(!container?.ownerDocument)throw new TypeError('A DOM container is required.');return container.ownerDocument;}
function resultText(container,text,className='small-copy'){const node=resultElement(resultDocument(container),'p',text,className);container.append(node);return node;}

export function scoreHistogramModel(bins,ownScore=null){
  const valid=(Array.isArray(bins)?bins:[]).filter(bin=>Number.isFinite(bin.min)&&Number.isFinite(bin.max)&&bin.min>=0&&bin.max<=500&&bin.max>=bin.min&&Number.isSafeInteger(bin.count)&&bin.count>=0).map(bin=>({min:bin.min,max:bin.max,count:bin.count})).sort((a,b)=>a.min-b.min||a.max-b.max);
  return {bins:valid,ownScore:resultScore(ownScore),total:valid.reduce((sum,bin)=>sum+bin.count,0),maximum:Math.max(1,...valid.map(bin=>bin.count))};
}

export function guessPercentileCopy(stats={},minSampleSize=30){
  const minimum=Math.max(30,resultCount(minSampleSize)||30),sampleSize=resultCount(stats.sampleSize);
  const percentile=Number.isFinite(stats.percentile)&&stats.percentile>=0&&stats.percentile<=100?stats.percentile:null;
  const ready=sampleSize>=minimum&&percentile!==null&&stats.status!=='warming_up'&&(!stats.percentileKind||stats.percentileKind==='strict-better');
  if(!ready)return {ready:false,sampleSize,minimum,text:`עדיין אין מספיק ניחושים להשוואה (${resultInteger.format(sampleSize)} מתוך לפחות ${resultInteger.format(minimum)}).`};
  return {ready:true,sampleSize,minimum,text:`הניחוש שלכם היה מדויק יותר מ־${resultNumber.format(percentile)}% מהניחושים הראשונים האחרים למקום הזה.`};
}

export function renderGuessPercentile(container,stats={},options={}){
  resultDocument(container);container.replaceChildren();
  const copy=guessPercentileCopy(stats,options.minSampleSize??stats.minSampleSize??30);
  const paragraph=resultText(container,copy.text,'guess-percentile');
  if(copy.ready)resultText(container,`מבוסס על ${resultInteger.format(copy.sampleSize)} ניחושים של אחרים; תוצאות באותו מרחק אינן נספרות כפחות מדויקות.`,'statistics-note');
  return paragraph;
}

export function renderScoreHistogram(container,{bins,histogram,ownScore=null,sampleSize,title='התפלגות ציונים',showNote=true}={}){
  const document=resultDocument(container);container.replaceChildren();
  const model=scoreHistogramModel(bins??histogram,ownScore);
  const figure=resultElement(document,'figure',undefined,'score-histogram');
  const caption=resultElement(document,'figcaption',title);figure.append(caption);
  if(!model.bins.length||model.total===0){figure.append(resultElement(document,'p','עדיין אין תוצאות להצגת התפלגות.','small-copy'));container.append(figure);return figure;}
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const id=`score-histogram-${++resultViewSequence}`;
  svg.setAttribute('viewBox','0 0 560 220');svg.setAttribute('role','img');svg.setAttribute('aria-labelledby',`${id}-title ${id}-description`);svg.setAttribute('class','histogram-chart');
  const shape=(tag,attributes,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=String(text);svg.append(node);return node;};
  shape('title',{id:`${id}-title`},title);
  shape('desc',{id:`${id}-description`},model.bins.map(bin=>`${bin.min===bin.max?bin.min:`${bin.min}–${bin.max}`}: ${bin.count} תוצאות`).join('; ')+(model.ownScore===null?'':`. הציון שלכם: ${model.ownScore}. הקו מסמן אותו.`));
  const x=score=>35+score,bottom=175,chartHeight=130;
  shape('line',{x1:35,y1:bottom,x2:535,y2:bottom,stroke:'currentColor','stroke-opacity':.35});
  for(const bin of model.bins){
    const perfect=bin.min===500&&bin.max===500;
    const width=perfect?10:Math.max(4,bin.max-bin.min-2),left=perfect?530:x(bin.min)+1;
    const height=bin.count/model.maximum*chartHeight;
    const rect=shape('rect',{x:left,y:bottom-height,width,height,fill:'var(--accent, #d4ed8b)','fill-opacity':.7,'class':'histogram-bar'});
    const tooltip=document.createElementNS('http://www.w3.org/2000/svg','title');tooltip.textContent=`${bin.min===bin.max?bin.min:`${bin.min}–${bin.max}`}: ${resultInteger.format(bin.count)}`;rect.append(tooltip);
  }
  for(const value of [0,100,250,400,500])shape('text',{x:x(value),y:198,'text-anchor':'middle',fill:'currentColor','font-size':12,direction:'ltr'},value);
  if(model.ownScore!==null){const marker=x(model.ownScore);shape('line',{x1:marker,y1:28,x2:marker,y2:bottom,stroke:'var(--score-marker, #f29b85)','stroke-width':2,'class':'histogram-own-marker'});shape('text',{x:Math.max(72,Math.min(505,marker)),y:18,'text-anchor':'middle',fill:'currentColor','font-size':13},`אתם: ${resultInteger.format(model.ownScore)}`);}
  figure.append(svg);
  const n=Number.isSafeInteger(sampleSize)&&sampleSize>=0?sampleSize:model.total;
  if(showNote)figure.append(resultElement(document,'p',`${n===1?'תוצאה אחת שהושלמה':`${resultInteger.format(n)} תוצאות שהושלמו`}${model.ownScore===null?'':' · הקו מסמן את הציון שלכם'}.`,'statistics-note'));
  container.append(figure);return figure;
}

export function renderDailyLeaderboard(container,board={},options={}){
  const document=resultDocument(container);container.replaceChildren();
  const entries=Array.isArray(board.entries)?board.entries:[];
  const own=board.ownEntry??board.own??null;
  if(options.showHeading!==false){const heading=resultElement(document,'h3',board.dayKey?`הדירוג היומי · ${board.dayKey}`:'הדירוג היומי');container.append(heading);}
  const participants=resultCount(board.participants??board.sampleSize);
  resultText(container,`${participants===1?'תוצאה אחת שהושלמה':`${resultInteger.format(participants)} תוצאות שהושלמו`}${board.final===false||board.provisional?' · הדירוג עדיין מתעדכן':''}.`,'statistics-note');
  if(!entries.length&&!own){resultText(container,'עדיין אין תוצאות בדירוג היומי.');return container;}
  const table=resultElement(document,'table',undefined,'leaderboard-table');
  const caption=resultElement(document,'caption','תוצאות האתגר היומי');caption.className='sr-only';table.append(caption);
  const head=resultElement(document,'thead'),header=resultElement(document,'tr');
  for(const text of ['מקום','כינוי','נקודות']){const th=resultElement(document,'th',text);th.setAttribute('scope','col');header.append(th);}head.append(header);table.append(head);
  const body=resultElement(document,'tbody');
  function row(entry,isOwn=false){
    const tr=resultElement(document,'tr',undefined,isOwn?'is-own':'');
    if(isOwn)tr.setAttribute('aria-label','התוצאה שלכם');
    const rank=resultElement(document,'th',Number.isSafeInteger(entry.rank)&&entry.rank>0?resultInteger.format(entry.rank):'—');rank.setAttribute('scope','row');
    if(entry.tiedCount>1)rank.append(resultElement(document,'span',` · בשוויון עם ${resultInteger.format(entry.tiedCount-1)} תוצאות נוספות`,'sr-only'));
    const nickname=resultElement(document,'td',typeof entry.nickname==='string'&&entry.nickname.trim()?entry.nickname:isOwn?'אתם':'שחקן');
    if(isOwn&&nickname.textContent!=='אתם')nickname.append(resultElement(document,'span',' · אתם','own-result-label'));
    tr.append(rank,nickname,resultElement(document,'td',resultScore(entry.totalScore)===null?'—':resultInteger.format(entry.totalScore)));body.append(tr);
  }
  for(const entry of entries)row(entry,Boolean(entry.isYou));
  if(own&&!entries.some(entry=>entry.isYou))row(own,true);
  table.append(body);container.append(table);
  if(own)resultText(container,`המקום שלכם: ${Number.isSafeInteger(own.rank)&&own.rank>0?resultInteger.format(own.rank):'—'}${own.tiedCount>1?' (בשוויון)':''}.`,'own-rank');
  if(options.showHistogram!==false&&(board.histogram||board.bins)){
    const histogramContainer=resultElement(document,'div');container.append(histogramContainer);
    renderScoreHistogram(histogramContainer,{histogram:board.histogram??board.bins,ownScore:own?.totalScore??entries.find(entry=>entry.isYou)?.totalScore??null,sampleSize:participants,showNote:false});
  }
  return table;
}

export function renderRunStatistics(container,stats={}){
  const document=resultDocument(container);container.replaceChildren();
  const rounds=Array.isArray(stats.rounds)?stats.rounds:[];
  container.append(resultElement(document,'h3','איך היו הניחושים שלכם?'));
  if(!rounds.length){resultText(container,'ההשוואה תופיע אחרי השלמת המשחק.');return container;}
  resultText(container,'ההשוואה כוללת ניחושים ראשונים של אחרים באותם תנאי משחק. מרחק קטן יותר נחשב טוב יותר; שוויון אינו נספר כניצחון.','statistics-note');
  const list=resultElement(document,'ol',undefined,'round-statistics');
  for(const round of rounds){
    const item=resultElement(document,'li'),heading=resultElement(document,'h4',round.name||`סיבוב ${resultInteger.format((round.roundIndex??0)+1)}`);
    item.append(heading);
    if(round.category)item.append(resultElement(document,'p',round.category,'statistics-category'));
    const score=Number.isFinite(round.score)&&round.score>=0&&round.score<=100?round.score:null;
    if(score!==null)item.append(resultElement(document,'p',`${resultInteger.format(score)} מתוך 100 נקודות`,'statistics-score'));
    const comparison=resultElement(document,'div');renderGuessPercentile(comparison,round,{minSampleSize:stats.minSampleSize??30});item.append(comparison);
    if(round.status==='ready'&&resultCount(round.sampleSize)>=Math.max(30,resultCount(stats.minSampleSize))&&Number.isFinite(round.medianEdgeDistanceMeters)&&round.medianEdgeDistanceMeters>=0)item.append(resultElement(document,'p',`חציון המרחק של הניחושים האחרים מגבול המקום: ${resultInteger.format(round.medianEdgeDistanceMeters)} מטרים.`,'statistics-note'));
    list.append(item);
  }
  container.append(list);return list;
}
export {renderRunStatistics as renderStatistics};
