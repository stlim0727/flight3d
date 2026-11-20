# Coastal airport exterior kit (issue #13)

The coastal airport loads `public/models/airport/airport-kit.glb`. Airport
buildings are attached only after the validated kit loads; a failed load is an
error, not a signal to draw procedural substitutes. One cached request supplies
shared geometry and materials to coastal airport buildings; Lukla is independent.

## Selection and provenance

Selected candidate: an original, exterior-only Flight3d kit, authored for this
issue. Fab and CGTrader were candidate marketplaces, not required products.
No purchase, third-party model, downloaded texture or restricted source file is
needed. The editable source is
[scripts/build-airport-assets.mjs](../../scripts/build-airport-assets.mjs), authored
by Flight3d contributors. Original source URL:
https://github.com/yt7good/flight3d/blob/codex/issue-13-airport-modules/scripts/build-airport-assets.mjs
(the same path on main after merge). The generator and generated GLB are covered
by [the kit's MIT license](../../public/models/airport/LICENSE.txt), permitting
repository redistribution, modifications and browser delivery. This license is
limited to these original assets/source, not the rest of the repository.

Regenerate with the repository's Node 22.23.2 and installed lockfile dependencies:

```sh
node scripts/build-airport-assets.mjs
node --test tests/airportBuildings.test.js
```

The kit contains no cabin furniture, rooms, interior equipment, image textures,
external buffers, compression decoder or nonstandard glTF extension. Exterior
glass is opaque PBR to avoid transparent facade sorting/overdraw. Static parts
are batched by four shared materials. There are near/far modules for the tower,
50 m terminal bay, bridge and hangar. Seven terminal bays, four bridges and two
hangars clone shared geometry/materials. Near modules add mullions, cladding
bands, rooftop equipment, door panels and bridge undercarriages.

`Radar` and `Beacon` are independent named nodes outside the tower's LOD shell.
The radar retains 1.8 rad/s animation; the beacon anchor retains its 83 m mast
height and animated PointLight. A visible red lens is attached independently.
Tower LOD changes at 1500 m and other modules at 800 m, with 10% hysteresis.
There is no interior camera mode or bridge collision system introduced here.

## Placement and collision contract

Coordinates remain in meters, Y-up, with airport elevation 12 m. Tower position
is (120,12,280), terminal (-80,12,340), and bridge X offsets are -120,-40,40,120
with Z offset -46. The terminal facade, roof and equipment fit the existing
350 x 22 x 70 m envelope (mullions extend at most 0.175 m at the facade). The
tower fits its radius 11.5 m, height 85 m collision cylinder, including its mast
and lens. Hangars fit the 90 x 35 x 70 m AABBs at (-450,12,310) and (-580,12,310).

Previously, hangar world positions inherited the terminal's translation, placing
them at (-530,12,650) and (-660,12,650), inconsistent with collision metadata.
Loaded models use the metadata positions. This is the
intentional placement correction; runway/taxiway/apron geometry is unchanged.
All new structures remain clear of the runway and parallel taxiway.

The existing coastal tower camera remains at (120,78,280), inside the
cab. Node raycasting checks its westward sightline; browser evidence also looks
toward the runway threshold from that exact position. Mullions are offset from
the cardinal axes to keep this sightline clear. Bounds tests use the actual GLB,
not only the source generator's intended dimensions.

## Reproduce browser evidence

Start `npm run dev -- --host 127.0.0.1`, then run:

```sh
node scripts/verify-airport-buildings.mjs
```

On Windows set `CHROME_PATH` to the installed `chrome.exe`. `SIM_URL`, `CDP_PORT`,
`ARTIFACT_DIR` and `BASELINE_REF` can override defaults. The script extracts
Airport.js from baseline `f46c426` into ignored `.tmp/airport-assets`, loads the
real GLB over HTTP, and captures identical 1440 x 1000 daylight scenes at six
fixed camera poses. Radar rotation and beacon intensity are fixed. It checks
near/distant LOD selection and blocks the actual model URL after reloading to
verify failure recovery. A missing model or incomplete capture cannot pass.

The scene contains the complete airport and a plain ground plane, with fixed
hemisphere/directional lighting. It excludes aircraft, ocean, sky, simulation,
postprocessing and shadow maps. Frame samples use `renderer.render` plus
`gl.finish` after five warmup renders, with 20 samples per pose. These are
isolated render wall times, not full-flight FPS or GPU timer-query results.
Texture memory is an RGBA8 + generated mipmap estimate deduplicated per airport;
it is not driver-reported VRAM. The kit itself has zero texture memory.

Committed screenshots and the raw measurements are in
[review-artifacts/airport-buildings](../../review-artifacts/airport-buildings/).
See that directory's README for the measured costs, scope and budget.
