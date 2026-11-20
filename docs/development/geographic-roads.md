# Streamed geographic roads (stage 1)

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
shown once any tile has geometry. No collision, traffic or night lighting is
added in this stage.

Verification: `node --test tests/geographicRoads.test.js`, `npm run check`, and
`scripts/measure-streamed-scenery.mjs` on the hardware GPU path described in
[browser-gpu.md](browser-gpu.md). Stage 1 added 9 road tiles and 2 draw calls on
the fixed Incheon low-altitude route; bridge/tunnel spans, night lights and
vegetation are later stages.
