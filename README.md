<div align="center">
  <img src="dist/icon.svg" width="64" height="64" alt="SatGuess logo">
  <h1>אנחנו על המפה</h1>
  <p>A Hebrew geography game. A place name, a square, and your best guess.</p>
  <p><a href="LICENSE">MIT code</a> · <a href="THIRD_PARTY_NOTICES.md">Data & credits</a> · <a href="CONTRIBUTING.md">Contribute</a></p>
</div>

![The game interface](docs/preview.jpg)

Find real places on aerial imagery without map labels. Each round reveals a name, a category and its geographic square. Place a pin on land inside that square; the closer you get, the more points you earn.

## Play locally

Requires **Node.js 22+**. No accounts, API keys or package installation are needed.

```sh
npm start
```

Open **http://127.0.0.1:4173**. Imagery and roads load from public tile services, so playing requires an internet connection. Fonts and the map engine are bundled locally.

## The game

- Five rounds, up to 100 points each.
- Hebrew interface with right-to-left layout.
- Approximate 5, 10 or 20 km grid squares.
- Two place collections: landmarks/institutions, or the broader collection including local businesses.
- A red 10 m circle reveals the answer after each guess.
- Personal bests stay in your browser, separately for each collection and difficulty.

At the default 10 km setting, the snapshot offers **14,560** landmarks/institutions or **25,164** places including businesses. Ambiguous names and tagged chain branches within a square are excluded for that difficulty. No city qualifier is added to the prompt.

The playable area includes Israel proper, the Golan Heights and the West Bank. Gaza, neighbouring countries and surrounding sea are masked out. A guess must be inside both the active square and the playable land area.

## Development

The app is static HTML, CSS and JavaScript modules. Serve `dist/` from any static host; the included Node server is for local development.

```sh
npm test
npm run check
```

| Directory | Contents |
| --- | --- |
| `dist/` | Playable app, question snapshot, fonts and map engine |
| `data/` | Source provenance, boundary geometry, query and seed places |
| `scripts/` | Offline place-data import and build tools |
| `tests/` | Geography, scoring, data-import and imagery checks |
| `licenses/` | Third-party license texts and attribution guidance |

## Places and imagery

OpenStreetMap is the main place source; Wikidata contributes additional landmarks. The app loads a saved snapshot and does not query those services during a round. To refresh the list, run the offline tools described in [the data guide](docs/DATA.md).

Targets are source-screened, not individually surveyed. Some coordinates represent a building or area's centre rather than its entrance; the 10 m answer circle does not guarantee 10 m source accuracy. Names, venues and imagery may differ in age. Report a questionable target with its source link.

The main aerial imagery is the **Survey of Israel 2015 orthophoto**. EOX's **2016** mosaic fills confirmed gaps only within the playable area. Roads use OpenStreetMap geometry through OpenFreeMap/OpenMapTiles. Full sources, licenses and required credits are available from `?` in the game and in [third-party notices](THIRD_PARTY_NOTICES.md).

## License

Original application code is **[MIT](LICENSE)**. MapLibre, fonts, map data and imagery retain their own open licenses. The adapted place database is **ODbL 1.0**; Wikidata source records are **CC0**. See [the notices](THIRD_PARTY_NOTICES.md) before redistributing those materials.

Preview imagery: Survey of Israel; EOxCloudless by EOX IT Services GmbH, containing modified Copernicus Sentinel data 2016. Roads and boundaries: © OpenStreetMap contributors, OpenMapTiles and geoBoundaries. Their applicable credits and licenses are retained in the source notices.
