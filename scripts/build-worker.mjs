import {copyFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PUBLIC_ASSET_FILES,APP_BASE_PATH} from '../server/public-assets.mjs';
import {buildWorkerCatalog} from './build-worker-catalog.mjs';

export async function buildWorker({rootDirectory=fileURLToPath(new URL('../',import.meta.url))}={}){
  const root=resolve(rootDirectory),workerDirectory=resolve(root,'.worker'),publicDirectory=resolve(workerDirectory,'public');
  if(!publicDirectory.startsWith(workerDirectory+sep)||publicDirectory===workerDirectory)throw Error('Invalid generated asset directory.');
  // Rebuild this generated directory so a removed asset cannot remain public.
  await rm(publicDirectory,{recursive:true,force:true});
  const gameDirectory=resolve(publicDirectory,'.'+APP_BASE_PATH);
  for(const file of PUBLIC_ASSET_FILES){const output=resolve(gameDirectory,file);await mkdir(dirname(output),{recursive:true});await copyFile(resolve(root,'dist',file),output);}
  await writeFile(resolve(publicDirectory,'_headers'),`${APP_BASE_PATH}/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);
  const catalog=await buildWorkerCatalog({outputPath:resolve(workerDirectory,'catalog.mjs')});
  return {assetCount:PUBLIC_ASSET_FILES.length,publicDirectory,catalog};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const result=await buildWorker();console.log(`Prepared ${result.assetCount} public assets for ${APP_BASE_PATH}/; answer catalog stays in the private Worker bundle.`);
}
