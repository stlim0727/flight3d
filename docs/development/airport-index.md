# External airport and runway index

The runway index is derived from [OurAirports CSV data](https://ourairports.com/data/),
not hand-authored per airport. It supplies airports without a dedicated scene
with validated runway ends for later streaming, landing and takeoff work.

## Source and refresh

- Raw sources: `https://davidmegginson.github.io/ourairports-data/airports.csv`
  and `runways.csv`. The dictionary is at
  <https://ourairports.com/help/data-dictionary.html>. The data is public domain
  (Unlicense).
- `scripts/airport-index/snapshots/` stores the gzipped snapshots and
  `source-metadata.json` (URLs, ETag, Last-Modified, byte counts, SHA-256,
  attribution, license). Offline builds verify the raw SHA-256 and byte count.
- `npm run refresh:airports` downloads both files, replaces the snapshots and
  rebuilds. `npm run build:airports` rebuilds from the committed snapshots
  without network access. `--source-dir DIR` builds from plain CSVs in another
  directory; `--tile-degrees N` changes the shard size (must divide 180 and 360).
- The version is `YYYYMMDDTHHMMSSZ-<8 hex digits>`: source Last-Modified plus a
  hash of both raw source hashes and `tileDegrees`. A changed source or tile
  size gets a new version, so different layouts never share tile URLs. An
  unchanged source rebuilds the same tiles. Old version directories are kept
  until manually removed.

## Output contract

`public/data/airports/manifest.json` is small and holds the schema version,
datum, source provenance, counts, tile bounds, and ICAO/IATA → tile maps.
`public/data/airports/<version>/tiles/<y>-<x>.json` holds airports whose ARP
falls in that 10-degree WGS84 box, each with its validated runways.

An airport row has `id`, `ident`, `icao`, `iata`, `name`, `type`, WGS84
`latitude`/`longitude`, MSL `elevationM`, country/region/municipality and
`runways`. A runway has `lengthM`, `widthM`, `surface`, `lighted` and two
`ends`. Each end keeps `physical` coordinates/elevation and a separate
`threshold` with its own coordinates/elevation, plus
`displacedThresholdM` and true `headingDegT`. A zero displacement still has
both objects so consumers use one shape.

## Validation and exclusions

The builder joins runways to airports by OurAirports numeric ID, never by
display name.

- Airports must be `large_airport`, `medium_airport` or `small_airport` with
  finite WGS84 coordinates and a finite MSL elevation. Closed, heliport,
  seaplane and balloonport rows are not runways targets.
- Runways must be open, 500–30000 ft long, 15–1000 ft wide, and have a surface
  whose tokens map to known categories or aliases (`ASP`, `CON`, `TURF`, `GRE`,
  `DIRT`, `PEM`, ...). Unknown notes such as `Delete duplicate`, `UNK` and
  `WATER` are rejected. Both physical ends need coordinates and elevations.
  The great-circle distance between ends must agree with the declared surface
  length within 30 %. An invalid displacement (negative or at least half the
  runway) rejects that runway.
- Missing, closed or inconsistent runway data excludes only that runway. An
  airport with no valid runway stays a map pin and does not enter the index;
  `manifest.counts.exclusions` records each reason.
- A displaced threshold is projected from the physical end toward the opposite
  end using the computed true heading. Its elevation is linearly interpolated
  from the two end elevations; OurAirports does not publish threshold
  elevations.

## Datums and integration limits

Coordinates are WGS84. Elevations are converted from OurAirports feet MSL to
metres; the manifest records this as approximate orthometric height with no
geoid correction. Existing terrain datasets use EGM2008 orthometric metres, so
a consumer must reconcile local terrain and runway heights at the specific
airport rather than assuming the two sources share a vertical zero. The index
does not change the existing Incheon/Jeju approach geometry.

`src/geospatial/airportIndex.js` is the browser reader. Its default data URL
follows Vite's `import.meta.env.BASE_URL` (for example `/flight3d/data/airports/`
on GitHub Pages) and falls back to `/data/airports/` in Node.
`loadAirportManifest()` fetches only the manifest, `findAirportsInRegion()`
uses spherical bounds (including all longitudes when a search cap reaches a
pole) and filters by great-circle radius, and `findAirportByCode()` resolves
an official ICAO/IATA code through the manifest with one tile request. Source
`ident` values are not used as codes, so a local identifier cannot shadow
another airport's official code. Results are cached per base URL;
`clearAirportIndexCache()` resets them.

`matchAirportPin()` links a map pin to an indexed airport. A valid code on the
pin wins and a mismatched code does not fall back to names. Without a code, the
English or Korean name must normalize to the indexed name and the positions
must agree within 5 km. Multiple candidates remain unlinked, so an uncertain
match keeps the original map pin. Curated airport pins carry ICAO codes in
`src/config/landmarkPlaces.json`; streamed Overture pins pass through
`icao_code`/`iata_code` when the source provides them, otherwise they use
name-and-location matching.

## Verification

`npm run test:airports` runs the focused tests:

- builder tests cover CSV quoting, every exclusion rule, threshold geometry,
  and deterministic rebuilds after adding a new source row;
- reader tests cover regional tile selection, cache behaviour, code lookup,
  antimeridian/polar bounds and ambiguous pin matching;
- data tests verify the committed manifest against the frozen source hash,
  every tile's version/bounds, all runway ends and the curated pin linkage.

A production build and a hardware-accelerated Chrome flight are outside this
step: this index only supplies data and regional lookup.
