# Paris low-altitude showcase (#1014)

A bounded verification zone for the Seine riverbank, Pont d'Iéna, Champ de Mars
and a dedicated 3D Eiffel Tower. It activates when a map start uses a custom
origin within 25 km of the tower; no new airport or built-in map is required.

## Pieces

- `src/config/parisShowcase.js` — WGS84 anchors, the low-altitude route and a
  declarative z13/z14 imagery inset around the tower and bridge. The inset is
  handed to the existing `OpenWorldTerrain` screen-error/detail scheduler;
  z11 tiles stay on screen while detail loads.
- `src/config/mapFlightPlaces.js` — the `paris-eiffel` default cruise bookmark
  starts at the downstream end of the route above the Seine; its distance from
  Korea produces the custom origin that activates the showcase.
- `src/environment/ParisShowcase.js` — lazily fetches
  `public/models/landmarks/eiffel-tower.glb`, seats it on `terrain.getHeight()`
  for both rendering and collision, and adds the bridge deck and two quay
  steps from the same streamed ground samples. The tower uses `THREE.LOD`
  (0/800/2200 m, hysteresis 0.1) with near, mid and far variants in one GLB.
- `src/physics/CollisionDetector.js` — checks the showcase envelopes alongside
  streamed buildings and roads. Tower legs and upper structure are separate
  solids, so the open arch below ~30 m has no phantom collision.
- `src/environment/GeographicBuildings.js` — suppresses the generic Overture
  building under the tower footprint once the GLB is ready and the streamed
  building layer is rebuilt.
- `src/config/landmarkPlaces.json` — an Eiffel Tower pin anchored at 365 m
  (~35 m ground + 330 m structure) with Wikidata `Q243` so it deduplicates with
  the automatic Overture landmark.

Regenerate the GLB with `npm run build:eiffel`. The generator
(`scripts/build-eiffel-assets.mjs`) asserts a 330 m silhouette and three named
LOD groups before writing the asset.

## Data provenance and limits

Tower (48.858222, 2.294500), bridge (48.85972, 2.29222) and Champ de Mars
(48.855805, 2.298377) coordinates come from Wikipedia. Ground elevation and
imagery come from the existing open Terrarium DEM and Esri tile streams; the
quay steps and bridge are local parametric geometry seated on those samples.

IGN LiDAR HD is still a candidate for a higher-resolution ground source. Its
point clouds are not bundled here: tile volume and redistribution conditions
must be reviewed before shipping, and a local DEM would also need a stitched
edge into the streamed tiles. Frames at p95 and model/tile LOD transition
smoothness on hardware-GPU Chrome still need a before/after capture; unit tests
cover placement, exclusion, arch openness and GLB contents only.

## Verification

```sh
node --test tests/parisShowcase.test.js
npm run check
npm run build
```
