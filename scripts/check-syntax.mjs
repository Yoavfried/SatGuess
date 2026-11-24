import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=['server.mjs',...['dist','server','scripts','worker'].flatMap(directory=>readdirSync(resolve(root,directory)).filter(name=>name.endsWith('.mjs')).map(name=>`${directory}/${name}`))];
for(const file of files){
  const result=spawnSync(process.execPath,['--check',resolve(root,file)],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
