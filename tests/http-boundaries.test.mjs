import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createApplication } from '../server/http.mjs';
import { createCatalog } from '../server/catalog.mjs';
import { openRepository } from '../server/storage.mjs';

const fixtureCatalog = () => createCatalog({
  playArea: { type: 'Polygon', coordinates: [[[34, 29], [36, 29], [36, 34], [34, 34], [34, 29]]] },
  places: [[34.8, 32.1], [35.1, 32.5], [35.4, 32.9], [34.8, 31.2], [35.0, 30.5]].map((coordinates, index) => ({
    id: `osm/node/${index + 1}`, name: `מוזיאון ${['האור', 'הגליל', 'הגולן', 'הנגב', 'הערבה'][index]}`,
    coordinates, category: 'מוזיאון', poolGroup: 'landmarks', eligibleModes: ['easy', 'normal', 'hard'], coordinateKind: 'node',
    sourceUrl: `https://www.openstreetmap.org/node/${index + 1}`, dataSource: 'OpenStreetMap', dataLicense: 'ODbL-1.0',
  })),
});

async function fixture(t) {
  const workspace = resolve('.'), directory = mkdtempSync(join(workspace, '.test-http-assets-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>SatGuess</title>');
  writeFileSync(join(directory, 'places.json'), '{"privateAnswer":"never public"}');
  writeFileSync(join(directory, 'unlisted.json'), '{"privateAnswer":"also private"}');
  mkdirSync(join(directory, 'fonts'));
  const repository = openRepository({ filename: ':memory:', now: () => Date.parse('2026-11-24T10:00:00Z') });
  const application = await createApplication({ repository, catalog: fixtureCatalog(), staticRoot: directory, now: () => Date.parse('2026-11-24T10:00:00Z') });
  await new Promise(resolveListening => application.server.listen(0, '127.0.0.1', resolveListening));
  const base = `http://127.0.0.1:${application.server.address().port}`;
  t.after(async () => {
    await application.close(); repository.close();
    if (!directory.startsWith(workspace + sep)) throw Error('Test cleanup target escaped workspace.');
    rmSync(directory, { recursive: true, force: true });
  });
  return { ...application, base };
}

test('public asset URL allowlist blocks answer files, case variants and encoded Windows separators', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(base + '/')).status, 200);
  for (const path of ['/places.json', '/PLACES.JSON', '/Places.json', '/fonts%5c..%5cplaces.json', '/fonts/%2e%2e%5cplaces.json', '/unlisted.json', '/.data/satguess.sqlite', '/server/catalog.mjs']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /never public|also private/);
  }
  assert.equal((await fetch(base + '/PLACES.JSON', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
});

test('unknown routes, malformed JSON and rejected origins do not create an anonymous session', async t => {
  const { base } = await fixture(t);
  const cases = [
    ['/api/not-a-route', {} , 404],
    ['/api/daily/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, 400],
    ['/api/daily/start', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://another.example' }, body: '{}' }, 403],
  ];
  for (const [path, options, expected] of cases) {
    const response = await fetch(base + path, options);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('one cookie resolves to one durable daily run under concurrent starts without leaking private catalog data', async t => {
  const { base, repository } = await fixture(t);
  const bootstrap = await fetch(base + '/api/bootstrap');
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  assert.match(bootstrap.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const boot = await bootstrap.json();
  assert.doesNotMatch(JSON.stringify(boot), /session_hash|daily-selection-seed|place-sha256|sourceUrl|coordinates/);
  const starts = await Promise.all(Array.from({ length: 4 }, () => fetch(base + '/api/daily/start', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }).then(async r => ({ status: r.status, body: await r.json() }))));
  assert.ok(starts.every(r => r.status === 200));
  assert.equal(new Set(starts.map(r => r.body.runId)).size, 1);
  assert.ok(starts.every(r => r.body.currentRound.prompt === null));
  assert.doesNotMatch(JSON.stringify(starts), /sourceUrl|coordinates|privateAnswer/);
  assert.equal(repository.listRuns({ kind: 'daily', playerId: boot.player.id }).length, 1);
  const runId = starts[0].body.runId;
  const other = await fetch(base + `/api/runs/${runId}`);
  assert.equal(other.status, 404);
  assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
});
