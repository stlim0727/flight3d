# F-16 Lukla valley pilot — implementation plan

## Mission and course

An airborne F-16 traverses the natural valley west of Lukla, approximately
5.7 km southbound. Start candidate: world (-1700, 500), 120 m above terrain,
220 KIAS and heading approximately 183°. Finish candidate: (-3100, 6000).
Intermediate gates follow the valley through (-1750,1400), (-2100,2200),
(-2450,3000), (-2550,3900), (-2850,4800). Coordinates are world X/east and
Z/south, in metres. The route avoids the locally graded runway and airport.
The finish is followed by roughly 1 km of relatively open valley, rather than
ending against a mountain wall. The course module freezes the final parameters.

The actual bundled Copernicus DEM determines terrain. Gate ground elevations
are approximately 2273,2166,2015,2047,2118,1886,1753 m MSL. A steep rising section
near z=3000–3450 requires anticipatory ascent; descent back toward low flight is
then beneficial. No terrain modification, teleportation, extra thrust or hidden
autopilot is permitted to make the example succeed.

This is a game-model challenge, not a real F-16 operating procedure. The source
DSM is sampled on a 42.97 m grid and does not establish surveyed obstacle
clearance. A low AGL score cannot validate real-world flight safety.

## Observation contract

Keep the existing 5 Hz SDK, 120 Hz physics and 24-tick reaction delay. Expose
no live position, velocity vector, quaternion, terrain callback or heightmap.

- Air-data/attitude instruments: IAS, TAS, pitch, roll, heading, radio altitude,
  vertical speed and noisy body-axis pitch/roll/yaw rates.
- Explicit navigation aid: noisy absolute bearing and range to the next fixed
  route gate, plus its discrete index. This is course-navigation equipment,
  not a visual estimate or a recommended steering/altitude command.
- Explicit virtual forward terrain range sensor: 12×7 body-relative point rays,
  azimuth ±60°, elevation -35°..25°, maximum 2,000 m. The nearest sampled
  surface occludes terrain behind it. Default uncertainty is 2 m + 3% of range,
  with seeded 1-second correlated errors.
- Each ray distinguishes a measured return, no return within range, and missing
  measurement. A clear point ray does not certify its entire angular sector.
  Twenty-metre marching and the underlying DEM can miss finer features.

Numeric measurements use the existing available/mean/std/sampleTick contract.
The flight algorithm must infer ascent/recovery from these observations. It
receives neither a future altitude profile nor an engine-computed avoidance
command. Static route and configuration briefing remains public.

## Evaluation

Complete ordered spatial gates within the corridor and time limit, without
collision, contact or modeled damage. Use a model-aware minimum clearance and
speed envelope. There is no upper AGL ceiling that forces an unsafe contour.
Ascent to negotiate terrain is valid; returning low improves the score.

Sample fixed course-progress bins once. For successful flights only, minimize
`0.7 * mean(max(0, AGL-target)) + 0.3 * P95(max(0, AGL-target))`. Initial target
is 50 m. Repeated flight/loitering over a bin cannot dilute its cost. Record
maximum/median AGL, minimum clearance, gate completion and duration separately.
Failure and incomplete data cannot earn a successful low-altitude score.

## Implementation and evidence

1. Replace exhaustive general-flight and pilot-case lists with dependent
   selectors showing one gameplay/code-link pair per selected case.
2. Freeze course geometry using the bundled DEM; implement pure mission rules.
3. Implement bounded terrain observations and the F-16 simulator adapter.
4. Implement an SDK-only terrain-aware pilot; calibrate with production physics.
5. Add calm and seeded mild-wind/noisy cases, source links, and a rendererless
   sweep report. Verify the isolated runtime as well as synchronous calibration.

Acceptance uses rendererless production physics, as requested: no second
physics engine and no GPU requirement. Preserve existing B738 takeoff/landing
tests and ordinary flight behavior. Report incomplete/failed cases honestly;
do not loosen the course after observing a failed controller. Browser visual
acceptance is separate from numerical flight validation.
