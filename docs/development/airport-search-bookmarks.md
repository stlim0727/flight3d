# Airport search and bookmarks (issue #922 step 4)

The lobby place picker opens a dedicated full-screen map dialog with a
Google-Maps-style search dropdown, bookmark chips and the same selection path as
the existing map selects.

## Data and ranking

`airportSearch.js` filters the loaded `mapPlaces` catalog. It normalizes case,
accents, punctuation and spacing, then ranks exact ICAO/IATA codes, code
prefixes, name/label prefixes, token prefixes and substrings. Korean and English
labels both work; an empty query returns no results. Airport rows come from the
committed OurAirports index and regional cruise points from `REGIONAL_CRUISES`;
`mapFlightPlaces.js` additionally curates the global `paris-eiffel` point. No
airport code is hand-authored in the UI.

## Selection flow

Clicking a search result, SVG marker or bookmark calls the existing
`emitMapPlan()` path and closes the dialog. Airports set the airport select and
seed a runway; cruise points set the point select and force the cruise state.
`onMapPlan` then resolves the geographic anchor, destination and spawn plan
exactly as for a manual select. Selecting a result also centres the SVG
`viewBox` on its coordinates.

## Bookmarks

`airportBookmarks.js` stores `{kind, id, label, latitude, longitude, iata?}` in
`flight3d.bookmarks.v1`. Entries are validated, deduplicated by `kind:id`, capped
at 50, and loaded through guarded `localStorage` access. Malformed JSON or
blocked storage yields an empty list without throwing, preserving the session.
Bookmarks survive refresh; clicking one re-resolves an airport from the index if
it is no longer in the initial catalog.


## Global search (issue #944 item 2)

The deterministic builder emits `<version>/search.json` alongside the tiles,
from the same validated airport records. Each entry holds only `code` (ICAO),
`iata`, `name`, `latitude`, `longitude`, `country`, `type` and `tileId` — never
runways. The root manifest pins the artifact's path, schema version and count,
so a stale or truncated file cannot be mistaken for a valid index. The artifact
is regenerated offline from `scripts/airport-index/snapshots/` by
`node scripts/airport-index/build.mjs`; no network is needed.

The manifest also maps identifiers of airports without an ICAO code (under
`ident`), so every search result — including small US fields whose code is a
local identifier — resolves through one `findAirportByCode()` tile lookup.

`loadAirportSearchIndex()` fetches the artifact only when the lobby place
browser is used, validates it, caches it per base URL and version, and shares
`clearAirportIndexCache()`. Fetch/validation failures reject; the lobby shows a
distinct error state in `#lobby-map-search-status` with a click-to-retry affordance
and keeps local Korean places, cruise points and bookmarks. `searchAirportIndex()`
applies the same normalization and score order as the local catalog, and local
results are listed first with global-only matches appended.

Clicking a global result resolves the full record with one `findAirportByCode()`
tile lookup, using the artifact entry's `tileId` as the hint so a three-letter
identifier cannot be hijacked by another airport's IATA code. It is adapted with
`indexedAirportPlace()` (which does not filter by country), then reuses
`selectMapPlace()` → `emitMapPlan()` → `onMapPlan()`. The
host registers the code as an external destination and assigns it as the
destination exactly as for a local map selection. A record without runways
still forces the cruise state, so runway/approach starts are never offered
without real runway geometry.

## Offline place search (GeoNames)

`public/data/places/` contains a precomputed catalog of 10,000 populated
places and 5,733 notable islands, mountains, lakes, monuments and towers. It
is generated from GeoNames `cities15000` and `allCountries` snapshots by
`node scripts/place-index/build.mjs --source-dir DIR`; normal builds read the
committed snapshots in `scripts/place-index/snapshots/`, so no network is
needed. `npm run refresh:places` re-downloads the sources and regenerates both
the snapshots and the versioned artifact. The manifest pins the artifact path,
schema and count; `loadPlaceSearchIndex()` rejects stale or partial files.

Entries carry English labels plus localized aliases (including Hangul where
GeoNames supplies one), WGS84 coordinates, country, feature kind and a cruise
altitude derived from elevation. Search uses the same normalization and
ranking as airports (`searchPlaceIndexScored`), and results are merged into
the lobby dropdown with `source: 'place-index'`. Selecting one takes the
existing cruise-point path; far-away places get `mapPlanCustomOrigin()` just
like the Paris Eiffel Tower point. GeoNames data is CC BY 4.0 — attribution is
shown in the map dialog and recorded in the manifest; see
`https://www.geonames.org/export/`.


## Verification

- `tests/airportSearch.test.js`: ICAO/IATA/name ranking, normalization, limits and immutability.
- `tests/airportBookmarks.test.js`: persistence, validation, dedupe/cap and storage failures.
- `npm run test:map-search`: hardware Vulkan Chrome search, map centring, bookmark
add, restore, and restore again after a real `Page.reload` in the same browser
profile. Refresh persistence is also covered by the bookmark store tests.
- `npm run test:map-scroll`: hardware Vulkan Chrome check that the dialog opens,
the search dropdown appears, a result closes it and applies the plan, and zoom,
pinch and horizontal pan still work while vertical drags leave the map viewBox
untouched.
- `tests/airportIndexBuilder.test.js`, `tests/airportIndexData.test.js`: artifact contents, version pin and tile consistency.
- `tests/airportIndex.test.js`: lazy reader caching, validation and propagated failures.
- `tests/uiStateContract.test.js`: loading/ready/empty/error/retry states, local-result preservation and global-result selection.
- `tests/placeIndex.test.js`, `tests/placeIndexData.test.js`: place index loader validation, caching, artifact integrity and representative city/island/landmark coverage.
- `npm run test:places`: focused place search verification.
