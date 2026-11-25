# Airport search and bookmarks (issue #922 step 4)

The lobby map-flight panel now has a local search box, a compact Korea map and
bookmarks. All three feed the same selection path as the existing map selects.

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
`emitMapPlan()` path. Airports set the airport select and seed a runway; cruise
points set the point select and force the cruise state. `onMapPlan` then resolves
the geographic anchor, destination and spawn plan exactly as for a manual
select. Selecting a result also centres the SVG `viewBox` on its coordinates.

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

## Verification

- `tests/airportSearch.test.js`: ICAO/IATA/name ranking, normalization, limits and immutability.
- `tests/airportBookmarks.test.js`: persistence, validation, dedupe/cap and storage failures.
- `npm run test:map-search`: hardware Vulkan Chrome search, map centring, bookmark
add, restore, and restore again after a real `Page.reload` in the same browser
profile. Refresh persistence is also covered by the bookmark store tests.
- `tests/airportIndexBuilder.test.js`, `tests/airportIndexData.test.js`: artifact contents, version pin and tile consistency.
- `tests/airportIndex.test.js`: lazy reader caching, validation and propagated failures.
- `tests/uiStateContract.test.js`: loading/ready/empty/error/retry states, local-result preservation and global-result selection.
