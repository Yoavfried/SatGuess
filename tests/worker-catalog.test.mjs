import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildWorkerCatalog } from '../scripts/build-worker-catalog.mjs';
import { hydrateWorkerCatalog } from '../server/worker-catalog.mjs';
import { createCatalog, loadCatalog } from '../server/catalog.mjs';
import { createGameService } from '../server/game-service.mjs';
import { openRepository } from '../server/storage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let directory, offline, built, generated, runtime;
before(async () => {
  const base = resolve(root, '.worker');
  await mkdir(base, { recursive: true });
  directory = await mkdtemp(join(base, 'catalog-test-'));
  offline = await loadCatalog({ rootDirectory: root });
  built = await buildWorkerCatalog({ catalog: offline, outputPath: join(directory, 'catalog.mjs') });
  generated = await import(pathToFileURL(built.outputPath).href);
  runtime = generated.loadWorkerCatalog();
});
after(async () => {
  if (!directory) return;
  assert.equal(await realpath(dirname(directory)), await realpath(resolve(root, '.worker')));
  assert.ok(directory.split(/[\\/]/).at(-1).startsWith('catalog-test-'));
  await rm(directory, { recursive: true, force: true });
});

test('precomputed Worker pools, frozen versions and exact playable mask match the Node catalog', () => {
  assert.deepEqual(runtime.summary, offline.summary);
  for (const version of ['snapshotId', 'mapVersion', 'rulesVersion', 'dailyPolicyVersion']) assert.equal(runtime[version], offline[version]);
  assert.deepEqual(runtime.playArea, offline.playArea);
  assert.deepEqual(runtime.places.map(p => p.id), offline.places.map(p => p.id));
  assert.deepEqual(runtime.dailyPlaces.map(p => p.id), offline.dailyPlaces.map(p => p.id));
  for (const mode of ['easy', 'normal', 'hard']) assert.deepEqual(runtime.placesForMode(mode).map(p => p.id), offline.placesForMode(mode).map(p => p.id));
  assert.equal(runtime.dailyPlaces.length, built.metadata.dailyPlaces);
  assert.ok(runtime.summary.distinctDailyHardCells >= 5);
});

test('all compact answer/identity fields retain their exact source values without heavy source audit fields', () => {
  for (let index = 0; index < offline.places.length; index++) {
    const original = offline.places[index], compact = runtime.places[index];
    for (const field of ['id', 'revisionId', 'name', 'category', 'sourceUrl', 'poolGroup', 'dailyPriority', 'dailyRegion']) assert.equal(compact[field], original[field]);
    assert.deepEqual(compact.coordinates, original.coordinates);
    assert.deepEqual(compact.eligibleModes, original.eligibleModes);
    assert.equal(compact.sourceLabel, original.sourceLabel || original.dataSource || 'מקור הנתונים');
    for (const removed of ['sources', 'sourceLicenses', 'cells', 'qualityFlags', 'audit']) assert.equal(compact[removed], undefined);
  }
});

test('generated module parses only inside the lazy loader and its runtime graph has no filesystem/build loader', async () => {
  const source = await readFile(built.outputPath, 'utf8');
  const prefix = source.slice(0, source.indexOf('export function loadWorkerCatalog'));
  assert.doesNotMatch(prefix, /\b(?:JSON\.parse|hydrateWorkerCatalog)\s*\(/);
  assert.match(source, /if \(!cached\) cached = hydrateWorkerCatalog\(JSON\.parse\(encoded\)\)/);
  assert.deepEqual(Object.keys(generated), ['loadWorkerCatalog']);
  assert.equal(generated.loadWorkerCatalog(), runtime);
  const helper = await readFile(resolve(root, 'server/worker-catalog.mjs'), 'utf8');
  assert.doesNotMatch(helper, /(?:from\s*|import\s*\()\s*['"](?:node:|.*\/catalog\.mjs)/);
  assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"]node:/);
  assert.doesNotMatch(prefix, /[A-Za-z]:\\\\Users\\\\|file:\/\/\//);
});

test('hydrated places, mode arrays, versions and geometry remain immutable', () => {
  assert.throws(() => runtime.places[0].coordinates[0] = 0, TypeError);
  assert.throws(() => runtime.placesForMode('normal').pop(), TypeError);
  assert.throws(() => runtime.places[0].eligibleModes.pop(), TypeError);
  assert.throws(() => runtime.snapshotId = 'different', TypeError);
  assert.throws(() => runtime.playArea.geometry.coordinates[0][0][0][0] = 0, TypeError);
  assert.equal(runtime.dailyCandidates, runtime.dailyPlaces);
  assert.throws(() => runtime.placesForMode('invented'), RangeError);
});

test('malformed build identities and eligibility references fail closed without a runtime national rehash', () => {
  const payload = built.artifact;
  assert.throws(() => hydrateWorkerCatalog({ ...payload, formatVersion: 999 }), /unsupported format/);
  assert.throws(() => hydrateWorkerCatalog({ ...payload, counts: { ...payload.counts, places: -1 } }), /row counts/);
  assert.throws(() => hydrateWorkerCatalog({ ...payload, modeIds: { ...payload.modeIds, easy: ['missing-place'] } }), /pool ID/);
  assert.throws(() => hydrateWorkerCatalog({ ...payload, dailyIds: [...payload.dailyIds, payload.dailyIds[0]], counts: { ...payload.counts, dailyPlaces: payload.dailyIds.length + 1 } }), /duplicate daily IDs/);
});

test('game engine emits blind preparation and exact source prompts from the compact private catalog', async () => {
  const fixture = createCatalog({
    playArea: { type: 'Polygon', coordinates: [[[34, 29], [36, 29], [36, 34], [34, 34], [34, 29]]] },
    places: [[34.8, 32.1], [35.1, 32.5], [35.4, 32.9], [34.8, 31.2], [35, 30.5]].map((coordinates, index) => ({
      id: `osm/node/${index + 1}`, name: `מוזיאון ${['האור', 'הגליל', 'הגולן', 'הנגב', 'הערבה'][index]}`,
      category: 'מוזיאון', coordinates, poolGroup: 'landmarks', coordinateKind: 'node', eligibleModes: ['easy', 'normal', 'hard'],
      sourceUrl: `https://www.openstreetmap.org/node/${index + 1}`, dataSource: 'OpenStreetMap', dataLicense: 'ODbL-1.0',
    })),
  });
  const compact = hydrateWorkerCatalog((await buildWorkerCatalog({ catalog: fixture, outputPath: join(directory, 'fixture.mjs') })).artifact);
  const repository = openRepository({ filename: ':memory:' });
  try {
    const player = repository.resolveSession().player;
    const service = createGameService({ repository, catalog: compact, dailySeed: 'explicit-private-fixture-seed' });
    const prepared = service.createPractice(player.id);
    assert.equal(prepared.currentRound.prompt, null);
    const serialized = JSON.stringify(prepared);
    for (const place of compact.places) for (const value of [place.id, place.name, place.sourceUrl]) assert.ok(!serialized.includes(value));
    assert.doesNotMatch(serialized, /coordinates|sourceUrl|placeRevisionId/);
    const active = service.startRound(player.id, prepared.runId, { roundId: prepared.currentRound.id });
    const target = compact.places.find(p => p.name === active.currentRound.prompt.name);
    assert.deepEqual(active.currentRound.prompt, { name: target.name, category: target.category });
    assert.doesNotMatch(JSON.stringify(active), /coordinates|sourceUrl|placeRevisionId/);
    const committed = service.submitGuess(player.id, prepared.runId, { roundId: prepared.currentRound.id, coordinates: [...target.coordinates], idempotencyKey: 'fixture-guess-one' });
    assert.deepEqual(committed.currentRound.result.answer.coordinates, target.coordinates);
    assert.equal(committed.currentRound.result.answer.sourceUrl, target.sourceUrl);
    assert.equal(committed.currentRound.result.answer.sourceLabel, target.sourceLabel);
  } finally { repository.close(); }
});

test('fresh lazy runtime stays below the 128 MiB Worker heap budget without the offline loader graph', () => {
  const code = `const imported=await import(process.argv[1]);const t=performance.now();const catalog=imported.loadWorkerCatalog();global.gc();console.log(JSON.stringify({heap:process.memoryUsage().heapUsed,places:catalog.places.length,daily:catalog.dailyPlaces.length,hydrateMs:Math.round(performance.now()-t)}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=96', '--expose-gc', '--input-type=module', '-e', code, pathToFileURL(built.outputPath).href], { encoding: 'utf8' }));
  assert.equal(result.places, offline.places.length);
  assert.equal(result.daily, offline.dailyPlaces.length);
  assert.ok(result.heap < 128 * 1024 * 1024, `Measured heap: ${result.heap}`);
});
