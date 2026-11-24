# Attribution presentation

Checked against primary publisher guidance on 2026-11-24. This file records the attribution requirements; it does not grant a new permission or replace the original license terms.

## OpenStreetMap

The [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) distinguish interactive maps from computer games:

- Section 1.5.10 permits computer-game attribution in a startup splash, game view, gameplay, credits page, menu or other suitable location. A clearly discoverable help/credits panel is a reasonable game-menu implementation.
- Section 1.5.2 provides a separate interactive-map safe harbour: attribution can appear in a map corner, adjacent to the map, or in a startup splash/pop-up. It may then collapse after dismissal, map interaction, or five seconds. License information must remain findable, for example through an info/About control.
- A hidden question-mark control alone is not the same as initially presenting interactive-map attribution. An explicit help-and-credits accessible name makes the credits easier to discover.

Use a linked `© OpenStreetMap contributors` credit pointing to https://www.openstreetmap.org/copyright. Retain the ODbL name/link in the downloadable database and repository data notice.

## OpenMapTiles and the adapted style

The [OpenMapTiles license](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md) requires visible OpenMapTiles credit and says browsable electronic-map credit should appear in a corner of the map. Written exceptions are offered by MapTiler; none has been obtained for this project. The inherited [OSM Liberty notice](../dist/MAP-STYLE-LICENSE.md) repeats that guidance.

The [Mapbox Open Styles visual-design notice](Mapbox-Open-Styles-LICENSE.md) allows its design attribution to be reasonably accessible from the map; detailed help/credits are suitable for that separate notice.

Removing a bottom attribution bar can retain a compact visible OpenMapTiles link near the top map controls, with full notices in help. The OSM computer-game allowance does not itself waive another source's requirements.

## EOX fallback imagery

The [EOX FAQ, Attribution & Screen Display](https://cloudless.eox.at/documentation/faq#attribution-screen-display) says attribution must be visible when its imagery is shown. Its web-display guidance places the credit on the map interface and explicitly allows on-click/app-information attribution for compact mobile interfaces. This is not an explicit blanket desktop help-only exception.

Keep the EOX credit visible near the map controls when fallback imagery is actually displayed on desktop, or omit the fallback if the desired layout cannot display it. Full credits can also remain in help. For compact mobile UI, the provider expressly permits the credits pop-up/app-information placement. Exported images or videos containing EOX imagery need an embedded visible credit.

Attribution identifies EOxCloudless, links to https://cloudless.eox.at, credits EOX IT Services GmbH, and identifies modified Copernicus Sentinel data 2016. The configured fallback is the 2016 CC BY 4.0 layer.

## Government aerial imagery and other sources

The [Data.gov.il dataset license](https://data.gov.il/he/terms-of-use) requires source credit without prescribing a bottom-corner UI. Credit the Survey of Israel, the dataset/year/resolution, source and license in help. Include Systematics as the tile host without implying that its unrelated imagery products are licensed here.

Keep geoBoundaries/OSM boundary credits, CC BY input notices, Wikidata source information and font/library notices in the credits and repository notices as applicable. Displayed credit text does not need to expose local file paths, internal hosting IDs, development history or personal account information.
