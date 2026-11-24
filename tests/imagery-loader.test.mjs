import assert from 'node:assert/strict';
import {pointInPlayArea, imageryTileIntersectsPlayArea, imageryTileParentWindow} from '../dist/imagery-loader.mjs';

const rectangle = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = {type: 'Polygon', coordinates: [rectangle(10, -10, 40, 30), rectangle(20, 0, 30, 10)]};
assert.equal(pointInPlayArea([15, 15], area), true);
assert.equal(pointInPlayArea([25, 5], area), false, 'excluded holes stay excluded');
assert.equal(pointInPlayArea([20, 5], area), false, 'a hole boundary stays excluded');
assert.equal(pointInPlayArea([10, 20], area), true, 'outer boundary is included');
assert.equal(pointInPlayArea([9, 20], area), false);
const union = {type: 'FeatureCollection', features: [{type: 'Feature', properties: {}, geometry: area}, {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [rectangle(60, 0, 80, 10)]}}]};
assert.equal(pointInPlayArea([70, 5], union), true);
assert.equal(pointInPlayArea([50, 5], union), false);
assert.equal(imageryTileIntersectsPlayArea(1, 1, 0, area), true, 'partial intersection is retained');
assert.equal(imageryTileIntersectsPlayArea(1, 0, 0, area), false, 'disjoint tile is rejected');
assert.equal(imageryTileIntersectsPlayArea(0, 0, 0, area), true, 'a tile enclosing the polygon intersects');
const tinyArea = {type: 'Polygon', coordinates: [rectangle(10, 10, 10.01, 10.01)]};
assert.equal(imageryTileIntersectsPlayArea(1, 1, 0, tinyArea), true, 'tiny polygon inside a large tile is retained');
const allWorldWithHole = {type: 'Polygon', coordinates: [rectangle(-170, -80, 170, 80), rectangle(1, 1, 89, 65)]};
assert.equal(imageryTileIntersectsPlayArea(4, 9, 6, allWorldWithHole), false, 'tile wholly inside excluded hole is rejected');
assert.deepEqual(imageryTileParentWindow(14, 9762, 6651, 14), {z: 14, x: 9762, y: 6651, offsetX: 0, offsetY: 0, fraction: 1});
assert.deepEqual(imageryTileParentWindow(17, 78099, 53210, 14), {z: 14, x: 9762, y: 6651, offsetX: 3 / 8, offsetY: 2 / 8, fraction: 1 / 8});
assert.deepEqual(imageryTileParentWindow(12, 2440, 1662, 14), {z: 12, x: 2440, y: 1662, offsetX: 0, offsetY: 0, fraction: 1});
console.log('15 imagery geometry and parent-crop checks passed');

