# Landmark pins

Landmark pins are screen-space labels anchored to a point in the world. Places
are data, not code: the renderer has no special cases for individual stations,
towers or companies.

## Add a place

Append one row to `src/config/landmarkPlaces.json`:

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

`latitude` and `longitude` are WGS84; take them from a survey or an OSM/source
feature rather than guessing. The values above illustrate the shape, not a
surveyed position. `elevationM` is the label's MSL anchor (roof/peak/top); omit
it and the terrain height at the projected point is used. `names.ko` and
`names.en` are shown according to the active UI language, with English as the
fallback. `kinds` is an open-ended list of tags (`station`, `subway`, `attraction`,
`tower`, `peak`, `airport`, …). It filters candidates and selects the pin icon:
`station`/`subway`, `tower`, `peak`, `dam`, `airport`, `attraction` and
`corporate` have distinct icons; anything else gets a generic pin icon.
`importance` is an integer 1–5 (default 5): level 5 stays visible to 45 km,
then 36/27/18/9 km for 4/3/2/1. It changes range only, not label priority.

A subway station is the same shape with `kinds: ["station", "subway"]` and an
`elevationM` near ground level. No changes to `LandmarkPins.js` are needed.

## How selection works

1. `normalizeLandmarkPlaces()` validates each row, resolves names and drops
   unusable coordinates.
2. `landmarksForMap()` projects every row into the active scene's local metric
   frame: `projectToLocal()` for Incheon scenery, `wgs84ToLocal(..., JEJU_ORIGIN)`
   for Jeju. Synthetic maps (Neon, Lukla, Coastal, Valley) keep their local
   anchors because they are not WGS84 places.
3. Each frame `nearestLandmarks()` keeps places inside their importance-scaled
   range (45 km × level / 5), optionally filters by `kinds`, and sorts by true
   3D distance to the label.
4. `LandmarkPins` discards points behind/outside the view or closer than 200 m,
   places up to five pins (three on narrow viewports), and suppresses labels
   that would overlap. Each pin has a circular marker whose tip sits on the
   projected point, a category icon and a label with the localized name/range.

The catalog is rebuilt only when the map, terrain, airport or dataset changes;
selection and projection run every frame, so walking or flying toward a place
brings its pin in without reloading data.

## Supplying another dataset

Both the catalog and an optional category filter are constructor arguments:

```js
new LandmarkPins(document.getElementById('landmark-pins'), places, ['station']);
```

`places` has the same shape as `landmarkPlaces.json`, so an OSM query or an
application dataset can be converted once into `names`, WGS84 coordinates and
`kinds`, then passed through unchanged. The pure helpers are also exported from
`src/config/landmarks.js` (`normalizeLandmarkPlaces`, `nearestLandmarks`,
`landmarkName`, `landmarkRangeM`) and `src/ui/landmarkPinIcons.js`
(`landmarkPinIcon`) for maps or panels that need the same rules.

Verify with `node --test tests/landmarks.test.js tests/landmarkPins.test.js`.
