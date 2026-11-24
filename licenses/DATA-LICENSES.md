# Data and remotely served imagery

This notice identifies the data licenses separately from SatGuess's MIT application license. Dataset source records and their original notices must remain available when redistributing the project or database.

## Shipped question database

`dist/places.json` is an adapted OpenStreetMap-derived database, enriched with independently sourced CC0 Wikidata records. The assembled database is distributed under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/), with attribution:

© OpenStreetMap contributors — https://www.openstreetmap.org/copyright

Wikidata source records — CC0 1.0 — https://www.wikidata.org/wiki/Wikidata:Licensing

The JSON includes its database license URL and per-record source URLs/licenses. Independently obtained Wikidata facts retain their CC0 status. Reusers should keep those original-source distinctions while respecting ODbL for the adapted database. The game's download link supplies the machine-readable adapted database; a repository fork must continue to offer equivalent access when publicly using it.

OSM imports and source-based OSM audit extracts, where included, are ODbL. Wikidata-only inputs and source-based Wikidata extracts, where included, are CC0. SatGuess's original editorial prose and code are MIT; those do not replace the underlying data licenses.

## Play-area masks

`data/play-area.geojson` and `data/outside-play-area.geojson` are precomputed dissolved derivatives. They are distributed under ODbL 1.0, with attribution to the CC BY 4.0 input retained:

© OpenStreetMap contributors and geoBoundaries; selected PSE component CC BY 4.0.

- ISR: geoBoundaries gbOpen ISR ADM0, OSM/Wambacher source, represented year 2017; ODbL 1.0.
- PSE: geoBoundaries gbOpen PSE ADM0, 2021 Sentinel-derived land geometry processed by IMB; CC BY 4.0. Only the specified complete West Bank components were selected.
- Modifications: selected components, removed extra coordinate dimensions, normalized/rounded coordinates and ring orientation, dissolved overlaps, and derived the inverse world mask. No political-border or survey accuracy claim is made.

[Pinned downloads, source identifiers, hashes, exact selection and processing](../data/play-area-provenance.json) are retained with the geometry. [geoBoundaries citation](https://www.geoboundaries.org/index.html#citation); [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Survey of Israel aerial imagery

The primary remote layer is the Survey of Israel's 2015, 2 metre orthophoto dataset. Source: המרכז למיפוי ישראל / Survey of Israel, via Data.gov.il.

- [Original dataset](https://data.gov.il/he/datasets/israel_mapping_center/tly)
- [Government dataset reuse license](https://data.gov.il/he/terms-of-use)
- [Rehost catalog](https://www.arcgis.com/home/item.html?id=1ef1f7b0909e468b93d7e224bd94c13b), hosted by Systematics
- [Recorded provenance](../data/imagery-provenance.json)

The published default dataset license permits royalty-free worldwide commercial and noncommercial reuse, adaptation and redistribution, subject to its terms including source attribution, unless a separate dataset license overrides it. The dataset was checked without a separately attached overriding license. The rights are for that government dataset; they do not license other products on the same hosting platform. Hosting access and continued availability are separate from data rights.

No aerial imagery files or ArcGIS account credentials are committed. The renderer requests remote tiles and clips/composites them for gameplay; these pixels are not relicensed under MIT.

## EOxCloudless 2016 fallback

Only the 2016 vintage is configured. It is published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), subject to the provider's published public-service conditions. Attribution:

EOxCloudless — https://cloudless.eox.at — by EOX IT Services GmbH — Contains modified Copernicus Sentinel data 2016.

SatGuess clips the coverage and composites fallback pixels into gaps in the primary aerial imagery. The provider's [attribution and service guidance](https://cloudless.eox.at/documentation/faq) is part of the deployment review. Later EOX vintages have different licensing; changing the year requires checking that vintage's terms. No standalone EOX tile collection is distributed here.

