import {createRepository} from './repository-core.mjs';

export const CLOUDFLARE_SCHEMA_VERSION_KEY='repository-schema-version';

const allRows=cursor=>typeof cursor.toArray==='function'?cursor.toArray():Array.from(cursor);
const storageFailure=(code,message)=>Object.assign(Error(message),{code});

/**
 * The same repository API as openRepository, using SQLite-backed Durable Object
 * storage. Supply schema.sql as a bundled text string; no filesystem is used.
 */
export function createCloudflareRepository({storage,schema,now=Date.now}={}){
  if(typeof storage?.sql?.exec!=='function'||typeof storage?.transactionSync!=='function')throw new TypeError('SQLite-backed Durable Object storage is required.');
  if(typeof schema!=='string'||!schema.trim())throw new TypeError('The SQL schema must be supplied as text.');
  const expectedVersion=/^\s*PRAGMA\s+user_version\s*=\s*(\d+)\s*;/mi.exec(schema)?.[1]||'1';
  // DO storage owns journaling and transactions. Its SQL API must never receive
  // Node-specific PRAGMAs or explicit BEGIN/COMMIT statements.
  const portableSchema=schema.replace(/^\s*PRAGMA\s+[^;]*;\s*/gmi,'');
  const exec=(sql,...bindings)=>storage.sql.exec(sql,...bindings);
  storage.transactionSync(()=>{
    allRows(exec('CREATE TABLE IF NOT EXISTS private_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;'));
    const installed=allRows(exec('SELECT value FROM private_metadata WHERE key=?',CLOUDFLARE_SCHEMA_VERSION_KEY))[0]?.value;
    if(installed!==undefined&&installed!==expectedVersion)throw storageFailure('SCHEMA_VERSION_UNAVAILABLE','The durable database schema needs an explicit migration.');
    if(installed===undefined){
      allRows(exec(portableSchema));
      allRows(exec('INSERT INTO private_metadata(key,value) VALUES(?,?)',CLOUDFLARE_SCHEMA_VERSION_KEY,expectedVersion));
    }
  });
  const driver={
    prepare(sql){
      return {
        get(...bindings){return allRows(exec(sql,...bindings))[0];},
        all(...bindings){return allRows(exec(sql,...bindings));},
        run(...bindings){
          allRows(exec(sql,...bindings));
          // rowsWritten is a billing metric and can include index work. SQL
          // changes() preserves Node SQLite's affected-row semantics, including
          // ON CONFLICT DO NOTHING returning zero for an existing exposure.
          const changes=Number(allRows(exec('SELECT changes() AS changes'))[0].changes);
          return {changes};
        },
      };
    },
    transaction:fn=>storage.transactionSync(fn),
  };
  return createRepository({driver,now});
}
