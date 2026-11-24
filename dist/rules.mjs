/** Game geometry uses [longitude, latitude] coordinates and metres. */
export const maxRoundScore = 100;
export const answerRadiusMeters = 10;

export const MODE_CONFIG = Object.freeze({
  easy: Object.freeze({ name: 'קל', longitudeStep: 0.05, latitudeStep: 0.045, cellKm: 5 }),
  normal: Object.freeze({ name: 'רגיל', longitudeStep: 0.1, latitudeStep: 0.09, cellKm: 10 }),
  hard: Object.freeze({ name: 'קשה', longitudeStep: 0.2, latitudeStep: 0.18, cellKm: 20 }),
});

const radians = degrees => degrees * Math.PI / 180;
const EARTH_RADIUS_METERS = 6371008.8;

function coordinate(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    throw new TypeError('Coordinates must be a finite [longitude, latitude] pair.');
  }
  if (Math.abs(value[1]) > 90 || Math.abs(value[0]) > 180) {
    throw new RangeError('Coordinates are outside longitude/latitude bounds.');
  }
  return value;
}

function modeConfig(mode) {
  if (!Object.hasOwn(MODE_CONFIG, mode)) throw new RangeError(`Unknown game mode: ${mode}`);
  return MODE_CONFIG[mode];
}

export function haversineMeters(from, to) {
  const [fromLng, fromLat] = coordinate(from);
  const [toLng, toLat] = coordinate(to);
  const dLat = radians(toLat - fromLat);
  const dLng = radians(toLng - fromLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

/** A GeoJSON Polygon measured on the same sphere as the distance function. */
export function geodesicCircle(center, radiusMeters = answerRadiusMeters, segments = 64) {
  const [lng, lat] = coordinate(center);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new RangeError('Circle radius must be a finite, positive number of metres.');
  }
  if (!Number.isInteger(segments) || segments < 8 || segments > 4096) {
    throw new RangeError('Circle segments must be an integer from 8 to 4096.');
  }
  const latitude = radians(lat);
  const longitude = radians(lng);
  const angularRadius = radiusMeters / EARTH_RADIUS_METERS;
  const ring = [];
  for (let index = 0; index < segments; index += 1) {
    const bearing = -2 * Math.PI * index / segments;
    const circleLatitude = Math.asin(Math.min(1, Math.max(-1,
      Math.sin(latitude) * Math.cos(angularRadius)
      + Math.cos(latitude) * Math.sin(angularRadius) * Math.cos(bearing),
    )));
    const circleLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(latitude),
      Math.cos(angularRadius) - Math.sin(latitude) * Math.sin(circleLatitude),
    );
    ring.push([((circleLongitude * 180 / Math.PI + 540) % 360) - 180, circleLatitude * 180 / Math.PI]);
  }
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}

const boundary = (index, step) => Number((index * step).toFixed(12));

function cellAxis(value, step) {
  const quotient = value / step;
  let index = Math.floor(quotient + 8 * Number.EPSILON * Math.max(1, Math.abs(quotient)));
  // Decimal boundaries should remain exact and a point infinitesimally below
  // an edge must still belong to the preceding half-open cell.
  if (value < boundary(index, step)) index -= 1;
  if (value >= boundary(index + 1, step)) index += 1;
  return { index, low: boundary(index, step), high: boundary(index + 1, step) };
}

/** A globally anchored, half-open grid cell: [west,east) × [south,north). */
export function gridCell(point, mode = 'normal') {
  const [lng, lat] = coordinate(point);
  const config = modeConfig(mode);
  const x = cellAxis(lng, config.longitudeStep);
  const y = cellAxis(lat, config.latitudeStep);
  const middleLatitude = (y.low + y.high) / 2;
  return {
    west: x.low,
    east: x.high,
    south: y.low,
    north: y.high,
    widthKm: haversineMeters([x.low, middleLatitude], [x.high, middleLatitude]) / 1000,
    heightKm: haversineMeters([x.low, y.low], [x.low, y.high]) / 1000,
    id: `${mode}:${x.index}:${y.index}`,
  };
}

/** Boolean membership in [west,east) × [south,north), matching gridCell. */
export function pointInHintCell(point, cell) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
    || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return false;
  if (!cell || ![cell.west, cell.east, cell.south, cell.north].every(Number.isFinite)
    || cell.west >= cell.east || cell.south >= cell.north
    || cell.west < -180 || cell.east > 180 || cell.south < -90 || cell.north > 90) return false;
  return point[0] >= cell.west && point[0] < cell.east
    && point[1] >= cell.south && point[1] < cell.north;
}

/** Scoring uses the shorter physical side of the approximately square grid cell. */
export function scoringMetrics(cell) {
  if (!cell || !Number.isFinite(cell.widthKm) || !Number.isFinite(cell.heightKm)
    || cell.widthKm <= 0 || cell.heightKm <= 0) {
    throw new RangeError('Scoring requires finite, positive cell widthKm and heightKm.');
  }
  const sideMeters = Math.min(cell.widthKm, cell.heightKm) * 1000;
  const zeroDistanceMeters = sideMeters / 2;
  return {
    sideMeters,
    zeroDistanceMeters,
    metersPerPoint: zeroDistanceMeters / maxRoundScore,
    answerRadiusMeters,
    perfectDistanceMeters: zeroDistanceMeters * 0.005 + answerRadiusMeters,
  };
}

/** Distance is to the target centre; its 10 m radius is free, with the old zero cutoff retained. */
export function scoreGuess(distanceMeters, cell) {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters) || distanceMeters < 0) {
    throw new RangeError('Distance must be a nonnegative number of metres.');
  }
  const { zeroDistanceMeters, perfectDistanceMeters } = scoringMetrics(cell);
  if (distanceMeters >= zeroDistanceMeters) return 0;
  // Decimal thresholds can differ by a few machine epsilons after measuring a
  // geographic cell. Keep the inclusive 99.5 threshold stable under that noise.
  const distanceEpsilon = 8 * Number.EPSILON * Math.max(1, zeroDistanceMeters);
  if (distanceMeters <= perfectDistanceMeters + distanceEpsilon) return maxRoundScore;
  const effectiveDistanceMeters = Math.max(0, distanceMeters - answerRadiusMeters);
  return Math.max(0, Math.min(maxRoundScore, Math.round(maxRoundScore * (1 - effectiveDistanceMeters / zeroDistanceMeters))));
}
