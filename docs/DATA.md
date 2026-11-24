# Place data

The game ships a saved OpenStreetMap-derived question snapshot with supplementary Wikidata landmarks. Every record contains its source and license metadata. The adapted database is ODbL 1.0; source notices are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

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
