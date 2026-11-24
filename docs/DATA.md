# Place data and local attempts

The game ships a saved OpenStreetMap-derived question snapshot with supplementary Wikidata landmarks. Every record contains its source and license metadata. The adapted database is ODbL 1.0; source notices are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Local game storage

Run `npm start` with Node.js 24+. The API uses Node's built-in SQLite module and creates `.data/satguess.sqlite` on first use. The `.data/` directory and SQLite/WAL files are ignored by Git. The local Node server binds to the loopback interface. Hosted deployments use a separate persistent Cloudflare Durable Object with the same schema and repository guards; see [hosting](HOSTING.md).

The database stores player profiles, daily challenges, resumable runs, first place exposures and normalized `round_attempts`. The browser receives an HttpOnly identity cookie and an optional nickname; there is no registration flow. The database stores a hash of the cookie secret. Keep the local database separate from source/data snapshots and public exports.

Daily challenges use Asia/Jerusalem calendar dates, five 30-second rounds and one run per browser identity/day. A map can be prepared before its prompt is issued; first exposure is recorded when the name is first served. Server timestamps determine the deadline, and a resumed round retains it. Practice is untimed, with statistics available for each finalized round while the rest of the game remains in progress. Daily answers, statistics and its leaderboard become available after completion.

## Export attempt measurements

Provide an explicit destination path:

```sh
npm run export:attempts -- --output outputs/attempts.csv
npm run export:attempts -- --output outputs/first-finalized.csv --finalized-only --first-exposure-only
node scripts/export-attempts.mjs --db .data/satguess.sqlite --output outputs/attempts-copy.csv
```

The exporter opens SQLite read-only and writes a UTF-8 CSV with a BOM. It refuses to overwrite an existing file. It selects normalized `round_attempts` columns directly, without joining player profiles or exporting raw JSON. Player, run and attempt IDs, nicknames, cookie tokens and session hashes are excluded. Source-place/revision/cohort IDs, round index, game settings, exposure flag, timestamps, accepted guess coordinates, measured distances, score and outcome are retained. These measurements describe browser activity; removing direct identifiers does not make every row anonymous.

Without filters, the CSV includes started but unfinished rounds; their uncommitted measurements are empty. `--finalized-only` requires a finalization timestamp, and `--first-exposure-only` requires the source exposure flag. Timestamps are UTC epoch milliseconds, distances are metres, coordinates are longitude/latitude, and `round_index` is zero-based. A no-pin timeout can have a finalized score of zero with empty coordinates and distances.

For per-place comparison, use the same `place_revision_id` and `cohort_key`, finalized first exposures, one reference per other browser identity, and exclude the requesting identity. The service's cohort also reflects rules, map version, difficulty, collection, timer version and fixed hint cell. The CSV deliberately omits the identity needed for an exact requester-specific comparison; use the service's statistics for that result. At least 30 references are required before showing a percentile. It is the percentage with strictly greater error; equal errors do not count as wins.

## Refresh OpenStreetMap

From the project root:

```sh
node scripts/fetch-osm-broad.mjs
node scripts/import-osm-broad.mjs data/osm-broad-raw.json data/osm-broad-imported.json data/play-area.geojson
node scripts/build-game-pools.mjs data/seed-places.json dist/places.json data/osm-broad-imported.json
npm test
```

The fetch helper runs one bounded regional Overpass query from `data/israel-pois-broad.overpass`. Check its output for completeness; do not run repeated national queries for gameplay. The importer clips to the sourced play-area boundary, keeps Hebrew-named physical venues and records rejected or uncertain records. Review an updated snapshot before publishing it.

The builder preserves source names, deduplicates spatially compatible records and checks name/category and tagged-brand collisions separately for each difficulty. An OSM Wikidata tag is treated as a nearby identity hint, because some tags refer to a chain rather than an individual branch. Geometry bounds centres are approximate targets; uncertain multi-node merges are held for review.

## Export a list

```sh
node scripts/export-places.mjs places.csv
node scripts/export-places.mjs institutions.csv landmarks normal
node scripts/export-places.mjs broad.csv all normal
```

The CSV includes eligible difficulties, source licenses and coordinate kind. Preserve these details with redistributed data. Large raw exports and generated review files are intentionally ignored by Git.

## Imagery and boundaries

`data/imagery-provenance.json` documents the Survey of Israel and EOX sources. `data/play-area-provenance.json` documents the regional boundary sources and excluded regions. The game clips imagery before display and requests fallback imagery only for confirmed gaps inside the allowed area.

Coordinate precision, an active source tag or a 10 m answer radius does not establish surveyed accuracy. Large areas, moved venues and image-date mismatches need editorial review.
