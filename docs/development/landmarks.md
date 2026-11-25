# Landmark pins

Landmark pins are screen-space labels anchored to a point in the world. On any
geographic map (`incheon`, `jeju`, `lukla`, or any open-world terrain supplying
`terrain.origin` / `terrain.wgs84Origin`), major landmarks are **automatically
discovered, ranked, and displayed** globally from the same Overture Maps PMTiles
archives that Flight3d streams for terrain, roads, parks, and buildings — no
manual per-place coordinates or code are required for new cities, mountains,
bridges, airports, or towers.

## Automatic discovery (primary source)

`GeographicLandmarks` (`src/environment/GeographicLandmarks.js`) streams
landmarks around the aircraft and camera across multiple zooms:

1. **`divisions.pmtiles` (z9–z10):** Cities ranked by Overture `@prominence`
   and population, plus districts (`county`/`macrohood`) and Wikidata towns.
2. **`base.pmtiles` (z11, z13, and camera look-ahead z13):** Airports, towers,
   Wikidata bridges, dams/power plants, major rail/subway stations, mountain
   peaks/volcanoes, national parks, theme parks, stadiums, universities, large
   industrial/commercial campuses, islands, beaches, and major lakes/bays.
   z13 tiles already downloaded by `GeographicGreenSpace` are ingested with zero
   extra network requests.
3. **`buildings.pmtiles` (z14, zero extra requests):** Non-residential towers
   (≥ 120 m) and iconic public/terminal buildings extracted directly as
   `GeographicBuildings` loads each tile.

Pure extraction, filtering, and deduplication live in
`src/geospatial/overtureLandmarks.js` (`parseOvertureNames`,
`extractDivisionLandmarks`, `extractBaseLandmarks`,
`extractBuildingLandmarks`, `dedupeLandmarks`).

## How selection and ranking work

1. **Deduplication (`dedupeLandmarks()`):** Merges any optional curated anchors
   with streamed Overture discoveries, collapsing duplicates by Wikidata ID,
   record ID, normalized name proximity (≤ 5 km), or co-located airports
   (≤ 2.5 km).
2. **Range and height (`landmarkRangeM()`, `resolveLandmarkHeight()`):**
   Importance levels 1–5 scale visible range from 9 km to 45 km. Ground-relative
   features dynamically query `terrain.getHeight(x, z)` as terrain tiles load so
   anchors stay seated on the terrain or roof top.
3. **Prominence-weighted priority (`nearestLandmarks()`, `landmarkPriorityScore()`):**
   Candidates within range are ranked by importance, Overture prominence, and
   distance so major airports, cities, skyscrapers, and mountain peaks outrank
   closer minor subway stations or local sub-peaks.
4. **Screen projection (`LandmarkPins`):** Discards points behind/outside the
   view or closer than 200 m, places up to five non-overlapping pins (three on
   narrow viewports), and renders a circular marker whose tip sits on the
   projected point with a kind-driven SVG icon (`src/ui/landmarkPinIcons.js`).

Synthetic maps (`neon`, `coastal`, `valley`) keep their local scene anchors in
`src/config/landmarks.js`.

## Optional curated supplement (`landmarkPlaces.json`)

`src/config/landmarkPlaces.json` remains an optional curated supplement /
offline anchor list merged with automatic Overture discoveries. Append a row
only when an explicit override or offline elevation anchor is desired:

```json
{
  "id": "suwon-digital-city",
  "names": { "ko": "삼성전자 수원 디지털시티", "en": "Samsung Suwon Digital City" },
  "latitude": 37.2598,
  "longitude": 127.0344,
  "elevationM": 60,
  "kinds": ["attraction", "corporate"],
  "importance": 4
}
```

`names.ko` and `names.en` are shown according to the active UI language, with
English as the fallback. `kinds` (`station`/`subway`, `tower`, `peak`, `dam`,
`airport`, `attraction`, `corporate`, `city`, `bridge`, `park`, `water`)
filters candidates and selects the pin icon; anything else gets a generic pin
icon.

## Supplying another dataset

Both a custom catalog and an optional category filter are constructor arguments:

```js
new LandmarkPins(document.getElementById('landmark-pins'), places, ['station']);
```

When `places` is omitted, `LandmarkPins` merges `landmarksForMap()` with
`sim.geographicLandmarkLayer.records`. When `places` is supplied explicitly, it
renders only that dataset.

Verify unit tests with `node --test tests/overtureLandmarks.test.js tests/geographicLandmarks.test.js tests/landmarks.test.js tests/landmarkPins.test.js`, and verify renderless global Overture discovery across 11 regions with `node scripts/verify-landmarks-renderless.mjs`.

## Dedicated 3D landmark models

Pins are screen-space labels; a streamed landmark record does not draw a
structure. The Paris showcase is the first dedicated model: it swaps a GLB
Eiffel Tower (three LODs, split collision envelopes) for the generic Overture
building near the tower. See [Paris showcase](paris-showcase.md) (#1014).
