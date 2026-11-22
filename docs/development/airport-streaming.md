# Streamed external airport landing (issue #922 step 2)

One index-backed destination (currently `RKSS`, Gimpo) can be mounted into the
persistent world during an Incheon-origin flight. No scene swap or new lobby
anchor is involved: the external airport is a dynamic region in `UnifiedWorld`.

## Data flow

1. `ExternalAirportStreamer` resolves the ICAO code through
   `src/geospatial/airportIndex.js` (manifest → one tile).
2. `createExternalAirportRegion()` derives ARP-relative runway descriptors from
   the indexed physical ends, thresholds, width and elevation. The same `runways`
   array feeds:
   - the rendered ribbon mesh (`createExternalAirportMesh`);
   - `ExternalAirportSurface.getHeight/getNormal` for wheel contact;
   - `isOnRunway` / `isRunwaySafetyArea` for physics and excursion handling.
3. `UnifiedWorld.registerDynamic()` places the group at
   `projectToLocal(airport.latitude, longitude)` in the Incheon world frame and
   rebases it on anchor changes. `unregister()` removes it completely.
4. `WorldAirportFacade` already iterates live `world.regions`, so an added or
   removed region reaches `airport.update()`, night lighting and render-light
   fan-out without rebuilding the facade or collision environment.

## Surface and datum rules

- Local coordinates are metres from the ARP, +x east and +z south; Y is
  OurAirports MSL metres. Existing terrain data uses EGM2008 orthometric
  metres, so no geoid conversion is attempted.
- On the pavement, and within 40 m of it, contact height is interpolated from
  the two physical end elevations. Between 40 m and 240 m it blends smoothly
  to the anchor's open-world terrain sample. When that sample is absent, the
  runway elevation is used instead; the runway never inherits an unrelated
  terrain offset.
- Rendered ribbons sit 15 mm above the contact surface. Displaced thresholds
  remain distinct from physical ends and only get a bar when displacement is
  nonzero.
- The external region owns no buildings, taxiways or special ground effects;
  its airport facade answers `false`/no-op for those queries.

## Readiness lifecycle

- The destination is not preloaded by `fly()`. `update()` loads it only when
  the aircraft is within the approach radius; a selected but distant airport
  stays a map/HUD destination until it is actually needed.
- `update()` runs each frame. It keeps the region mounted while the aircraft
  is on the ground or on a runway, unmounts it when airborne beyond the unload
  radius, and retries failed loads only after a cooldown. Faster flight expands
  the load radius (`speedMps * 500 m`).
- Changing the selected destination while the aircraft occupies a runway does
  not unmount the current region. The old region is retired only once `update()`
  sees the aircraft airborne, so contact height cannot change underneath it.
- A stale async completion is discarded after destination change, unload or
  disposal; it cannot mount an old airport over a newer selection.
- HUD destination text appends `PREP` while loading and `NO DATA` after a
  failure. `UnifiedWorld.destinationInfo()` reports the state through
  `dynamicStatus`; a failed load remains retryable on approach.
- The last known destination offset is retained after unload or a failed load,
  so guidance still points at the correct airport. A code with no known
  coordinates reports `target: 'unknown'` instead of the world origin, and the
  HUD/ND show only the code plus `PREP`.
- Open-world samples are converted from the Incheon world frame into the
  current anchor's local frame before sampling.

This is asset readiness, not physics behavior: no force, moment or control
model branches on the streaming state.

## Verification

- `tests/externalAirportSurface.test.js`: conversion, threshold separation,
  height interpolation/blending, predicates, mesh lift and disposal.
- `tests/externalAirportStreamer.test.js`: gating, stale requests, retry delay,
  ground hold, far unload, speed radius and status transitions.
- `tests/unifiedWorld.test.js`: dynamic registration, anchor rebasing,
  position-based dispatch, unregister and preparation status.

`npm run test:airport-landing` runs in hardware Vulkan Chrome: GPU preflight
passes, the index-backed region mounts with two runway ribbons, contact height
matches the indexed threshold, and the aircraft is supported, stopped on the
streamed runway, then rotated and climbed away with all gear airborne and a
positive climb rate. Rotation uses the same virtual elevator input path as the
touch/controller interfaces; CDP only starts the preset, injects commands and
reads state. Screenshots are in `.cache/airport-landing/`. Node tests do not
prove rendering or touchdown.
