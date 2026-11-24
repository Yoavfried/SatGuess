import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCatalog } from '../server/catalog.mjs';
import { WORKER_CATALOG_FORMAT, WORKER_CATALOG_FORMAT_VERSION, WORKER_PLACE_COLUMNS } from '../server/worker-catalog.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MODES = ['easy', 'normal', 'hard'];

/** Build-time only: validate the full source catalog once and emit a private lazy module. */
export async function buildWorkerCatalog({ outputPath = resolve(PROJECT_ROOT, '.worker/catalog.mjs'), catalog: suppliedCatalog, rootDirectory = PROJECT_ROOT } = {}) {
  const catalog = suppliedCatalog ?? await loadCatalog({ rootDirectory });
  const categories = [...new Set(catalog.places.map(place => place.category))].sort();
  const sourceLabels = [...new Set(catalog.places.map(place => place.sourceLabel || place.dataSource || 'מקור הנתונים'))].sort();
  const categoryIndex = new Map(categories.map((value, index) => [value, index])), labelIndex = new Map(sourceLabels.map((value, index) => [value, index]));
  const rows = catalog.places.map(place => [
    place.id, place.revisionId, place.name, categoryIndex.get(place.category), ...place.coordinates,
    place.sourceUrl, labelIndex.get(place.sourceLabel || place.dataSource || 'מקור הנתונים'), place.poolGroup === 'landmarks' ? 0 : 1,
    MODES.reduce((mask, mode, index) => mask | (place.eligibleModes.includes(mode) ? 1 << index : 0), 0), place.dailyPriority, place.dailyRegion,
  ]);
  const artifact = {
    format: WORKER_CATALOG_FORMAT, formatVersion: WORKER_CATALOG_FORMAT_VERSION,
    versions: Object.fromEntries(['snapshotId', 'mapVersion', 'rulesVersion', 'dailyPolicyVersion'].map(key => [key, catalog[key]])),
    categories, sourceLabels, rows, dailyIds: catalog.dailyPlaces.map(place => place.id),
    modeIds: Object.fromEntries(MODES.map(mode => [mode, catalog.placesForMode(mode).map(place => place.id)])),
    playArea: catalog.playArea, counts: catalog.summary,
  };
  const output = resolve(outputPath), helper = resolve(PROJECT_ROOT, 'server/worker-catalog.mjs');
  let importPath = relative(dirname(output), helper).replaceAll('\\', '/');
  if (!importPath.startsWith('.')) importPath = './' + importPath;
  const serialized = JSON.stringify(artifact);
  const source = `// Generated private server artifact. Never serve this module as a static asset.\nimport { hydrateWorkerCatalog } from ${JSON.stringify(importPath)};\nconst encoded = ${JSON.stringify(serialized)};\nlet cached;\nexport function loadWorkerCatalog() {\n  if (!cached) cached = hydrateWorkerCatalog(JSON.parse(encoded));\n  return cached;\n}\n`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, source);
  return {
    outputPath: output, artifact,
    metadata: {
      outputPath: output, formatVersion: WORKER_CATALOG_FORMAT_VERSION, columns: [...WORKER_PLACE_COLUMNS],
      ...artifact.versions, ...catalog.summary, serializedBytes: Buffer.byteLength(serialized), moduleBytes: Buffer.byteLength(source),
      moduleSha256: createHash('sha256').update(source).digest('hex'),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const extra = process.argv.slice(2);
  if (extra.length > 1) throw new Error('Usage: node scripts/build-worker-catalog.mjs [OUTPUT.mjs]');
  const result = await buildWorkerCatalog(extra.length ? { outputPath: extra[0] } : {});
  console.log(JSON.stringify(result.metadata, null, 2));
}
