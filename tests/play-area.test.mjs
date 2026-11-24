import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const area = await readJson('data/play-area.geojson');
const outside = await readJson('data/outside-play-area.geojson');
const provenance = await readJson('data/play-area-provenance.json');

// Independent geometry probe for validating the sourced data, without map/WebGL APIs.
function ringContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function contains(point, collection = area) {
  return collection.features.some(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(([outer, ...holes]) => ringContains(point, outer) && !holes.some(r => ringContains(point, r)));
  });
}

const included = {
  'Tel Aviv': [34.792, 32.0749],
  Haifa: [34.986, 32.794],
  Jerusalem: [35.216, 31.778],
  'East Jerusalem': [35.243, 31.778],
  Ariel: [35.175, 32.106],
  Hebron: [35.1, 31.53],
  Katzrin: [35.69, 32.99],
  'Golan Heights': [35.72, 33.12],
  'Tel Aviv near the shoreline': [34.77, 32.07],
  Sderot: [34.595, 31.524],
  Ashkelon: [34.573, 31.668],
  Eilat: [34.952, 29.557],
};

const excluded = {
  'Sea immediately west of Tel Aviv': [34.75, 32.07],
  'Sea northwest of Haifa': [34.94, 32.82],
  'Gaza City': [34.4668, 31.5017],
  Rafah: [34.2485, 31.2968],
  'Khan Younis': [34.3063, 31.3462],
  'Beit Hanoun': [34.535, 31.535],
  Lebanon: [35.196, 33.27],
  'Syria east of the selected Golan region': [36, 33.1],
  Egypt: [34.3, 30.5],
  Jordan: [35.932, 31.95],
  Mediterranean: [34.6, 32.1],
  'Red Sea': [34.94, 29.48],
};

test('play area is one dissolved, detailed MultiPolygon with finite closed rings', () => {
  assert.equal(area.type, 'FeatureCollection');
  assert.equal(area.features.length, 1);
  assert.equal(area.features[0].geometry.type, 'MultiPolygon');
  const polygons = area.features[0].geometry.coordinates;
  assert.equal(polygons.length, 6);
  let vertices = 0;
  for (const polygon of polygons) {
    assert.ok(polygon.length >= 1);
    for (const [index, ring] of polygon.entries()) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      for (const point of ring) {
        assert.equal(point.length, 2);
        assert.ok(point.every(Number.isFinite));
        assert.ok(point[0] >= -180 && point[0] <= 180);
        assert.ok(point[1] >= -90 && point[1] <= 90);
      }
      const signedArea = ring.slice(0, -1).reduce((sum, p, i) => {
        const q = ring[i + 1];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0) / 2;
      assert.ok(index === 0 ? signedArea > 0 : signedArea < 0, 'RFC 7946 ring orientation');
      vertices += ring.length;
    }
  }
  assert.ok(vertices > 13000, 'Retain detailed source coastline, not a drawn bounding box');
  assert.deepEqual(area.bbox, [34.2674994, 29.4906199, 35.8950234, 33.3356317]);
  assert.deepEqual(provenance.coverageBounds, area.bbox);
});

for (const [name, point] of Object.entries(included)) {
  test(`play area includes ${name}`, () => assert.equal(contains(point), true));
}
for (const [name, point] of Object.entries(excluded)) {
  test(`play area excludes ${name}`, () => assert.equal(contains(point), false));
}

test('outside mask is the complementary geometry for every geographic fixture', () => {
  assert.equal(outside.features.length, 1);
  for (const point of [...Object.values(included), ...Object.values(excluded)]) {
    assert.equal(contains(point, outside), !contains(point), `${point}`);
  }
});

test('source provenance records pinned geometry and both open licenses', () => {
  assert.deepEqual(provenance.sources.map(s => s.license), ['ODbL-1.0', 'CC-BY-4.0']);
  for (const source of provenance.sources) {
    assert.equal(source.pinnedCommit, '9469f09');
    assert.match(source.upstreamSha256, /^[a-f0-9]{64}$/);
    assert.match(source.downloadUrl, /9469f09/);
  }
  assert.deepEqual(provenance.selection.PSE.excludedPolygonIndexes, [0, 1, 2]);
  assert.deepEqual(provenance.selection.PSE.includedPolygonIndexes, [3, 4, 5, 6, 7, 8]);
});

test('current POI pool has no unexpected offshore or out-of-region records', async () => {
  const { places } = await readJson('dist/places.json');
  const permittedExceptions = new Set(provenance.currentPoiValidation.excludedRecords.map(p => p.sourceUrl));
  const rejected = places.filter(place => !contains(place.coordinates));
  assert.ok(places.length - rejected.length >= 60);
  for (const place of rejected) assert.ok(permittedExceptions.has(place.sourceUrl), `${place.name}: ${place.coordinates}`);
});
