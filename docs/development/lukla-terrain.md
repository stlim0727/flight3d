# Lukla terrain provenance and accuracy

The surrounding terrain uses the public Copernicus GLO-30 **surface** model
(including vegetation/buildings), not a surveyed bare-earth model. There are no
procedural mountain walls, departure trenches, or invented Himalayan ridges.
The temporary pre-load fallback is explicitly unloaded and flat.

## Rebuild

Use Python with `rasterio==1.5.2`, `numpy==2.5.4`, and `Pillow==13.0.0`, then run:

```sh
python -m pip install -r scripts/terrain/requirements.txt
python scripts/terrain/build-lukla.py
```

Downloads are cached in `.cache/terrain`. The builder verifies the source DEM
SHA-256 and records its URL, output checksum, projection, imagery tile checksums,
and independent source checkpoints in `public/terrain/lukla_metadata.json`.
Imagery tiles can change upstream; preserve the cache for byte-identical imagery.
Normal application builds/tests do not need Python or network access.

## Coordinates and resolution

Origin: 27.6868342 N, 86.7294519 E, the midpoint of endpoints of
[OSM runway way 1257098603](https://www.openstreetmap.org/way/1257098603), retrieved
2026-10-19 (endpoint nodes 11687310127 and 11687310128). This is a public-map
alignment reference, **not surveyed threshold coordinates**. The previous origin
27.6878 N, 86.7314 E was near the northeast end rather than the runway midpoint.


The unified world places the Lukla region at `projectToLocal(27.6868342,
86.7294519)` in the Incheon scenery frame. It is no longer staged 260 km south
of Jeju; destination guidance therefore uses the real WGS84 threshold.
Both assets are reprojected to a WGS84 azimuthal equidistant grid centered there.
World X is east; world Z is south. DEM rows run north to south. The 44 km square
contains 1025 × 1025 Float32 little-endian samples at 42.96875 m spacing; the source
is one arc second (nominal 30 m). The main render mesh remains about 86 m, with a
10 m local airport mesh. That local tessellation adds no new measured detail.
The simulator streams Esri World Imagery both over the bundled DEM and beyond
its edge. The local terrain and runway terrace retain their geometry and use
the same tile coordinates and imagery detail selection as the surrounding world.
Streamed elevations blend from the local edge to the regional elevation tiles.

## Deliberate approximations

Runway dimensions, heading 058°, 11.76% slope, and 2805–2867 m threshold heights
remain the existing **simulator airport model**, not newly verified survey data.
The new DSM is roughly 20 m below that model near the runway. We do not shift the
regional DEM to hide this difference: only the runway/apron footprint is graded
and smoothly blended to the source within 50 m longitudinally / 30 m laterally
(apron: 20 m). Outside that footprint `getHeight` equals `getNaturalHeight`.
Airport buildings, runway structures, and published airport altitude should be
reconciled against a surveyed airport model separately; this change establishes
traceable regional terrain rather than claiming exact airport reconstruction.

PR #41's render-only recess beneath the asphalt is retained. Collision/gear use
the graded analytical surface. The coarse mesh is lowered under the local mesh
to avoid overlapping surfaces; that is rendering accommodation, not DEM data.

The autonomous circuit is an entertainment scenario, not a real approach route.
Verify it against measured terrain rather than cutting terrain to fit its route.
Check hardware GPU renderer identity, loaded DEM state, approach/overhead/rollout
captures, camera motion, and physics clearance. The historical benchmark's exit
code alone is insufficient: its stage-5 completion predicate misses idle -1.

## Sources and attribution

- [Copernicus public COG source and layout](https://copernicus-dem-30m.s3.amazonaws.com/readme.html)
- [Copernicus product specifications and licence notices](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- [Esri World Imagery service](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)
- [OpenStreetMap copyright / ODbL](https://www.openstreetmap.org/copyright)

produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence
and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA;
all rights reserved

Runway alignment: © OpenStreetMap contributors. Imagery: Esri and its World
Imagery contributors; attribution is available from the linked service.

## Near-surface rendering

The satellite imagery retains its georeferenced UVs. `createRasterSurfaceMaterial()`
in `RasterRegionSurface.js` adds distance-faded, metre-scale procedural color variation and surface-gradient
bump shading. Steep slopes receive stronger rock strata; gentler slopes retain
a grass tint. Three-dimensional local-metre sampling avoids stretched detail on
cliffs and seams between the regional and airport terrace meshes. This detail
is an artistic surface treatment, not additional surveyed geometry: DEM heights,
collision queries, airport grading and mesh density are unchanged. The detail
fades between 250 and 2200 metres to retain the distant satellite appearance.
