import {readFile,writeFile} from 'node:fs/promises';
const data=JSON.parse(await readFile('dist/places.json','utf8'));
const collection=process.argv[3]||'all',mode=process.argv[4];
if(!['all','landmarks'].includes(collection)||mode&&!['easy','normal','hard'].includes(mode))throw Error('Optional collection: all|landmarks; mode: easy|normal|hard');
const places=data.places.filter(p=>(collection==='all'||p.poolGroup!=='businesses')&&(!mode||!p.eligibleModes||p.eligibleModes.includes(mode)));
const rows=[['מקור','רישיונות המקור','קטגוריה','שם המקום','סוג מאגר','רמות זמינות','קו אורך','קו רוחב','סוג קואורדינטה','קישור למקור','רישיון המאגר','קישור לרישיון המאגר'],...places.map(p=>[p.dataSource||data.source,(p.sourceLicenses||[p.dataLicense||data.license]).join('; '),p.category,p.name,p.poolGroup==='businesses'?'עסקים':'אתרים ומוסדות',(p.eligibleModes||['easy','normal','hard']).join('; '),...p.coordinates,p.coordinateKind||'',p.sourceUrl,data.license,data.licenseUrl||''])];
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
await writeFile(process.argv[2]||'data/places.csv','\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n');
console.log(`Exported ${places.length} source-backed places (${collection}${mode?' / '+mode:''}).`);
