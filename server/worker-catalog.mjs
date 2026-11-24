// Runtime-only hydration. No filesystem, Node database, or build-time catalog
// loader belongs in this module's dependency graph.
export const WORKER_CATALOG_FORMAT = 'satguess-private-worker-catalog';
export const WORKER_CATALOG_FORMAT_VERSION = 1;
export const WORKER_PLACE_COLUMNS = Object.freeze(['id', 'revisionId', 'name', 'categoryIndex', 'longitude', 'latitude', 'sourceUrl', 'sourceLabelIndex', 'poolCode', 'modeMask', 'dailyPriority', 'dailyRegion']);
const MODES = Object.freeze(['easy', 'normal', 'hard']);
const MODE_ARRAYS = Object.freeze(Array.from({ length: 8 }, (_, mask) => Object.freeze(MODES.filter((_, index) => mask & (1 << index)))));

function freezeGeometry(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) freezeGeometry(child);
  return Object.freeze(value);
}

function invalid(message) { throw new TypeError(`Invalid private Worker catalog: ${message}`); }
const indexValid = (index, dictionary) => Number.isInteger(index) && index >= 0 && index < dictionary.length;
const versionValid = value => typeof value === 'string' && value.length > 0;

/**
 * Hydrate a trusted, bundled build artifact only after a Durable Object starts.
 * Node's offline loader already performs polygon/name/brand/revision checks.
 * Here we validate shape, identities, references and counts without repeating
 * national geometry scans or rehashing all answer/source metadata.
 * `places` and `dailyPlaces` are private; API responses must use game-service DTOs.
 */
export function hydrateWorkerCatalog(artifact) {
  if (!artifact || artifact.format !== WORKER_CATALOG_FORMAT || artifact.formatVersion !== WORKER_CATALOG_FORMAT_VERSION) invalid('unsupported format');
  const { versions, categories, sourceLabels, rows, dailyIds, modeIds, playArea, counts } = artifact;
  if (!versions || !['snapshotId', 'mapVersion', 'rulesVersion', 'dailyPolicyVersion'].every(key => versionValid(versions[key]))) invalid('missing frozen versions');
  if (!Array.isArray(categories) || !categories.every(value => typeof value === 'string' && value) || !Array.isArray(sourceLabels) || !sourceLabels.every(value => typeof value === 'string' && value)) invalid('invalid dictionaries');
  if (!Array.isArray(rows) || rows.length > 100000 || !Array.isArray(dailyIds) || !modeIds || !counts || counts.places !== rows.length || counts.dailyPlaces !== dailyIds.length) invalid('invalid row counts');
  if (!playArea || !['Feature', 'FeatureCollection', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(playArea.type)) invalid('missing exact play area');
  const byId = new Map(), places = [], dailySet = new Set(dailyIds), expectedModeCounts = [0, 0, 0];
  if (dailySet.size !== dailyIds.length) invalid('duplicate daily IDs');
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== WORKER_PLACE_COLUMNS.length) invalid('incorrect row width');
    const [id, revisionId, name, categoryIndex, lng, lat, sourceUrl, sourceLabelIndex, poolCode, mask, dailyPriority, dailyRegion] = row;
    if (typeof id !== 'string' || !id || byId.has(id) || !versionValid(revisionId) || typeof name !== 'string' || !/[א-ת]/.test(name) || !indexValid(categoryIndex, categories) || !indexValid(sourceLabelIndex, sourceLabels)
      || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90 || typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')
      || ![0, 1].includes(poolCode) || !Number.isInteger(mask) || mask < 1 || mask > 7 || ![1, 2].includes(dailyPriority) || typeof dailyRegion !== 'string' || !dailyRegion.startsWith('hard:')) invalid('invalid place row');
    if (dailySet.has(id) && (poolCode !== 0 || mask !== 7)) invalid('daily place is not an all-mode landmark');
    const place = Object.freeze({
      id, revisionId, name, category: categories[categoryIndex], coordinates: Object.freeze([lng, lat]),
      sourceUrl, sourceLabel: sourceLabels[sourceLabelIndex], poolGroup: poolCode === 0 ? 'landmarks' : 'businesses', eligibleModes: MODE_ARRAYS[mask],
      dailyPriority, dailyRegion, dailyEligible: dailySet.has(id),
    });
    places.push(place); byId.set(id, place);
    for (let index = 0; index < 3; index++) if (mask & (1 << index)) expectedModeCounts[index]++;
  }
  const resolveIds = (ids, modeIndex) => {
    if (!Array.isArray(ids)) invalid('missing pool IDs');
    const seen = new Set(), values = [];
    for (const id of ids) {
      const place = byId.get(id);
      if (!place || seen.has(id) || modeIndex !== undefined && !place.eligibleModes.includes(MODES[modeIndex])) invalid('unknown, duplicate or ineligible pool ID');
      seen.add(id); values.push(place);
    }
    return Object.freeze(values);
  };
  const byMode = Object.fromEntries(MODES.map((mode, index) => {
    const values = resolveIds(modeIds[mode], index);
    if (values.length !== expectedModeCounts[index] || counts.byMode?.[mode] !== values.length) invalid('mode count mismatch');
    return [mode, values];
  }));
  const dailyPlaces = resolveIds(dailyIds);
  if (new Set(dailyPlaces.map(place => place.dailyRegion)).size !== counts.distinctDailyHardCells || dailyPlaces.filter(place => place.dailyPriority === 2).length !== counts.preferredSeedDailyPlaces) invalid('daily count mismatch');
  const summary = Object.freeze({ ...counts, byMode: Object.freeze({ ...counts.byMode }) });
  return Object.freeze({
    places: Object.freeze(places), dailyPlaces, dailyCandidates: dailyPlaces, playArea: freezeGeometry(playArea),
    snapshotId: versions.snapshotId, mapVersion: versions.mapVersion, rulesVersion: versions.rulesVersion, dailyPolicyVersion: versions.dailyPolicyVersion, summary,
    placesForMode(mode) { if (!MODES.includes(mode)) throw new RangeError(`Unknown mode: ${mode}`); return byMode[mode]; },
    getPlace(id) { return byId.get(id) ?? null; },
  });
}
