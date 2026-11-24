import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,writeSync,mkdirSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';

// An explicit projection: never select session hashes, player/run/attempt IDs,
// nicknames, raw run state or record_json into an analysis export.
export const ATTEMPT_EXPORT_COLUMNS=Object.freeze([
  'round_index','source_place_id','place_revision_id','cohort_key','kind','mode','collection',
  'first_exposure','started_at','deadline_at','finalized_at','guess_lng','guess_lat',
  'center_distance_m','edge_distance_m','score','outcome',
]);
const csvCell=value=>'"'+(value===null||value===undefined?'':String(value)).replaceAll('"','""')+'"';
function writeComplete(fd,text){const bytes=Buffer.from(text,'utf8');let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);}

export function exportAttempts({outputPath,databaseFile='.data/satguess.sqlite',finalizedOnly=false,firstExposureOnly=false}={}){
  if(typeof outputPath!=='string'||!outputPath.trim())throw new TypeError('Provide an explicit CSV output path with --output.');
  const output=resolve(outputPath),database=resolve(databaseFile);
  if(extname(output).toLowerCase()!=='.csv')throw new TypeError('Output must have a .csv extension.');
  if(output.toLowerCase()===database.toLowerCase())throw new TypeError('Output cannot replace the SQLite database.');
  const db=new DatabaseSync(database,{readOnly:true,timeout:5000});
  let fd;
  try{
    const clauses=[...(finalizedOnly?['finalized_at IS NOT NULL']:[]),...(firstExposureOnly?['first_exposure = 1']:[])];
    const query=`SELECT ${ATTEMPT_EXPORT_COLUMNS.join(',')} FROM round_attempts${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY started_at,round_index,id`;
    const statement=db.prepare(query); // Validate the schema before creating a file.
    db.exec('BEGIN');
    mkdirSync(dirname(output),{recursive:true});
    fd=openSync(output,'wx'); // Existing files are never overwritten.
    writeComplete(fd,'\ufeff'+ATTEMPT_EXPORT_COLUMNS.map(csvCell).join(',')+'\r\n');
    let rows=0;
    for(const record of statement.iterate()){
      writeComplete(fd,ATTEMPT_EXPORT_COLUMNS.map(column=>csvCell(record[column])).join(',')+'\r\n');rows++;
    }
    db.exec('COMMIT');
    return {rows,outputPath:output,columns:[...ATTEMPT_EXPORT_COLUMNS]};
  }finally{if(fd!==undefined)closeSync(fd);db.close();}
}

function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--finalized-only'){options.finalizedOnly=true;continue;}
    if(args[i]==='--first-exposure-only'){options.firstExposureOnly=true;continue;}
    const key={'--output':'outputPath','--db':'databaseFile'}[args[i]];
    if(!key||!args[i+1])throw Error('Usage: node scripts/export-attempts.mjs --output FILE.csv [--db FILE.sqlite] [--finalized-only] [--first-exposure-only]');
    options[key]=args[++i];
  }
  console.log(JSON.stringify(exportAttempts(options),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
