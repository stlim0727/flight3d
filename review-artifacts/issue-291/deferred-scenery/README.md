# Deferred scenery follow-up (#291)

Base: `c567313`. PR #293 already supplied offline cockpit UV binding, parallel
transport loading and the selected-aircraft gate. This follow-up moves Lukla
terrain/airport construction and its DEM/satellite requests to the first Lukla
selection. Subsequent selections reuse the same objects. The coastline's ship
GLBs load only after startup is ready and coastal scenery is selected. Stable
ship roots, manifest-derived fallback bounds, buoyancy and wake updates remain
available before the visual replacement; no flight or lighting equations change.

Production preview, Node 22.23.2, headless Windows Chrome, 1280×800, ANGLE/D3D11
Intel Arc 140V. HTTP cache disabled and saved selection cleared for every probe.
This differs from #293's Vulkan machine: do not compare its absolute timings.

| Repeated runway startup | Base | Change |
| --- | ---: | ---: |
| Overlay removed, run 1 | 2783.8 ms | 2841.4 ms |
| Overlay removed, run 2 | 2885.3 ms | 2929.0 ms |
| Maximum long task, run 1 | 809 ms | 796 ms |
| Maximum long task, run 2 | 806 ms | 1085 ms |

The four runs alternated base/change without concurrent tests/builds. They do
**not establish a startup speed improvement**. Browser/GPU shader caches were
warm, despite HTTP cache disabling. An earlier first browser run of the change
took 10.11 s (maximum task 3.58 s); these repeated figures are not a cold-GPU
benchmark or evidence that the issue's <1 s long-task target is universally met.
The verified result is removal of optional resource/geometry work from startup,
not a percentage speedup. Exterior compression and remaining synchronous scene
and GPU work are still follow-up work; #291 stays open.

## Acceptance

- `CHECK_SCENERY=1 AIRPORT=coastal`: no Lukla instance or DEM/satellite requests;
  all four ship GLB requests start after the overlay disappears. Final run:
  2821.9 ms ready, 804 ms maximum long task; bake ready with 100% coverage.
- `AIRPORT=neon`: no Lukla instance or requests and all five ship visuals remain
  deferred. `AIRPORT=lukla`: Lukla is constructed, and ship visuals remain deferred.
- The Lukla run holds the real DEM request through startup, asserts the demo is
  waiting, releases it, and asserts the DEM loads and the demo resumes.
- All three cases enter Hangang, select Lukla, return to the coast and select
  Lukla again: geometry visibility, object identity reuse and collision-terrain
  ownership pass with no runtime exceptions.
- `npm run test:cockpit`: 460 sampled frames, interior ready at 2521 ms, exterior
  first and no blind cockpit frames; both interior requests blocked in the second
  case, with explanatory toast and chase-camera recovery. Cockpit screenshot
  inspected for loaded geometry and live displays.
- `npm run check` and production build pass. `npm test`: 881/882 pass. The
  unchanged `incheonTerrain.test.js` frozen asset checksum case fails here and
  independently on the untouched base (5/6 of that file pass). No checksum or
  unrelated terrain asset is changed to suppress it. Remote Linux CI is separate.
- Focused ship/DEM tests: 10/10, including no requests before explicit asset
  activation, repeated activation without duplicates, stable collision roots,
  replacement, failure fallback and buoyancy.

Reproduction: [CI guide](../../../docs/development/ci.md). Machine-readable
resource and transition summaries are in `results.json`; full local traces and
screenshots are in `.cache/startup-291/`. Software rendering was not retested
for this follow-up (see #293's earlier SwiftShader evidence).
