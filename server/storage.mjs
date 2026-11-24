import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRepository} from './repository-core.mjs';

export function openRepository({filename=resolve('.data/satguess.sqlite'),now=Date.now}={}){
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename,{timeout:5000});
  try{
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    return createRepository({now,driver:{
      prepare:sql=>db.prepare(sql),
      transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},
      close:()=>db.close(),
    }});
  }catch(error){db.close();throw error;}
}
