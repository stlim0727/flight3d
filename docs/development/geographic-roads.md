# Streamed geographic roads and night lamps

`src/environment/GeographicRoads.js` streams major roads from the same pinned
Overture release as the other geographic layers:
`2026-11-18.0/transportation.pmtiles`, `segment` layer at zoom 13. Zoom 13 is
used because the four-region audit found major road classes there; zoom 14 is
dominated by footways, steps and service roads and is reserved for a closer pass.

Road centerlines are projected into the active airport's local frame, draped on
`terrain.getHeight` with a 0.35 m surface offset, and emitted as one ribbon mesh
per tile. Vertex colors distinguish road class. Selection is a 3×3 tile grid
around the aircraft and camera, disabled above 3500 m AGL, with a single
in-flight request, abort on selection change and a 5 s retry after failure.
The layer is disposed when the airport or terrain changes.

| Class | Default width (m) |
| --- | --- |
| motorway | 36 |
| trunk | 30 |
| primary | 22 |
| secondary | 16 |
| tertiary | 12 |

`width_rules` is present on effectively no z13/z14 features in the audited
Incheon, Seoul, Jeju and Busan tiles, so class defaults are the normal path; a
usable rule value between 2 and 100 m overrides the default. Features are
selected by `class`, not `subtype`, because many lower-zoom features have no
subtype. Bridges, tunnels, covered/indoor ways and level-separated segments are
excluded from the surface mesh until span handling exists. Water, runway safety
areas and modeled airport buildings are also excluded.

The layer is attribution-only when empty: `#geographic-roads-attribution` is
shown once any tile has geometry. No collision or traffic is added.

## Night lamps (stage 2)

Lamp bases are collected while building each road strip: paired positions on
both sides of the carriageway, offset by half the road width plus 1.2 m, spaced
30–48 m by road class. Positions are deduplicated by rounded local coordinate,
so neighboring tiles cannot double-place a lamp. Near lamps render as one
instanced pole/head mesh (max 1500); farther lamps render as one additive point
cloud (max 4000). Both are gated by the shared twilight curve and camera height;
the point cloud alpha ramps from 1.6 km to 3 km so the two representations
overlap instead of popping. Instance matrices are rebuilt only when the tile
set changes or the camera moves more than 75 m, keeping lamp positions stable
across tile load order.

Verification: `node --test tests/geographicRoads.test.js`,
`tests/geographicGreenSpace.test.js`, `npm run check`, and
`scripts/measure-streamed-scenery.mjs` on the hardware GPU path described in
[browser-gpu.md](browser-gpu.md). On the fixed Incheon low-altitude route stage
1 added 9 road tiles and 2 draw calls; stage 2 added 169 near instances, 1417
far points and 3 draw calls; stage 3 added 9 green tiles (8 with geometry) and
4 draw calls. Stage 4 changes rendering behavior without adding a draw call.

## Parks and green space (stage 3)

`src/environment/GeographicGreenSpace.js` reads `land_use` and `land_cover` from
the already-downloaded `base.pmtiles`. Green space uses its own z13 tile
selection because audited z11 parent tiles had no park polygons; selection,
abort and retry follow the road layer. Flat colored polygons are draped on the
flight surface and excluded when they intersect water, runway safety areas,
modeled airport buildings, streamed building colliders or the road sample index
exposed by `GeographicRoads.covers()`. Night lighting is not added to vegetation.

## Bridge and tunnel spans (stage 4)

Only whole-segment bridges are drawn. A `road_flags` or `level_rules` entry with
a `between` range refers to the original centerline, which is clipped
differently in each tile; applying it per tile moves the bridge. Mixed spans and
tunnels are therefore still omitted until an unclipped centerline source exists.
Whole-segment bridge decks are raised above the terrain maximum by a visual
clearance. Collision registration requires an absolute deck height from the
source; `base.infrastructure` bridge features carry only relative `level`, so
the current Overture release yields zero evidenced decks on the audited route.
`GeographicRoads.checkBridgeCollision()` is wired into `CollisionDetector` and
returns a hit only for decks with an evidenced height, so the current data
cannot produce a false bridge impact.
