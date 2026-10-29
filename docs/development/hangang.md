# Hangang low-flight scenario

Related: #253 (scenario), #267 (detailed bridge assets).

The lobby offers **Han River** alongside the airports under **Flight region**.
Only this region offers **Han River bridge challenge**; existing airports do not.
Selecting it previews its dedicated scenery and locks C172/daylight settings.
The saved region restores on reload. Internal `airport` fields/storage keys are
retained for compatibility but also identify this non-airport region.
It starts a C172 in trimmed flight at 19 m above water, 46 m/s, in daylight and
calm wind. The dedicated scenery replaces the selected airport for the run;
leaving the scenario restores the previous environment. Retry clears progress,
contacts and crash camera shake. The normal aircraft controls remain active.
Autopilot disengages while the challenge is active.

## Course and scoring

`src/config/hangangCourse.js` defines an ordered array of three bridges with
different positions, rotations and silhouettes. The course follows a gently
curved river. Additional bridges require course data and route validation; the
internal progress total derives from the array.

- Keep reference-point height between 10 and 28 m, vertical speed within
  ±3 m/s, and speed between 35 and 58 m/s (about 68–113 kt).
- Bank allowance is 12° within 180 m of the current opening and during final
  recovery; connecting turns allow 30°. Level flight does **not** mean zero pitch.
- An excursion warns immediately and fails after eight continuous seconds.
  Returning inside the envelope resets that timer.
- Enter the designated central opening from the front. The whole aircraft must
  clear the exit before progress increments. Bypasses, skipped bridges and
  reverse flight fail; passing one bridge cannot count again.
- After the last bridge, maintain the envelope for four continuous seconds and
  reach at least 220 m beyond its plane. Contact fails immediately. The run has
  a 240 s limit and a 440 m lateral river corridor.

The scenario uses the common flight HUD and controls. It does not add a bridge
counter, phase/guidance panel, maintenance/clearance report or retry button.
Use **Esc → Scenario restart** to restart normal flight; after a crash use the
common report and **Space / R / Enter → main menu → Fly**. Menu selection retains
the Han River region. The internal run still records course progress, envelope
and clearance data for validation; removing its presentation does not change
physical collision detection or the flight model.

## Physics and geometry contracts

Coordinates are metres, +Y up; progression is generally -Z. Bridge-local X
spans the river. Height is `h = y_aircraft - y_water`. The existing aerodynamic,
engine, mass/CG, trim and fixed-step integration models provide flight behavior;
the mission adds scoring and collision detection, not corrective forces.
The bridge deck is not inserted into the terrain heightmap. Water/ground height
therefore continues to supply the ground-effect and radio-altimeter reference.

`bridgeSolids()` supplies both rendered deck/pier/girder/rail geometry and solid
collision boxes. `HangangRun` transforms C172 part bounds using
`inverse(M_bridge) * M_aircraft`. Fuselage, wings, tail, fin and fixed gear have
separate conservative bounds. Between physics samples, translation is sampled
at <=0.2 m and quaternion rotation at <=0.015 radians with 0.15 m padding. This
reduces tunneling through thin members; it is an approximation, not exact swept
mesh collision. Malformed or excessively discontinuous samples cannot pass.

The riverbanks use sampled BufferGeometry ribbons and the skyline uses one
InstancedMesh with 160 buildings. Scenery is cached and reused on retries.
Above-deck arch decorations and buildings outside the allowed river corridor
are visual approximations without detailed collision proxies. They are not
part of a valid underpass; #267 owns detailed asset/collision contracts.

## Provenance and limits

All scenery here is original procedural geometry under the repository license.
No external bridge models, textures or map data are bundled. The UI explicitly
labels this as **Han River inspired training scenery**, not a survey-accurate
reproduction of named Seoul bridges. Dimensions are designed for the playable
course. Surveyed placement, detailed GLB/PBR assets, LOD, asset fallback and
performance budgets remain in #267; this scenario does not complete that issue.

## Verification

Node 22.23.2: `npm run check`, `npm test`, `npm run build`.
Focused mission coverage: `node --test tests/hangang.test.js`.
The full suite passed 798 tests. In this Windows checkout, Incheon JSON fixture
line endings were restored to the canonical LF bytes matching their manifest
hashes; CRLF checkout bytes fail the existing checksum test on the base too.
There is no semantic Incheon scenery change in this feature.

Start Vite on port 5197, then run `node scripts/verify-hangang.mjs`.
`SIM_URL`, `CHROME_PATH`, `CDP_PORT` and `ARTIFACT_DIR` are optional overrides.
The browser harness selects the real lobby button and flies the actual C172
physics with ordinary virtual control inputs from a test pilot. It does not
teleport the aircraft through gates or override forces. The gameplay itself
requires manual flight; the test pilot is only in the verification script.

Evidence is in `review-artifacts/hangang/`. Checks cover the three-bridge run,
water impact, common pause/restart and crash-to-menu recovery, autopilot exclusion,
absence of a dedicated challenge HUD, and environment restore.
Desktop/cockpit/mobile screenshots check framing. Mobile is a viewport check,
not proof of touch handling on a physical phone. Automated piloting demonstrates
feasibility, not human difficulty balance or a real-time FPS benchmark.

### Common HUD verification (#290)

`review-artifacts/hangang-common-ux/` records the panel removal on Node 22.23.2.
Syntax/action checks and the production build passed. All 882 Node tests passed
with the canonical LF checkout bytes for the existing Incheon checksum fixtures;
the untouched Windows main checkout reproduced that CRLF checksum failure first.
No Incheon data change belongs to this PR.

The browser harness completed all three bridges using ordinary control inputs,
then verified pause-menu restart, water impact, Space-to-menu recovery, Fly,
environment restoration and saved-region reload with zero runtime exceptions.
The desktop, cockpit, mobile and crash captures show the common HUD without a
scenario status/score/retry panel. Mobile evidence is viewport-only.
