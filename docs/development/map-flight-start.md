# Map-based flight start (issue #922 step 3)

The lobby now has an optional **map flight plan** section. It uses the committed
OurAirports index for Korean airports and the existing regional cruise points,
so detailed airports and index-generated airports are chosen through one flow.
Departure stays optional: leaving it blank keeps the existing region/scene
anchor behaviour.

## Selection and resolution

- `#lobby-map-state` chooses `none`, `runway`, `cruise` or `approach`.
- `#lobby-map-airport` lists index-backed airports with validated runways.
- `#lobby-map-runway` lists each runway end of the selected airport; the value
  is `${runwayId}:${endId}` and the label shows the end ident and heading.
- `#lobby-map-point` lists `REGIONAL_CRUISES` places for cruise starts.
- `#lobby-map-departure` is optional and does not change the scene anchor.

`loadMapFlightPlaces()` reads a regional tile set from the airport index and
filters Korean airports; cruise points come from `REGIONAL_CRUISES`. No
per-airport coordinates are hand-authored in the UI.

`resolveLobbyMapPlan()` freezes the choice into the start request before async
preparation. It calls `resolveMapFlightPlan()` with the selected airport,
runway end or cruise point, the airport's Incheon-frame `baseOffset` and the
active anchor base. The pure planner returns `{scenario, spawn, airportCode}`
with world coordinates, velocity and Three.js yaw. Any four-letter ICAO code
from the index can be streamed; the map catalog is not limited to RKSS.

## Start states

- **runway**: threshold + 100 m along the runway, elevation + the aircraft's
  resting gear height (`AIRCRAFT_REGISTRY`), stationary, gear down, flaps 2,
  parking brake set.
- **cruise**: above the selected WGS84 map point at its configured altitude,
  with the configured heading and aircraft-specific cruise speed.
- **approach**: 3 NM before the selected threshold, aligned to the physical
  runway end, 3° glideslope, gear down and flaps 5.

`setPreset()` still owns aircraft configuration and trim; `applyMapSpawn()`
then installs the resolved pose and configuration. Runway/approach starts wait,
under the start hold, for `airportStreamer.ensure()` to reach `ready` before
physics resumes. Gyro permission restoration happens in `prepare()` within the
original click gesture, before any streaming wait. Selecting a normal preset or
region clears the map plan so a stale map spawn cannot overwrite it.

Non-map presets, missions, demos, saved URLs and lobby buttons keep their
existing paths because the map plan is null unless the user selects one.

## Verification

- `tests/mapFlightPlan.test.js`: pure heading/runway geometry, three spawn
  states, anchor rebasing and input immutability.
- `tests/scenarioStartCoordinator.test.js`: a map plan is captured before
  installation and its spawn is applied after `setPreset`.
- `npm run test:map-flight`: hardware Vulkan Chrome GPU preflight, then all
  three start states from the real lobby controls with departure left blank;
  runway/approach also wait for the external airport region to stream in.
