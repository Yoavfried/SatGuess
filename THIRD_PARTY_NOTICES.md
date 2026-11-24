# Third-party notices

SatGuess's original application code, original interface artwork, tests and documentation are available under the [MIT License](LICENSE). Copyright (c) 2026 SatGuess contributors.

The MIT grant covers the contributors' work. The components and data below retain their own open licenses and attribution requirements. A public MIT code repository does not change those licenses.

| Component | Location or use | License and notices |
| --- | --- | --- |
| MapLibre GL JS 5.6.2 | `dist/maplibre-gl.js`, `dist/maplibre-gl.css` | BSD 3-Clause and included dependency notices; retain [the complete bundled notice](dist/MAPLIBRE-LICENSE.txt). [Upstream release license](https://github.com/maplibre/maplibre-gl-js/blob/v5.6.2/LICENSE.txt). |
| OSM Liberty / Mapbox Open Styles | Adapted road styling in `dist/map-style.json` | BSD 3-Clause code, CC BY 3.0 inherited visual design; retain [OSM Liberty notice](dist/MAP-STYLE-LICENSE.md) and [Mapbox Open Styles notice](licenses/Mapbox-Open-Styles-LICENSE.md). Original Mapbox Open Styles copyright (c) 2014 Mapbox. SatGuess removes symbols, labels, shields and unrelated layers, changes colors and blends the retained roads with aerial imagery. |
| OpenMapTiles | Vector-tile schema and cartographic design used by the road overlay | BSD 3-Clause code / CC BY 4.0 design. [Complete upstream notice](licenses/OpenMapTiles-LICENSE.md); visible linked OpenMapTiles credit is required. Copyright (c) 2024 MapTiler.com & OpenMapTiles contributors. |
| OpenStreetMap | Road geometry, OSM place records, and the OSM-derived portion of the play-area boundary | ODbL 1.0. © OpenStreetMap contributors. [Copyright and contributors](https://www.openstreetmap.org/copyright); [license](https://opendatacommons.org/licenses/odbl/1-0/). |
| Wikidata | Independently sourced place records and source evidence | CC0 1.0. [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing); [CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/). Wikidata source facts remain CC0; the assembled OSM-derived game database is distributed under ODbL. |
| geoBoundaries gbOpen | Selected source polygons used to build `data/play-area.geojson` and `data/outside-play-area.geojson` | The ISR input is OSM-derived ODbL; the selected PSE input is CC BY 4.0. The dissolved output is ODbL with the CC BY input attribution retained. See [boundary provenance](data/play-area-provenance.json) and [data notice](licenses/DATA-LICENSES.md). |
| Survey of Israel / המרכז למיפוי ישראל | Remotely loaded 2015 orthophoto, 2 metre pixels | Data.gov.il default dataset reuse license, including source attribution. [Original dataset](https://data.gov.il/he/datasets/israel_mapping_center/tly); [terms](https://data.gov.il/he/terms-of-use). The public tile service is hosted by Systematics; it is a rehost of this government dataset, not Esri World Imagery. No imagery pixels are bundled in the repository. |
| EOxCloudless 2016 | Remotely loaded fallback in gaps of the main aerial imagery | CC BY 4.0 for this 2016 vintage. EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016). SatGuess clips displayed coverage and composites it with the primary aerial layer. [Provider](https://cloudless.eox.at/); [provider terms and attribution rules](https://cloudless.eox.at/documentation/faq); [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). No source tiles are bundled. |
| OpenFreeMap | Remote hosting of OpenMapTiles-schema vector tiles | Hosting service; underlying data/style licenses still apply. [Quick start and attribution example](https://openfreemap.org/quick_start/); [service terms](https://openfreemap.org/tos/). |

Font notices are listed in [the font notice](licenses/FONTS.md). System fonts requested as fallbacks are supplied by the viewer's operating system, not redistributed by this project. The label-free map does not load the upstream style's font glyphs or sprite icons.

The upstream full-style notice mentions Maki icons and Roboto. Those upstream icons, sprites and fonts are not redistributed or used by SatGuess's label-free road style. Their mention is retained as part of the unmodified upstream notice, not as a claim that these assets are bundled.

## Attribution in the game

Keep provider names and license links in the game's help/credits panel and retain the downloadable question database with its attribution and ODbL notice. [Attribution presentation notes](licenses/ATTRIBUTION.md) explain the different map, game and imagery requirements. Moving a control does not remove the underlying attribution obligations.

The licenses do not grant endorsement by OpenStreetMap, Wikimedia, geoBoundaries, EOX, the Survey of Israel, Systematics, MapTiler, Mapbox or MapLibre. Third-party names identify the actual sources and components.
