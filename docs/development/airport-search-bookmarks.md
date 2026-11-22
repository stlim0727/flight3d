# Airport search and bookmarks (issue #922 step 4)

The lobby map-flight panel now has a local search box, a compact Korea map and
bookmarks. All three feed the same selection path as the existing map selects.

## Data and ranking

`airportSearch.js` filters the loaded `mapPlaces` catalog. It normalizes case,
accents, punctuation and spacing, then ranks exact ICAO/IATA codes, code
prefixes, name/label prefixes, token prefixes and substrings. Korean and English
labels both work; an empty query returns no results. The catalog comes from the
committed OurAirports index plus `REGIONAL_CRUISES`, so no airport code is
hand-authored in the UI.

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

## Verification

- `tests/airportSearch.test.js`: ICAO/IATA/name ranking, normalization, limits and immutability.
- `tests/airportBookmarks.test.js`: persistence, validation, dedupe/cap and storage failures.
- `npm run test:map-search`: hardware Vulkan Chrome search, map centring, bookmark
add, restore, and restore again after a real `Page.reload` in the same browser
profile. Refresh persistence is also covered by the bookmark store tests.
