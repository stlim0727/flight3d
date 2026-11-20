# City buildings (issue #11)

## North hillside district (issue #207)

[`NorthCityDistrict.js`](../../src/environment/NorthCityDistrict.js) replaces the
north random cluster with a deterministic, terrain-screened neighborhood. The
50 m survey around (-800, -2800), radius 1,000 m, found heights -45 to 396 m,
median analytical gradient magnitude 0.467 (25 degrees), and median rendered vs
analytical height error 1.19 m (p95 5.37 m). Consequently, the former 180 placement
attempts are an upper bound, not a building-count target. The current actual
22,000 m / 256-segment terrain admits 13 buildings on the largest connected
street component. East and south building records retain the original random
sequence and are compared exactly with the post-#211 baseline.

World units are meters, +Y is up, north is negative Z. The central finite-difference
gradient uses a 2 m offset on each side. A contour tangent defines the rotated
street grid; each candidate is then checked over its whole width at at most 4 m
spacing, at the center, and at intersections with rendered terrain triangles.
The analytical gradient and exact rendered triangle-plane gradients both count
toward the limits. Roads include their junction/end squares in these checks.

The design limits are 18% longitudinal grade, 30% cross slope, lot gradient
magnitude 0.32, 6 m maximum plinth height including the two 5 cm margins, minimum
5 m elevation on both surfaces, and 2.5 m maximum surface disagreement. These
are simulator placement limits selected after the survey, not civil-engineering
standards. Full footprints avoid the airport and extended approach corridor.
Water and extreme terrain are excluded rather than filled. The 48 m grid,
8 m roads, 18 x 18 m lots and 18–48 m buildings produce a smaller, predominantly
residential mountain neighborhood. Invalid links are removed, only the largest
connected component remains, and lots must have street access and clear all
other roads/lots. Shared square junctions and square dead-end caps avoid
overlapping pavement interiors. Tree exclusion includes crown radii and a 2 m
margin; it happens after consuming the old random sequence.

[`CitySurface.js`](../../src/environment/CitySurface.js) clips each north road
polygon at **every rendered terrain triangle edge**, then lifts it 0.12 m. This
keeps triangle interiors, not just vertices, against the ground. Roads are visual
overlays, not new driveable contact surfaces. No terrain height, normal-query,
landing-gear, force or integration model is changed. Existing analytical/render
surface disagreement is bounded for placement, not globally corrected.

Each horizontal building starts above the maximum of both sampled surfaces; a
solid box plinth extends below their minimum and acts as the exposed retaining
wall. No detached retaining wall is introduced. Near facade+plinth and far box
share one collision envelope. A world AABB indexes broadphase cells and the
local rotated footprint rejects empty AABB corners. The GLB kit supplies the
district's near geometry; procedural archetypes and day/night materials still
serve the other clusters. Foundation capacity now includes all accepted north lots.

Run `node --test tests/northCityDistrict.test.js tests/cityBuildings.test.js
tests/foliage.test.js tests/collision.test.js` and see
[north evidence and reproduction](../../review-artifacts/north-city/README.md)
for paired screenshots, browser sequences and measured performance. Screenshots
and a city-only timing harness do not substitute for full-flight acceptance.

## Assets and placement

The selected building kit is original to Flight3d: three modular silhouettes
(stepped office tower, residential block and commercial block) and a 2 x 2
facade/window/rooftop atlas generated at runtime by
[`CityBuildingAssets.js`](../../src/environment/CityBuildingAssets.js). Source URL:
https://github.com/yt7good/flight3d/blob/codex/issue-11-city-buildings/src/environment/CityBuildingAssets.js.
Creator: Flight3d contributors, 2026. License: [MIT for these original
assets](../../src/environment/CITY_ASSETS_LICENSE.txt). The source and generated
art can be included in this repository and distributed by the web build. Fab,
ambientCG and Poly Haven were considered in the issue, but no third-party item
was purchased or downloaded. The earlier single plain box is replaced by three
procedural geometries; no external texture request is made.

Buildings retain the three existing city clusters and original size formula.
Their positions and colors are generated with the same random sequence; the
review's fixed seed places 539 baseline and 537 current buildings. The two
removed footprints crossed the runway exclusion boundary even though their
centers did not. The remaining 537 centers match the baseline exactly.

Each archetype uses one near and one far `InstancedMesh`. Near meshes use the
atlas for facade, window and rooftop panels; distant meshes are plain boxes.
LOD selects near instances within 1800 m of the camera and updates when the
camera moves at least 80 m. A shared emissive mask lights a bounded subset of
windows; intensity reaches zero at midday and at most 0.75 at night. The demo
director and manual time controls both update it. No bloom or point lights are
created for individual windows.

`buildingData` records the rotated world AABB width/depth, base elevation and
full height. The near and far meshes stay inside the same envelope; the
collision grid and aircraft probe checks use that AABB. Unit tests cover the
actual geometry bounds, airport exclusion, LOD totals and a rotated footprint.

## Reproduce visual and performance evidence

From the repository root, start `npm run dev -- --host 127.0.0.1` and run:

```sh
node scripts/verify-city-buildings.mjs
node --test tests/cityBuildings.test.js tests/collision.test.js
```

The browser script compares commit `28559fc` with the current code at the same
1440 x 900 resolution, seeded building positions, camera poses and noon/23:00
lighting. Only the baseline's random calls are routed through an injected seed;
its geometry and materials are unchanged. The isolated scene uses flat ground
and excludes trees from rendering so city cost is measurable. It asserts that
all current centers existed in the baseline. Eight screenshots and raw metrics
are in [review-artifacts/city-buildings](../../review-artifacts/city-buildings/).

Host: Intel N95, headless Chrome 154, ANGLE Vulkan SwiftShader. Draw calls
include the ground plane. Frame samples are wall times for isolated rendering
plus `gl.finish`, after five warmups, with 20 samples per pose. They are not
full-flight frame rates or GPU timer-query measurements.

| View | Buildings | Calls before → after | Triangles before → after | Median ms before → after |
| --- | ---: | ---: | ---: | ---: |
| East near, noon | 539 → 537 | 2 → 7 | 6,470 → 8,414 | 0.3 → 0.3 |
| East skyline, noon | 539 → 537 | 2 → 4 | 6,470 → 6,446 | 0.2 → 0.4 |
| North near, noon | 539 → 537 | 2 → 7 | 6,470 → 8,174 | 0.2 → 0.2 |
| East near, 23:00 | 539 → 537 | 2 → 7 | 6,470 → 8,414 | 0.2 → 0.2 |

Texture storage rises from zero to an estimated 699,051 bytes for two 256 x
256 RGBA8 atlases including mipmaps. This is a CPU-side format estimate, not
measured VRAM. The atlases have **zero separate network transfer bytes** because
they are generated from code. The production JavaScript bundle at the same
lockfile grows from 1,124,392 to 1,130,976 bytes, or from 295,877 to 297,823
bytes with gzip. These are local build sizes, not live CDN transfer statistics.
The browser results include the individual median and p95 samples for all poses.

The existing browser crash suite reached and passed its city skyscraper impact
scenario with the new buildings. The suite's subsequent quick-restart check
stalled in headless Chrome and was stopped; no full-suite pass is claimed.

## Low-pass detail update

The near archetypes now include podiums, stepped upper volumes, corner fins or
end piers, roof parapets and rooftop plant. All parts remain within the original
normalized footprint and height, preserving placement and collision envelopes.
The far box geometry and 1,800 m LOD policy are unchanged.

The near material derives facade UVs from each instance's physical dimensions.
The existing atlas repeats at approximately 3.75 m per bay and 3 m per floor,
so tall buildings gain floors instead of stretching five windows over their
whole height. Daytime color and nighttime emission use the same mapping;
horizontal roof faces keep their original atlas UVs. One material and the same
instanced batches are retained.

GLB was not required for this update: changing the container would not correct
stretched facades, and the existing modular geometry already supports shared
materials, instancing and LOD. A unique landmark needing a hand-authored
silhouette/interior would be a separate reason to introduce a GLB asset.

For a current-main comparison, run Vite on 5187 and reuse project Chrome:

```sh
chrome-session --project flight3d node scripts/verify-city-lowpass.mjs
```

`APP_URL`, `BASELINE_REF` and `ARTIFACT_DIR` override the server, baseline and
output directory. The harness owns one tab and compares seeded city placement,
shader compilation, draw calls and far-LOD triangles across five paired views.
See [low-pass evidence](../../review-artifacts/city-lowpass/README.md).
## GLB district pilot (2026-10)

The airport logistics/business cluster now uses 110 fixed lots in an 11 × 10
street grid centered at (900, 950), with 60 m lot spacing and 12 m roads.
The east and north clusters retain their existing procedural assets and placement.
Trees are removed from the district after seeded placement so other clusters keep
the same random sequence. The northern hillside extension is tracked in
[issue #207](https://github.com/stlim0727/flight3d/issues/207).

`public/models/city/district-kit.glb` is an original MIT exterior kit (149,668 bytes),
reproducible with `node scripts/build-city-assets.mjs`. It contains three normalized
building meshes with window panes, floor bands/balconies, roof equipment and entry
canopies, baked offline rather than assembled at application startup. It is not a
third-party photogrammetry asset. Vertex colors and a shared two-pixel emissive
mask keep each near archetype to one instanced draw. A future artist-authored kit
can replace these meshes while retaining their names and unit collision envelope.

The district's near geometry comes from the GLB kit; a failed load surfaces an
error and leaves those near meshes absent. Time-of-day state is reapplied after
loading. Far boxes and collision metadata exist before loading.
Nine terrain samples per lot define the building base and foundation depth;
near foundations and far boxes cover the same conservative collision AABB. Roads
sample the rendered terrain triangles, not just the finer analytical height
function, to avoid sinking into the coarse terrain mesh. They are visual overlays;
the ground-contact surface remains `getHeight`. This pilot has no road traffic,
sidewalk network or surveyed urban data.

Verification:

```sh
node --test tests/cityBuildings.test.js tests/foliage.test.js tests/collision.test.js
npm run dev -- --host 127.0.0.1 --port 5186
ARTIFACT_DIR=review-artifacts/city-district chrome-session --project flight3d node scripts/verify-city-district.mjs
```

The browser comparison uses pre-pilot revision `2542473`, actual coastal terrain,
fixed random seeds, identical low/high and day/night poses, and the shared project
Chrome daemon. It checks GLB loading, LOD totals, render errors and blocked-asset
behavior (no fallback district geometry). Results are isolated city rendering, not full-flight FPS. See
[city district evidence](../../review-artifacts/city-district/README.md).
