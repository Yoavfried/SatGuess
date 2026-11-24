import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { gridCell, pointInHintCell } from '../dist/rules.mjs';
import { pointInPlayArea } from '../dist/imagery-loader.mjs';

export const CATALOG_RULES_VERSION = 'grid-half-open-score-radius10-v1';
export const DAILY_POLICY_VERSION = 'specific-bounded-cultural-venues-v1';
const MODES = Object.freeze(['easy', 'normal', 'hard']);
const INFORMATIONAL_FLAGS = new Set(['source_screened_not_manually_verified', 'imagery_date_not_checked', 'status_unknown', 'unknown_operating_status', 'geometry_bounds_center']);
const DAILY_CATEGORIES = new Set(['מוזיאון', 'תיאטרון', 'קולנוע', 'קניון', 'ספרייה', 'מרכז קהילתי', 'מרכז אמנות']);
const GENERIC_NAMES = new Set(['מוזיאון', 'המוזיאון', 'ספריה', 'ספרייה', 'הספריה', 'הספרייה', 'ספריהעירונית', 'ספרייהעירונית', 'ספריהציבורית', 'ספרייהציבורית', 'ספריהמרכזית', 'ספרייהמרכזית', 'הספריההמרכזית', 'הספרייההמרכזית', 'מרכזקהילתי', 'מרכזאמנות', 'מרכזתרבות', 'מרכזתרבותעירוני', 'תיאטרון', 'התיאטרון', 'ביתקולנוע', 'קולנוע', 'קניון', 'הקניון', 'מתנס', 'מתנסעירוני', 'ביתהעם', 'ביתהתרבות', 'ביתנוער', 'מרכזמבקרים', 'מרכזהמבקרים']);
// Small named buildings within a campus can still qualify. Whole-campus categories
// are excluded above; these source-labelled open-air museum complexes need review.
const DAILY_SITE_HOLDS = new Set(['wikidata/Q456800', 'osm/way/559058331', 'osm/way/54448786', 'wikidata/Q12407325', 'wikidata/Q4248139', 'wikidata/Q16129570']);

const normalizeName = value => String(value ?? '').normalize('NFKC').replace(/[\u0591-\u05c7]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const canonicalId = value => String(value).replace(/^osm:(node|way|relation)\//, 'osm/$1/');
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const uniqueStrings = values => [...new Set((values ?? []).filter(value => typeof value === 'string' && value))].sort();
const assertMode = mode => { if (!MODES.includes(mode)) throw new RangeError(`Unknown mode: ${mode}`); return mode; };
const sourceUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};

function polygonsOf(value) {
  if (!value) return [];
  if (value.type === 'FeatureCollection') return value.features.flatMap(polygonsOf);
  if (value.type === 'Feature') return polygonsOf(value.geometry);
  if (value.type === 'GeometryCollection') return value.geometries.flatMap(polygonsOf);
  if (value.type === 'Polygon') return [value.coordinates];
  if (value.type === 'MultiPolygon') return value.coordinates;
  return [];
}

/** Precompute component bounds once; use the same hole/edge semantics as the map. */
function membershipChecker(playArea) {
  const components = polygonsOf(playArea).map(coordinates => {
    if (!Array.isArray(coordinates) || !coordinates.length || coordinates.some(ring => !Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite)))) throw new TypeError('Invalid playable polygon.');
    const bounds = coordinates[0].reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    return { bounds, geometry: { type: 'Polygon', coordinates } };
  });
  if (!components.length) throw new TypeError('A nonempty playable polygon is required.');
  return point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90 && components.some(({ bounds: [w, s, e, n], geometry }) => point[0] >= w && point[0] <= e && point[1] >= s && point[1] <= n && pointInPlayArea(point, geometry));
}

function cloneSource(source) {
  return Object.fromEntries(['id', 'url', 'dataSource', 'dataLicense', 'license'].filter(key => typeof source?.[key] === 'string').map(key => [key, source[key]]));
}

function privateRecord(row) {
  return {
    id: row.id, name: row.name, category: row.category, coordinates: [...row.coordinates],
    poolGroup: row.poolGroup, eligibleModes: MODES.filter(mode => row.eligibleModes.includes(mode)),
    sourceUrl: row.sourceUrl, dataSource: row.dataSource, dataLicense: row.dataLicense,
    sourceLicenses: uniqueStrings([row.dataLicense, ...(row.sourceLicenses ?? [])]),
    sources: (row.sources ?? []).map(cloneSource).sort((a, b) => canonical(a).localeCompare(canonical(b))),
    qualityFlags: uniqueStrings(row.qualityFlags),
    ...(typeof row.coordinateKind === 'string' ? { coordinateKind: row.coordinateKind } : {}),
    ...(typeof row.ambiguityName === 'string' ? { ambiguityName: row.ambiguityName } : {}),
    ...(typeof row.brand === 'string' ? { brand: row.brand } : {}),
    ...(typeof row.brandWikidata === 'string' ? { brandWikidata: row.brandWikidata } : {}),
  };
}

function dailyReason(place, seedIds) {
  if (place.poolGroup !== 'landmarks') return 'daily_business_pool';
  if (!DAILY_CATEGORIES.has(place.category)) return 'daily_category_needs_editorial_review';
  if (place.eligibleModes.length !== MODES.length) return 'daily_not_unambiguous_in_every_mode';
  if (place.qualityFlags.some(flag => !INFORMATIONAL_FLAGS.has(flag))) return 'daily_actionable_quality_flag';
  const identities = [place.id, ...place.sources.map(source => source.id).filter(Boolean)].map(canonicalId);
  if (identities.some(id => DAILY_SITE_HOLDS.has(id))) return 'daily_large_open_air_site';
  const knownSeed = identities.some(id => seedIds.has(id));
  const isNode = place.coordinateKind === 'node' || /^osm[:/]node\//.test(place.id);
  if (!knownSeed && (!isNode || place.qualityFlags.includes('geometry_bounds_center'))) return 'daily_representative_area_center';
  const name = normalizeName(place.name);
  if (name.length < 4 || GENERIC_NAMES.has(name) || /[()（）\u0000-\u001f\u007f]/.test(place.name) || place.name.length > 150) return 'daily_unspecific_name';
  const withoutNumbers = name.replace(/\d/g, '');
  if (!/[א-ת]/.test(withoutNumbers) || /^(?:גן|ביס|ביתספר|ממד|ממ|מתנס|ספריה|ספרייה|מוזיאון|קניון)[א-ת]?$/.test(withoutNumbers)) return 'daily_code_or_generic_name';
  return null;
}

/**
 * Server-only, immutable answer catalog. Never serialize `places`/`dailyPlaces`
 * into an API response. Use prepareFor/promptFor, and reveal the answer only in
 * the service's authorized commit/finished-game path.
 */
export function createCatalog({ places, playArea, seedPlaces = [], mapStyle = {}, imageryProvenance = {}, playAreaProvenance = {}, rulesVersion = CATALOG_RULES_VERSION, rulesContentHash = '' } = {}) {
  if (!Array.isArray(places) || !Array.isArray(seedPlaces) || typeof rulesVersion !== 'string' || !rulesVersion) throw new TypeError('Catalog requires place arrays and a rules version.');
  // Copy first so freezing the catalog never mutates a caller-owned fixture.
  const mask = structuredClone(playArea);
  const contains = membershipChecker(mask), rejected = [], candidates = [], seen = new Set();
  const reject = (row, reason) => rejected.push({ id: row?.id ?? null, reason });
  for (const row of places) {
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !/[א-ת]/.test(row.name) || typeof row.category !== 'string' || !/[א-ת]/.test(row.category) || !['landmarks', 'businesses'].includes(row.poolGroup) || !sourceUrl(row.sourceUrl) || typeof row.dataSource !== 'string' || !row.dataSource || typeof row.dataLicense !== 'string' || !row.dataLicense || !Array.isArray(row.eligibleModes) || !row.eligibleModes.length || row.eligibleModes.some(mode => !MODES.includes(mode)) || !Array.isArray(row.coordinates) || row.coordinates.length !== 2 || !row.coordinates.every(Number.isFinite)) { reject(row, 'invalid_catalog_record'); continue; }
    if (seen.has(row.id)) throw new Error(`Duplicate catalog place ID: ${row.id}`);
    seen.add(row.id);
    if (!contains(row.coordinates)) { reject(row, 'outside_play_area'); continue; }
    const place = privateRecord(row);
    if (place.qualityFlags.some(flag => !INFORMATIONAL_FLAGS.has(flag))) { reject(row, 'actionable_quality_flag'); continue; }
    candidates.push(place);
  }
  // Check ambiguity against the entire accepted snapshot, not only daily sites.
  const contexts = new Map();
  for (const place of candidates) for (const mode of MODES) {
    const cell = gridCell(place.coordinates, mode);
    const keys = [`${mode}|${cell.id}|${place.category}|${normalizeName(place.ambiguityName ?? place.name)}`];
    if (place.brand) keys.push(`${mode}|${cell.id}|brand-name|${normalizeName(place.brand)}`);
    if (place.brandWikidata) keys.push(`${mode}|${cell.id}|brand-id|${place.brandWikidata}`);
    for (const key of keys) { if (!contexts.has(key)) contexts.set(key, new Set()); contexts.get(key).add(place); }
  }
  for (const [key, group] of contexts) if (group.size > 1) {
    const mode = key.split('|')[0];
    for (const place of group) place.eligibleModes = place.eligibleModes.filter(value => value !== mode);
  }
  const maskHash = hash(mask), mapVersion = `map-sha256:${hash({ mapStyle, imageryProvenance, playAreaProvenance, maskHash })}`;
  const seedIds = new Set(seedPlaces.map(place => canonicalId(place.id)));
  const dailyHeld = [], accepted = [];
  for (const place of candidates) {
    if (!place.eligibleModes.length) { reject(place, 'ambiguous_in_all_modes'); continue; }
    place.cells = Object.fromEntries(MODES.map(mode => [mode, gridCell(place.coordinates, mode)]));
    if (!MODES.every(mode => pointInHintCell(place.coordinates, place.cells[mode]))) throw new Error(`Target/cell mismatch: ${place.id}`);
    const reason = dailyReason(place, seedIds);
    place.dailyEligible = !reason;
    place.dailyPriority = [place.id, ...place.sources.map(source => source.id).filter(Boolean)].some(id => seedIds.has(canonicalId(id))) ? 2 : 1;
    place.dailyRegion = place.cells.hard.id;
    if (reason) dailyHeld.push({ id: place.id, reason });
    place.revisionId = `place-sha256:${hash({ place, rulesVersion, rulesContentHash, mapVersion, dailyPolicyVersion: DAILY_POLICY_VERSION })}`;
    accepted.push(freeze(place));
  }
  accepted.sort((a, b) => a.id.localeCompare(b.id));
  const dailyPlaces = accepted.filter(place => place.dailyEligible).sort((a, b) => b.dailyPriority - a.dailyPriority || a.id.localeCompare(b.id));
  const byId = new Map(accepted.map(place => [place.id, place]));
  const byMode = Object.fromEntries(MODES.map(mode => [mode, Object.freeze(accepted.filter(place => place.eligibleModes.includes(mode)))]));
  const snapshotId = `catalog-sha256:${hash({ revisions: accepted.map(place => [place.id, place.revisionId]), maskHash, rulesVersion, rulesContentHash, mapVersion, dailyPolicyVersion: DAILY_POLICY_VERSION })}`;
  const resolvePlace = id => {
    const place = byId.get(typeof id === 'string' ? id : id?.id);
    if (!place) throw new RangeError('Unknown place ID.');
    return place;
  };
  const requireEligible = (id, mode) => { assertMode(mode); const place = resolvePlace(id); if (!place.eligibleModes.includes(mode)) throw new RangeError('Place is not eligible in this mode.'); return place; };
  const summary = { places: accepted.length, dailyPlaces: dailyPlaces.length, preferredSeedDailyPlaces: dailyPlaces.filter(place => place.dailyPriority === 2).length, distinctDailyHardCells: new Set(dailyPlaces.map(place => place.dailyRegion)).size, byMode: Object.fromEntries(MODES.map(mode => [mode, byMode[mode].length])) };
  return freeze({
    places: accepted, dailyPlaces, dailyCandidates: dailyPlaces, snapshotId, mapVersion, rulesVersion, dailyPolicyVersion: DAILY_POLICY_VERSION,
    playArea: mask, summary, audit: { rejected, dailyHeld },
    getPlace: id => byId.get(id) ?? null,
    placesForMode: mode => byMode[assertMode(mode)],
    isInPlayArea: point => contains(point),
    isGuessInCell: (point, id, mode) => pointInHintCell(point, requireEligible(id, mode).cells[mode]) && contains(point),
    prepareFor: (id, mode) => freeze({ cell: { ...requireEligible(id, mode).cells[mode] } }),
    promptFor: (id, mode) => { const place = requireEligible(id, mode); return freeze({ name: place.name, category: place.category, cell: { ...place.cells[mode] } }); },
  });
}

export async function loadCatalog({ placesPath, mapStylePath, playAreaPath, seedPath, imageryProvenancePath, playAreaProvenancePath, rulesPath, rulesVersion = CATALOG_RULES_VERSION, rootDirectory = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const paths = {
    places: placesPath ?? resolve(rootDirectory, 'dist/places.json'),
    mapStyle: mapStylePath ?? resolve(rootDirectory, 'dist/map-style.json'),
    playArea: playAreaPath ?? resolve(rootDirectory, 'data/play-area.geojson'),
    seed: seedPath ?? resolve(rootDirectory, 'data/seed-places.json'),
    imagery: imageryProvenancePath ?? resolve(rootDirectory, 'data/imagery-provenance.json'),
    boundary: playAreaProvenancePath ?? resolve(rootDirectory, 'data/play-area-provenance.json'),
    rules: rulesPath ?? resolve(rootDirectory, 'dist/rules.mjs'),
  };
  const readJson = path => readFile(path, 'utf8').then(JSON.parse);
  const [document, mapStyle, playArea, seed, imageryProvenance, playAreaProvenance, rulesSource] = await Promise.all([readJson(paths.places), readJson(paths.mapStyle), readJson(paths.playArea), readJson(paths.seed), readJson(paths.imagery), readJson(paths.boundary), readFile(paths.rules, 'utf8')]);
  return createCatalog({ places: document.places, seedPlaces: seed.places, playArea, mapStyle, imageryProvenance, playAreaProvenance, rulesVersion, rulesContentHash: createHash('sha256').update(rulesSource).digest('hex') });
}
