import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE_CONFIG, gridCell, pointInHintCell, haversineMeters, geodesicCircle, answerRadiusMeters, maxRoundScore, scoringMetrics, scoreGuess } from '../dist/rules.mjs';

test('haversine agrees with a one-degree equatorial arc and is symmetric', () => {
  assert.ok(Math.abs(haversineMeters([0, 0], [1, 0]) - 111195.08) < 0.1);
  const a = [34.7913, 32.0749];
  const b = [35.2167, 31.7719];
  assert.equal(haversineMeters(a, a), 0);
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
  assert.ok(Number.isFinite(haversineMeters([0, 0], [180, 0])));
});

test('grid is anchored to fixed coordinates and does not reveal a target-centred cell', () => {
  const a = gridCell([34.7913, 32.0749]);
  const b = gridCell([34.799, 32.049]);
  assert.equal(a.id, b.id);
  assert.equal(a.west, 34.7);
  assert.equal(a.east, 34.8);
  assert.equal(a.south, 32.04);
  assert.equal(a.north, 32.13);
  assert.ok(a.widthKm > 9 && a.widthKm < 10);
  assert.ok(a.heightKm > 10 && a.heightKm < 10.1);
});

test('every point lies in its cell, including decimal edges and negative coordinates', () => {
  for (const mode of Object.keys(MODE_CONFIG)) {
    for (const point of [[34.8, 32.04], [34.79999999999999, 32.03999999999999], [0, 0], [-0.3, -0.18], [-34.8, -32.04], [35.1, 31.5]]) {
      const cell = gridCell(point, mode);
      assert.ok(point[0] >= cell.west && point[0] < cell.east, `${mode} longitude ${point[0]}`);
      assert.ok(point[1] >= cell.south && point[1] < cell.north, `${mode} latitude ${point[1]}`);
    }
  }
});

test('east and north edges select the adjacent cell and shared corners are consistent', () => {
  for (const mode of Object.keys(MODE_CONFIG)) {
    const cell = gridCell([34.7913, 32.0749], mode);
    assert.equal(gridCell([cell.east, cell.south], mode).west, cell.east);
    assert.equal(gridCell([cell.west, cell.north], mode).south, cell.north);
    assert.equal(gridCell([cell.west, cell.south], mode).id, cell.id);
  }
});

test('hint-cell membership accepts only the current cell with west/south inclusive and east/north exclusive', () => {
  for (const mode of Object.keys(MODE_CONFIG)) {
    const cell = gridCell([34.7913, 32.0749], mode);
    assert.equal(pointInHintCell([34.7913, 32.0749], cell), true);
    assert.equal(pointInHintCell([cell.west, cell.south], cell), true);
    assert.equal(pointInHintCell([cell.east - 1e-8, cell.north - 1e-8], cell), true);
    assert.equal(pointInHintCell([cell.east, cell.south], cell), false);
    assert.equal(pointInHintCell([cell.west, cell.north], cell), false);
    assert.equal(pointInHintCell([cell.west - 1e-8, cell.south], cell), false);
    assert.equal(pointInHintCell([cell.west, cell.south - 1e-8], cell), false);
    assert.equal(pointInHintCell([35.7, 32.7], cell), false);
  }
});

test('membership agrees with fixed-grid ownership at decimal boundaries and negative coordinates', () => {
  for (const mode of Object.keys(MODE_CONFIG)) {
    for (const point of [[34.8, 32.04], [34.79999999999999, 32.03999999999999], [0, 0], [-0.3, -0.18], [-34.8, -32.04]]) {
      const cell = gridCell(point, mode);
      assert.equal(pointInHintCell(point, cell), true);
      const eastern = gridCell([cell.east, cell.south], mode);
      const northern = gridCell([cell.west, cell.north], mode);
      assert.equal(pointInHintCell(point, eastern), false);
      assert.equal(pointInHintCell(point, northern), false);
    }
  }
});

test('invalid points or cells fail closed without throwing or coercing values', () => {
  const cell = gridCell([34.7913, 32.0749]);
  for (const point of [null, undefined, [], [34.7], [34.7, 32.1, 0], ['34.7', 32.1], [NaN, 32.1], [Infinity, 32.1], [181, 32.1], [34.7, 91]]) {
    assert.equal(pointInHintCell(point, cell), false);
  }
  for (const invalid of [null, undefined, {}, { ...cell, west: NaN }, { ...cell, north: Infinity }, { ...cell, east: cell.west }, { ...cell, south: cell.north }, { ...cell, west: -181 }]) {
    assert.equal(pointInHintCell([34.7913, 32.0749], invalid), false);
  }
});

test('easy gives a smaller hint area while hard gives a larger area', () => {
  const point = [34.7913, 32.0749];
  const easy = gridCell(point, 'easy');
  const normal = gridCell(point, 'normal');
  const hard = gridCell(point, 'hard');
  assert.equal(MODE_CONFIG.easy.cellKm, 5);
  assert.equal(MODE_CONFIG.normal.cellKm, 10);
  assert.equal(MODE_CONFIG.hard.cellKm, 20);
  assert.ok(easy.widthKm < normal.widthKm && normal.widthKm < hard.widthKm);
  assert.ok(easy.heightKm < normal.heightKm && normal.heightKm < hard.heightKm);
});

test('a 15 km block grants a 10 m target radius and retains the 7.5 km zero cutoff', () => {
  const cell = { widthKm: 15, heightKm: 15 };
  assert.deepEqual(scoringMetrics(cell), {
    sideMeters: 15000, zeroDistanceMeters: 7500, metersPerPoint: 75, answerRadiusMeters: 10, perfectDistanceMeters: 47.5,
  });
  assert.equal(maxRoundScore, 100);
  assert.equal(scoreGuess(0, cell), 100);
  assert.equal(scoreGuess(10, cell), 100);
  assert.equal(scoreGuess(47.5, cell), 100);
  assert.equal(scoreGuess(47.500001, cell), 99);
  assert.equal(scoreGuess(75, cell), 99);
  assert.equal(scoreGuess(3750, cell), 50);
  assert.equal(scoreGuess(7500, cell), 0);
  assert.equal(scoreGuess(7501, cell), 0);
  assert.equal(scoreGuess(Infinity, cell), 0);
});

test('inclusive 99.5-point rounding stays stable for nonintegral physical block sides', () => {
  const cell = { widthKm: 14.13278904731, heightKm: 15.01133583152 };
  const metrics = scoringMetrics(cell);
  const distanceFromCloseness = metrics.zeroDistanceMeters * (1 - 0.995) + answerRadiusMeters;
  assert.equal(scoreGuess(distanceFromCloseness, cell), 100);
  assert.equal(scoreGuess(metrics.perfectDistanceMeters, cell), 100);
  assert.equal(scoreGuess(metrics.perfectDistanceMeters + 0.000001, cell), 99);
});

test('scoring uses the shorter physical block side, independent of orientation', () => {
  const cell = { widthKm: 12, heightKm: 15 };
  assert.equal(scoringMetrics(cell).sideMeters, 12000);
  assert.equal(scoringMetrics(cell).zeroDistanceMeters, 6000);
  assert.equal(scoreGuess(3000, cell), 50);
  assert.equal(scoreGuess(6000, cell), 0);
  assert.equal(scoreGuess(3000, { widthKm: 15, heightKm: 12 }), 50);
});

test('equal fractional error measured from the target circle has equal scores across modes', () => {
  for (const fraction of [0, 0.005, 0.01, 0.25, 0.5, 0.75, 1, 2]) {
    const scores = Object.keys(MODE_CONFIG).map(mode => {
      const cell = gridCell([34.7913, 32.0749], mode);
      return scoreGuess(scoringMetrics(cell).zeroDistanceMeters * fraction + answerRadiusMeters, cell);
    });
    assert.ok(scores.every(score => score === scores[0]), `fraction ${fraction}`);
  }
});

test('the default 10 km block allows roughly 34 m centre error for a perfect score', () => {
  const cell = gridCell([34.7913, 32.0749]);
  const metrics = scoringMetrics(cell);
  assert.ok(metrics.perfectDistanceMeters > 33 && metrics.perfectDistanceMeters < 35);
  assert.equal(scoreGuess(metrics.perfectDistanceMeters, cell), 100);
  assert.equal(scoreGuess(metrics.perfectDistanceMeters + 0.001, cell), 99);
  assert.equal(scoreGuess(metrics.zeroDistanceMeters, cell), 0);
});

test('geodesic answer circle has a closed ring whose vertices are 10 metres from Jerusalem', () => {
  const center = [35.2137, 31.7683];
  const circle = geodesicCircle(center);
  assert.equal(answerRadiusMeters, 10);
  assert.equal(circle.type, 'Polygon');
  assert.equal(circle.coordinates.length, 1);
  const ring = circle.coordinates[0];
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.notEqual(ring[0], ring.at(-1));
  const signedArea = ring.slice(0, -1).reduce((area, point, index) => {
    const next = ring[index + 1];
    return area + (point[0] - center[0]) * (next[1] - center[1]) - (next[0] - center[0]) * (point[1] - center[1]);
  }, 0);
  assert.ok(signedArea > 0, 'GeoJSON exterior uses counterclockwise winding');
  for (const vertex of ring) assert.ok(Math.abs(haversineMeters(center, vertex) - 10) < 0.000001);
  assert.equal(JSON.parse(JSON.stringify(circle)).type, 'Polygon');
});

test('geodesic circles accept a custom physical radius and validate geometry inputs', () => {
  const center = [35.2137, 31.7683];
  const circle = geodesicCircle(center, 25, 32);
  assert.equal(circle.coordinates[0].length, 33);
  for (const vertex of circle.coordinates[0]) assert.ok(Math.abs(haversineMeters(center, vertex) - 25) < 0.000001);
  assert.throws(() => geodesicCircle(center, 0), RangeError);
  assert.throws(() => geodesicCircle(center, Infinity), RangeError);
  assert.throws(() => geodesicCircle(center, 10, 3), RangeError);
  assert.throws(() => geodesicCircle([35, NaN]), TypeError);
});

test('scores decrease monotonically and stay within the 0–100 range', () => {
  for (const mode of Object.keys(MODE_CONFIG)) {
    const cell = gridCell([34.7913, 32.0749], mode);
    let previous = maxRoundScore;
    for (const distance of [0, 15, 50, 100, 500, 1000, 5000, 10000, Infinity]) {
      const score = scoreGuess(distance, cell);
      assert.ok(Number.isInteger(score) && score >= 0 && score <= maxRoundScore);
      assert.ok(score <= previous);
      previous = score;
    }
    assert.equal(scoreGuess(Infinity, cell), 0);
  }
});

test('invalid inputs fail explicitly rather than producing invalid geometry or scores', () => {
  assert.throws(() => gridCell([NaN, 32]), TypeError);
  assert.throws(() => haversineMeters([34, 91], [34, 32]), RangeError);
  assert.throws(() => gridCell([34, 32], 'missing'), RangeError);
  assert.throws(() => scoreGuess(-1), RangeError);
  assert.throws(() => scoreGuess(NaN), RangeError);
  assert.throws(() => scoreGuess(10), RangeError);
  assert.throws(() => scoringMetrics({ widthKm: 0, heightKm: 15 }), RangeError);
  assert.throws(() => scoringMetrics({ widthKm: 15, heightKm: Infinity }), RangeError);
});
