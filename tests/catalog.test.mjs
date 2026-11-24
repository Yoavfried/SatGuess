import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, loadCatalog } from '../server/catalog.mjs';

const mask = { type: 'Polygon', coordinates: [[[34, 29], [36, 29], [36, 34], [34, 34], [34, 29]]] };
const place = (id, name = 'מוזיאון אור', coordinates = [34.8, 32.1], extra = {}) => ({ id, name, coordinates, category: 'מוזיאון', poolGroup: 'landmarks', eligibleModes: ['easy', 'normal', 'hard'], sourceUrl: `https://www.openstreetmap.org/node/${id.split('/').at(-1)}`, dataSource: 'OpenStreetMap', dataLicense: 'ODbL-1.0', coordinateKind: 'node', ...extra });
const make = (places, extra = {}) => createCatalog({ places, playArea: mask, ...extra });

test('catalog and per-mode answer records are immutable without freezing caller-owned data', () => {
  const input = place('osm/node/1');
  const catalog = make([input]);
  assert.equal(catalog.places[0], catalog.getPlace(input.id));
  assert.throws(() => catalog.places[0].coordinates[0] = 1, TypeError);
  assert.throws(() => catalog.placesForMode('normal').push(input), TypeError);
  assert.throws(() => catalog.places[0].eligibleModes.pop(), TypeError);
  input.coordinates[0] = 34.9;
  assert.equal(catalog.places[0].coordinates[0], 34.8);
  assert.equal(catalog.dailyCandidates, catalog.dailyPlaces);
});

test('revision hashes are order independent and capture coordinate, source, rule and map changes', () => {
  const a = place('osm/node/1'), b = place('osm/node/2', 'מוזיאון נגב', [34.9, 31.2]);
  const original = make([a, b]);
  assert.equal(make([b, a]).snapshotId, original.snapshotId);
  for (const other of [
    make([{ ...a, coordinates: [34.8001, 32.1] }, b]),
    make([{ ...a, sourceUrl: 'https://www.wikidata.org/wiki/Q123' }, b]),
    make([{ ...a, name: 'מוזיאון האור' }, b]),
    make([a, b], { rulesVersion: 'different-score-v2' }),
    make([a, b], { rulesContentHash: 'changed-rules-source' }),
    make([a, b], { mapStyle: { version: 8, name: 'new-map' } }),
  ]) {
    assert.notEqual(other.snapshotId, original.snapshotId);
    assert.notEqual(other.getPlace(a.id).revisionId, original.getPlace(a.id).revisionId);
  }
});

test('prepare and active-prompt DTOs never expose answer coordinates, source URLs or source identifiers', () => {
  const catalog = make([place('osm/node/1')]);
  const prepare = catalog.prepareFor('osm/node/1', 'normal');
  assert.deepEqual(Object.keys(prepare), ['cell']);
  const prompt = catalog.promptFor('osm/node/1', 'normal');
  assert.deepEqual(Object.keys(prompt).sort(), ['category', 'cell', 'name']);
  assert.equal(prompt.name, 'מוזיאון אור');
  assert.doesNotMatch(JSON.stringify({ prepare, prompt }), /coordinates|sourceUrl|osm\/node|34\.8,32\.1/);
  assert.throws(() => prompt.cell.west = 0, TypeError);
});

test('exact mask and half-open hint cell reject water holes, outside countries and high-edge guesses', () => {
  const withHole = { type: 'Polygon', coordinates: [...mask.coordinates, [[34.85, 32.05], [34.89, 32.05], [34.89, 32.15], [34.85, 32.15], [34.85, 32.05]]] };
  const catalog = make([place('osm/node/1', undefined, [34.82, 32.1]), place('osm/node/2', 'מוזיאון חוץ', [37, 32]), place('osm/node/3', 'מוזיאון מים', [34.87, 32.1])], { playArea: withHole });
  assert.equal(catalog.places.length, 1);
  assert.equal(catalog.isInPlayArea([34.87, 32.1]), false);
  assert.equal(catalog.isGuessInCell([34.82, 32.1], 'osm/node/1', 'normal'), true);
  assert.equal(catalog.isGuessInCell([34.87, 32.1], 'osm/node/1', 'normal'), false);
  const cell = catalog.prepareFor('osm/node/1', 'normal').cell;
  assert.equal(catalog.isGuessInCell([cell.east, 32.1], 'osm/node/1', 'normal'), false);
  assert.equal(catalog.isGuessInCell([Infinity, 32.1], 'osm/node/1', 'normal'), false);
  assert.throws(() => catalog.prepareFor('osm/node/1', 'invented'), RangeError);
});

test('daily gate prefers known seed buildings and holds generic names, campuses and unreviewed area centres', () => {
  const seed = place('osm/way/10', 'מוזיאון המורשת', [34.8, 32.1], { coordinateKind: 'bounds-center', qualityFlags: ['geometry_bounds_center'] });
  const inputs = [seed,
    place('osm/node/11', 'מוזיאון האור', [34.9, 31.2]),
    place('osm/node/12', 'ספרייה מרכזית', [35.1, 31.4], { category: 'ספרייה' }),
    place('osm/node/13', 'פארק הנגב', [35.1, 31.5], { category: 'פארק' }),
    place('osm/node/14', 'אוניברסיטת הגליל', [35.2, 32.5], { category: 'אוניברסיטה' }),
    place('osm/way/15', 'מוזיאון אחר', [35.4, 32.7], { coordinateKind: 'bounds-center', qualityFlags: ['geometry_bounds_center'] }),
  ];
  const catalog = make(inputs, { seedPlaces: [seed] });
  assert.equal(catalog.places.length, inputs.length);
  assert.deepEqual(catalog.dailyPlaces.map(p => p.id), [seed.id, 'osm/node/11']);
  assert.equal(catalog.dailyPlaces[0].dailyPriority, 2);
});

test('snapshot-wide name/category and brand collisions constrain per-mode eligibility', () => {
  const a = place('osm/node/1', 'מוזיאון אור', [34.802, 32.06]);
  const b = place('osm/node/2', 'מוזיאון אור', [34.802, 32.10]);
  const c = place('osm/node/3', 'מרכז אמנות אור', [34.812, 32.10], { category: 'מרכז אמנות', brand: 'רשת אור' });
  const d = place('osm/node/4', 'תיאטרון אור', [34.822, 32.11], { category: 'תיאטרון', brand: 'רשת אור' });
  const catalog = make([a, b, c, d]);
  assert.deepEqual(catalog.getPlace(a.id).eligibleModes, ['easy']);
  assert.equal(catalog.dailyPlaces.length, 0);
  assert.equal(catalog.placesForMode('normal').length, 0);
});

test('a corrupt duplicate identity or missing mask fails closed', () => {
  assert.throws(() => make([place('osm/node/1'), place('osm/node/1')]), /Duplicate catalog place ID/);
  assert.throws(() => createCatalog({ places: [place('osm/node/1')] }), /playable polygon/);
});

test('shipped daily pool has multiple regions and excludes broad campus/park and archaeology categories', async () => {
  const catalog = await loadCatalog();
  assert.ok(catalog.places.length > 10000);
  assert.ok(catalog.dailyPlaces.length >= 5);
  assert.ok(catalog.summary.distinctDailyHardCells >= 5);
  assert.ok(catalog.dailyPlaces.some(p => p.coordinates[1] > 32.7));
  assert.ok(catalog.dailyPlaces.some(p => p.coordinates[1] < 31.4));
  assert.ok(catalog.dailyPlaces.every(p => p.eligibleModes.length === 3 && p.poolGroup === 'landmarks'));
  assert.ok(catalog.dailyPlaces.every(p => !['פארק', 'שמורת טבע', 'אוניברסיטה', 'מכון מחקר', 'אתר ארכאולוגי', 'אתר עתיקות'].includes(p.category)));
  assert.equal(catalog.summary.byMode.normal, catalog.placesForMode('normal').length);
});
