# Opt-in arena wind and straight-flight audit

Discussion [#356](https://github.com/stlim0727/flight3d/discussions/356), plan v6,
requires physical disturbances separately from noisy observations. This change
adds only the wind foundation; it does not calibrate or claim completed missions.

## Unified wind field (#680)

This section supersedes historical center-only sampling and measured flight ranges
below. All active fields now sample the center and both half-wing centroids.
Light, mild and Incheon receive rolling moments from their existing spatial
gradients; Moderate/Strong retain their extra short cross-track vertical modes.
Profile amplitudes, seeds and scales remain unchanged (roundoff aside).
Trajectories of formerly center-only profiles intentionally change.

```js
setSimulationWind(sim, new WindField({
  profile: 'strong-turbulence-v1', // defaults, independently overridable below
  seed: 'weather-1', runwayHeadingDeg: 63,
  mean: [0, 9.5, 0], // along/right/up m/s; overrides signed profile crosswind
  gust: [1.8, 3.6, 1.2], wingGust: 1.6,
  spatialScale: 1, // positive wavelength multiplier
  timeScale: 1, // positive temporal frequency multiplier
  region: { center: { x: 0, y: 750, z: 0 }, radius: 1000, fade: 200 },
}));
```

The model is `wind(x,t) = mean + weight(x) * disturbance(x,t)`.
Omit region for a global field. The optional world-space sphere has full strength
through `radius - fade`; its shell uses `s = clamp((radius-distance)/fade,0,1)`
and `weight = s*s*(3-2*s)`. Both disturbance and its boundary slope fade to zero.
Background mean persists outside. Center, radius and fade use meters.
Each wing evaluates its own weight, including when the center is outside.
This training envelope is not a divergence-free fluid solver or atmospheric
spectrum. Region placement UI and overlapping regions remain future work.

The 120 Hz clock advances once after three samples. The physical quaternion
transforms body offsets (+/- wingspan/4,0,0) into world positions. Render pose
interpolation does not enter physics. Uniform mean wind produces zero additional
gradient moment. Relative-airflow and two-panel lift/moment equations are unchanged.

Node 22.23.2 focused wind, wing, turbulence, preset-reset and Incheon tests pass
(46 tests), including every aircraft/strength for 60 seconds, restart, reset,
frame grouping, scales and region exit/reentry. Check and build pass. Comparing
all six profile fields against the base at five headings and 240 time/position
samples each gives maximum component difference 3.56e-15 m/s.
Historical browser evidence below was not remeasured for this revision and does
not establish current browser acceptance.


## Neon urban wind acceptance (#697)

Integrated checks of #694-#696 on origin/main 00b6d10; the final full
`verify-neon-urban-wind.mjs` run was repeated on 90a8be2 (later commits touch only
`src/weapons`). No physics, wind or preset code changed; this section adds two
measurement scripts and records what they found.

- `node scripts/neon-urban-wind-report.mjs [out.json]`: headless, production physics at
  120 Hz. Fixed-point wind statistics for north and south wind, and C172/B738/F16 paths
  (canyon line, 60 s cruise held and hands off, C172 bridge) each repeated in still air
  as the control. The control is the authored spawn with no field, as a multiplayer room
  flies it. Also a 4 s hands-off upset in the slot and the lee, then recovery.
- `node scripts/verify-neon-urban-wind.mjs` (`CDP_URL`, `SIM_URL`, `PARTS`): hardware
  Chrome. Runway ground roll and climb-out for all three aircraft with a still-air
  control, the Neon demos with and without wind, pause/restart/aircraft/region changes,
  replay of a Neon sortie, real-time frame and tick time with and without wind.
- Existing `verify-neon-canyon.mjs`, `verify-neon-bridge.mjs`, `verify-neon-city.mjs`.

A test pilot sets only ordinary virtual control inputs (`flyBank`, `flyVerticalPath`,
rudder against sideslip). No teleport, force, pose override or wind suppression is used
to make a path pass. Headless runs do not simulate tower collision; they report the
gap to tower walls beside the path. Browser runs collide with towers and bridges.

Browser: Chrome 157 headless, `ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (8GB)
Direct3D11)`, `verify-browser-gpu.mjs` pixel `[255,0,0,255]`, GL error 0.
Node 24.18.0 on the same Windows 11 laptop. Values are from one run each.

### Wind at fixed points

Same seed, 120 s at 120 Hz, 110 m unless noted. RMS about the mean, m/s, world
east/up/south. With the design north wind:

| Point | Mean speed | RMS E/U/S | Max speed | Vertical range |
|---|---|---|---|---|
| sea west (x -3000) | 4.00 | 0.12/0.09/0.26 | 4.60 | -0.20..0.20 |
| `open` | 4.01 | 0.13/0.10/0.26 | 4.60 | -0.19..0.20 |
| `wide-canyon` | 2.09 | 0.30/0.23/0.40 | 2.84 | -0.58..0.36 |
| `slot` | 1.36 | 0.42/0.28/0.46 | 2.70 | -0.54..0.72 |
| `slot` at 30 m | 1.03 | 0.34/0.22/0.41 | 1.97 | -0.47..0.46 |
| `canal` | 3.51 | 0.25/0.16/0.34 | 4.37 | -0.35..0.42 |
| `lee` | 1.29 | 0.41/0.28/0.47 | 2.40 | -0.51..0.53 |
| `rooftop` | 2.59 | 0.35/0.21/0.41 | 3.55 | -0.43..0.43 |
| above `lee` at 600 m | 5.69 | 0.12/0.08/0.26 | 6.29 | -0.19..0.20 |

The background disturbance is present everywhere, including the open sea. Wake points
have two to three times its horizontal RMS and a lower mean, and the field returns to the
background above the towers. Reversing the wind moves the shelter across the 420 m crown
tower (2500, -175): 175 m south of it the mean is 1.47 m/s in a north wind and 2.00 m/s
in a south wind; 175 m north of it, 2.28 and 1.63 m/s.

### Canyon line, per site (headless)

Wind RMS E/U/S (m/s), peak wing-gust rolling moment (kN m), roll RMS (deg) and G range
inside each site envelope; still air gives zero wind, zero gust moment and zero roll at
every site.

| Site | C172 wind RMS | C172 gust moment / roll RMS / G | B738 wind RMS | B738 gust moment | F16 wind RMS | F16 gust moment |
|---|---|---|---|---|---|---|
| `open` | 0.08/0.05/0.06 | 0.03 / 2.6 / 0.98-1.02 | 0.08/0.01/0.22 | 5.3 | 0.08/0.01/0.19 | 0.07 |
| `wide-canyon` | 0.29/0.19/0.32 | 0.50 / 3.9 / 0.93-1.06 | 0.30/0.24/0.44 | 81 | 0.39/0.19/0.42 | 1.1 |
| `slot` | 0.43/0.21/0.63 | 0.77 / 5.9 / 0.95-1.09 | 0.47/0.27/0.23 | 88 | 0.31/0.26/0.33 | 1.6 |
| `canal` | 0.18/0.13/0.28 | 0.36 / 2.4 / 0.96-1.03 | 0.22/0.12/0.18 | 52 | 0.26/0.14/0.31 | 0.7 |
| `lee` | 0.44/0.22/0.29 | 0.42 / 0.9 / 0.95-1.04 | 0.52/0.28/1.11 | 92 | 0.37/0.29/0.88 | 1.2 |
| `rooftop` | 0.24/0.24/0.39 | 0.50 / 4.2 / 0.97-1.07 | 0.19/0.25/0.35 | 81 | 0.23/0.26/0.64 | 1.3 |

Whole line (wind vs still air): C172 86 kt, roll -12.6..8.5 deg (calm 0), altitude
108.6-111.3 m (calm 110.0-110.3), lateral deviation 24 m (calm 0), nearest tower wall
48.8 m, sideslip under 2.8 deg, G 0.92-1.09. B738 and F16 at 180 kt: roll within
-3.6..5.4 deg, lateral deviation 10 m, G and IAS ranges equal to still air because both
are dominated by the preset's acceleration from 136 kt. No stall, G-LOC or crash.

### Hardware Chrome flights

| Path | C172 | B738 | F16 |
|---|---|---|---|
| Canyon line to x 4100 (`verify-neon-canyon`) | no collision, max \|z\| 24.1 m, 108.6-111.3 m, tower gap 48.9 m | no collision, \|z\| 10.4 m, 62.4-110.5 m, gap 51.9 m | no collision, \|z\| 10.1 m, 103.6-114.6 m, gap 51.9 m |
| Parked on the runway, 10 s | 0 m drift | 0 m | 0 m |
| Ground roll and climb-out on 090 | liftoff 13.5 s (calm 13.5), 35 m off the extended centreline after 30 s of climb, roll < 4.1 deg | liftoff 32.9 s (calm 32.9), 8.8 m, roll < 1.8 deg | liftoff 11.0 s (calm 11.0), 66 m, roll < 8.9 deg |
| Bridge flight (`verify-neon-bridge`, C172) | three bridges, no contact; restart, crash/retry, menu, reload pass | - | - |

Lateral offsets after liftoff are crosswind drift of a pilot holding heading toward a
point 300 m ahead; the ground roll itself stays on the runway. The canyon RMS reported by
`verify-neon-canyon` is about the site mean along a moving path, so it includes the
mean-wind change across each site.

60 s cruise from the 760 m preset (headless, pilot holding heading, height and speed):
C172 IAS 90.9-97.3 kt, height 760-771 m (still air 760-769 m), roll within 0.7 deg,
G 0.98-1.03; B738 and F16 roll within 0.2 deg, height within 0.9 m, G 0.98-1.01. Hands off
for 60 s: roll within 1.1 deg and height within 3.2 m for all three, versus 0 deg and
1.1 m in still air.

Hands off for 4 s entering a wake, then the pilot resumes (headless):

| Aircraft | Slot: max roll / max \|z\| / min height | Lee: max roll / max \|z\| / min height |
|---|---|---|
| C172 | 6.7 deg / 16.7 m / 106.1 m | 3.2 deg / 18.3 m / 108.1 m |
| B738 | 1.8 deg / 9.8 m / (sinks with the preset, as in still air) | 1.5 deg / 10.0 m / (as still air) |
| F16 | 2.4 deg / 14.5 m / 112.0 m | 0.7 deg / 16.7 m / 112.3 m |

The slot walls are 62 m either side of the line. No case stalled or crashed, and the pilot
returned every aircraft inside 15 m of the line. B738 height loss and F16 climb after the
release happen equally in still air (preset trim, see the #696 limits), not from wind.

### Lifecycle, demos, replay, multiplayer

- Pause: 1.5 s of real frames while paused leaves `windTimeSeconds` at 5.000.
- Restart from the pause menu: wind time 0, same seed, and the sample after 5 s equals
  the first run to 1e-9 m/s.
- B738 cruise, F16 canyon and C172 bridge after aircraft changes keep `UrbanWindField`
  (`neon-background-v1`, 4 m/s from 000). Coastal runway: no field, zero wind sample.
- Replay of a 20 s Neon cruise: wind time stays at its load value (0) during playback,
  the pose at 10 s matches the recording within 3e-5 m. Replay is pose playback; the
  track records no wind and needs none.
- Multiplayer: rooms keep the calm contract (`PresetSpawner` skips the Neon field while
  `multiplayer.active`; `MultiplayerController` clears it at round preparation), covered
  by `tests/neonWind.test.js`. Both peers fly still air, so their environments agree.
  No two-browser Neon room was flown here.

Neon demos, stepped to completion with the urban wind and in still air (the field
removed after every preset the demo applies), and on origin/main 359813e before any Neon
wind:

| Demo | Urban wind | Still air (current) | Before #694 (359813e) |
|---|---|---|---|
| C172 `proximity` | completes, 37.5 s | completes | completes |
| C172 `scenic` (city route) | completes, 78.3 s | hits a tower at 70.3 s | hits a tower at 70.3 s |
| C172 `maneuvers` | completes, 75.3 s | completes | completes |
| B738 `classic` | ends at 23 s: rolls 31 m left of the centreline (heading 076), nose and left main gear collapse | hits a tower at 49.8 s | hits a tower at 49.8 s |

The C172 city route and the B738 classic demo (the coastal choreography flown at Neon)
already failed in still air before the Neon wind; the demo sweep does not cover Neon.
The wind changes how B738 classic fails: its takeoff roll holds the rudder at zero, so
the 2.4 m/s crosswind weathervanes it off the runway before it reaches the tower. The
C172 city route completing in wind is incidental, not a fix.

### Cost

Headless, wind's three samples per tick: p50 0.005-0.008 ms, p95 0.009-0.017 ms across
all paths (timed per call, including the timer). A whole 120 Hz tick: p95 0.05-0.14 ms
with wind, 0.02-0.07 ms in still air.

In the hardware Chrome page, 12,000 ticks of three samples along the canyon line take
0.0084-0.0115 ms per tick (five runs, three sessions), well inside the 0.5 ms target. The page timer has
about 0.1 ms resolution, so per-call timing in live flight only bounds the wind at p95
0.1 ms per tick. Real-time flight for 600 frames (1440x900, balanced quality), wind vs
still air, two runs:

| Flight | Frame p50 (ms) | Frame p95 (ms) | Physics tick p95 (ms) |
|---|---|---|---|
| C172 canyon | 11.2 / 11.1; 11.0 / 11.0 | 22.6 / 22.1; 12.9 / 13.1 | 0.7 / 0.6; 0.5 / 0.5 |
| B738 cruise | 19.8 / 20.1; 14.7 / 14.8 | 29.6 / 26.2; 23.5 / 23.3 | 0.6 / 0.4; 0.4 / 0.4 |
| F16 canyon | 23.2 / 23.2; 22.8 / 22.8 | 34.2 / 34.4; 34.2 / 34.4 | 0.5 / 0.4; 0.6 / 0.5 |

Frame time does not change measurably with the wind; the run-to-run spread is larger.

Limits of this acceptance: no person flew it by hand; the test pilot shows the paths are
flyable with ordinary control inputs, not how difficult they feel. Single runs on one
laptop. Headless runs do not collide with towers. Real-time frame times are dominated by
rendering and vary run to run by more than the wind's cost.

## Neon urban wind (#696)

This section supersedes the zero mean wind and the "buildings do not affect the field"
statements of the #694 section below. Ordinary single-player Neon flights now install
`UrbanWindField` (`src/physics/UrbanWindField.js`) from `NEON_WIND`. `WindField.js`,
aerodynamics, moments, collision and integration are unchanged: the new field only
changes what the existing centre and half-wing samples read.

```text
e = (-sin from, 0, cos from)   n = (cos from, 0, sin from)
W(x,t) = U(y) * S(x) * e + u_bg(x,t) + sigma_city(x) * psi(x,t)   (vertical part times g(y))
```

- `U(y)`: mean speed, 4 m/s at 110 m from 000 degrees, power law with exponent 0.25
  measured from the water level (-14 m) plus 2 m: 1.4 m/s at the water, 2.4 at the
  street, 5.4 at 400 m, constant above 500 m.
- `S(x)`: product over towers of `1 - D`. Each wake `D` peaks at 0.6 behind the lee
  face, decays as `1 / (1 + xi / 4)` with `xi` in reference lengths (the smaller of the
  projected width and the height), ends smoothly between 8 and 12 lengths, is Gaussian
  across the wind and fades out through a shear layer at the roof.
- `sigma_city`: wake turbulence scale, strongest in the wake's side and roof shear
  layers, capped at 0.35 of `U(y)`. `psi` is three seeded sine modes per component with
  40-160 m wavelengths drifting downwind at the reference speed.
- `g(y)`: vertical wind fades in over the first 30 m above the street and is zero at and
  below street level, including the canal.
- `u_bg`: the #694 light background field, unchanged.

Airborne presets are authored for still air. `alignSpawnToWind` (`src/core/windSpawn.js`)
keeps their ground track and airspeed in the local mean wind and yaws the nose along the
relative wind (about 5 degrees for the C172 canyon spawn), so they start without sideslip
and the still-air trim stays valid. Parked spawns are not changed; the runway sees about
2.4 m/s of crosswind. Mission preparation, multiplayer, region exit, restart and replay
keep the #694 behaviour.

Design wind, 110 m, canyon line (`node scripts/neon-wind-map.mjs <out.svg> [from deg]`):

| Site | Mean (m/s) | Wake turbulence scale (m/s) |
|---|---|---|
| `open` | 4.00 | 0.00 |
| `wide-canyon` | 2.01 | 0.76 |
| `slot` | 1.19 | 0.92 |
| `canal` | 3.52 | 0.45 |
| `lee` | 1.20 | 0.91 |
| `rooftop` | 2.53 | 0.71 |

One tick's three samples cost p50 0.0055 ms, p95 0.0113 ms over 12,000 ticks (Node
24.18.0, development PC; all 77 towers evaluated per sample, no spatial grid).

`tests/urbanWindField.test.js` covers the profile, single-tower wake and its reversal,
rotated footprints, site contrast, purity, continuity (at most 0.3 m/s between samples
0.5 m apart), zero vertical wind at street level, overlap bounds and input validation.
`tests/windSpawn.test.js` covers the spawn alignment. `tests/neonWind.test.js` covers all
presets, spawn sideslip, the parked runway, a 60 s hands-off C172 canyon flight and 60 s
cruise for C172/B738/F16.

Limits: a real-time approximation, not CFD or a turbulence spectrum. No channelling
between towers, corner acceleration, roof updraught, flow reversal or bridge vortices.
The field is not divergence-free. Wake turbulence feeds the existing roll response only
through the half-wing samples; gust-gradient pitch and yaw are not modelled. With fixed
controls the B738 and F16 canyon presets lose height with or without this wind (on
origin/main 5d612d3 the B738 reaches the ground 6.7 s after the spawn and the F16
descends from 110 m to 34 m within 60 s), so only the C172 canyon flight is asserted.
Node tests do not establish browser acceptance; hardware Chrome flights belong to #697.

## Neon background wind (#694)

Ordinary single-player Neon flights install `NEON_WIND` from
`src/config/neonWind.js` after preset/aircraft reload, bridge setup and trim.
Runway, urban canyon (`approach`), skyline cruise and the C172-only bridge flight
share `light-turbulence-v1`, seed `neon-background-v1`, heading basis 090 degrees.
The mean is zero; existing along/right/up amplitude caps are 0.3/0.6/0.2 m/s
(not RMS), corresponding to world X/Z/Y at this heading. No region mask is used,
so the same field exists outside the island and below street level as well.

This is configuration and preset wiring only. WindField, aerodynamics, moments,
collision and integration equations are unchanged. Existing world-space center
and half-wing samples feed relative airflow and the existing differential roll
moment. Neither camera nor aircraft pose receives an artificial disturbance.
Buildings do not affect the field yet; rearranging buildings cannot create wakes
in this model. Follow-ups #695-#697 cover layout, supported settings and acceptance.
#695 laid out the comparison sites along the canyon flight (`NEON_WIND_SITES` in
`src/config/neonBuildings.js`, see [neon-river.md](neon-river.md#towers-and-wind-comparison-sites));
it installs no wind of its own.

Every ordinary preset reset recreates the same field/time; airport departure
clears it through the existing preset path. Explicit mission preparation skips
the regional default and may install its own field afterward. Multiplayer keeps
its existing calm environment, including respawns. Replay playback still consumes
recorded pose/telemetry with physics inactive, not a wind-driven re-simulation.

`tests/neonWind.test.js` covers all supported aircraft/presets, distant/low/high
samples, restart/exit/reentry, explicit wind ownership, calm room respawns,
frame grouping, and 60 s production-physics cruise for C172/B738/F16. Node tests
do not establish full city collision or browser route acceptance.

## Historical behavior inspected

At base `d4f6af4`, `Aerodynamics.computeAero()` already computes relative airflow
as aircraft world velocity minus `aero.windWorld`. That drives sideslip, side
force, aerodynamic moments, IAS/TAS and dynamic pressure. However, normal setup
initializes `windWorld` to zero and provides no varying wind source. The symmetric
configuration and flat runway can therefore legitimately retain straight motion.

The inspected integrator has no general heading/centerline lock. It does have an
explicit built-in autopilot path and demo/developer controllers. Tests and mission
setup must turn those off before attributing corrections to passive physics.
The parked/braking speed clamp applies only with ground contact, brakes > 0.5,
velocity magnitude < 0.4 m/s, and throttle < 0.1. Landing gear computes lateral
friction from contact velocity and caps tire force with strut load; a weak
crosswind need not immediately slide the aircraft across the runway.

One wind inconsistency was found: engine speed-dependent calculations received
world velocity magnitude rather than relative airspeed. The integrator now uses
velocity minus the same `aero.windWorld` for engine TAS. Zero wind is unchanged.
No speculative coefficient, damping, heading, tire or control changes were made.

## API and units

```js
import { WindField, setSimulationWind } from '../physics/WindField.js';

sim.setPreset('runway');
setSimulationWind(sim, new WindField({
  profile: 'mild-disturbance-v1',
  seed: 'environment-1',
  runwayHeadingDeg: 90,
  crosswindSign: 1,
}));
```

Apply after preset/aircraft preparation. `setSimulationWind(sim)` removes the
field and zeros its last applied wind. Every preset clears an active field, so
an arena caller must configure its desired environment again after reset.
Existing direct `aero.windWorld` users remain untouched when no field is active.

`sample(position, simSeconds, target)` writes a caller-owned world vector in m/s.
Heading is clockwise from north; positive crosswind blows runway-right. The
world axes remain +X east, +Y up, +Z south. The field combines three sine modes
per along/right/up component. Their periods are 4–12 seconds, wavelengths
300–1,000 meters, and summed amplitude caps 0.3/0.6/0.2 m/s. Mean rightward speed
is signed 1.5 m/s. `calm-debug-v1` is exactly zero. These are proposed training
parameters, not an atmospheric-spectrum or aircraft-fidelity claim.

The field is a pure function of seed, position and simulated time. Its internal
sampling clock advances once per integrated live physics tick. It deliberately
does not read `totalSimTime`, because that existing visual clock advances by
render frame rather than integrated physics. Pauses and unrelated sensor/log
queries do not change the field. Compare pilots on the same world field, not
identical wind samples when their flight paths differ.

## Evidence and remaining gate

`tests/windField.test.js` checks seeded replay after unrelated queries, axis and
amplitude bounds, continuity, sample/reset timing independence, invalid input,
and actual crosswind side-force/yaw-moment response through Aerodynamics.
Focused aero-result and physics-timing regressions also pass.

Full takeoff/landing acceptance, visual responsiveness, and five-seed feedback
pilot success require the arena integration and hardware-GPU Chrome evidence.
This executor has no `/dev/dri/renderD128` or installed Chrome binary, so browser
acceptance has not been established; software rendering was not used.

## Light turbulence cruise (#562)

Main menu → Settings → Developer mode (this session) → Developer →
**Light turbulence cruise (60 s)** → Run. Select Coastal and B738 first.
This adds `light-turbulence-v1`: zero mean wind, along/right/up amplitude caps
0.3/0.6/0.2 m/s, seed `coastal-b738-turbulence-1`, heading basis 063°.
The existing mild and Incheon profiles are unchanged. This is a spatial/temporal
sine-wave training field, not a validated atmospheric turbulence spectrum.
The field is invisible and global; regional restriction belongs to #563.

The existing coastal cruise preset supplies position (-600, 750, 3200) m,
world velocity (96, 0, -49) m/s, 66,000 kg B738, gear/flaps/spoilers up,
zero angular rates and computed hands-off trim. At the verified configuration,
throttle is 0.40871194 and trim 4.87959445°. The initial pitch is approximately
5.679°, heading 063°. Setup applies wind **after** all nested preset resets.
No position, quaternion or angular velocity receives a synthetic disturbance.

The existing relative-airflow calculation `v_air = v_aircraft - u'(x,t)` changes
angle of attack, sideslip, dynamic pressure and hence actual forces/moments.
World axes are +X east, +Y up, +Z south; body forward is -Z. Quaternion inverse
rotation converts world airflow to body coordinates. Each 1/120 s physics tick
samples the same seeded field, regardless of render grouping or extra queries.

Leave pitch/roll/yaw centered and throttle/trim unchanged for the fixed-control
comparison; AP and demo steering are off. Observe heading, attitude, altitude and
G on the existing instruments or the exterior aircraft. Keyboard/touch/manual
controls remain available; configuration/failure shortcuts retain fixture locks.
Pause holds physics and wind time; restart recreates the same initial state and
seed; exit, mode disabling and preset/aircraft/airport changes remove the field
and zero its time/vector. The final pose holds at 60 s. Arbitrary pilot inputs
can still stall or crash the aircraft; no damage or collision protection is added.

### Reproduction and measured evidence

Use Node 22.23.2, `npm ci`, and start `npm run dev -- --host 127.0.0.1 --port 5196`.
Then run `node scripts/verify-turbulence.mjs` (`SIM_URL`, `CHROME_PATH`,
`ARTIFACT_DIR` override location/binary/output). The harness runs the hardware
preflight first, enters through Developer controls, integrates the production
physics for 7,200 ticks per run, and records `.tmp/turbulence/results.json`, GPU
evidence and desktop/mobile screenshots. It compares no field, zero-amplitude
field and turbulence, and checks input hold/release and lifecycle cleanup.

Hardware Chrome 156 / Intel Arc 140V / ANGLE D3D11 passed a red shader draw with
`readPixels = [255, 0, 0, 255]`, GL error 0. Recorded fixed-control 60 s ranges:

| Quantity | No field | Light turbulence |
| --- | --- | --- |
| Altitude (m) | 750.000–750.497 | 748.756–751.888 |
| IAS (kt) | 201.960–202.042 | 201.315–202.811 |
| Normal load (G) | 0.99502–0.99517 | 0.98354–1.00593 |
| Pitch (deg) | 5.679–5.689 | 5.584–5.765 |
| Roll (deg) | 0.000–0.031 | −0.205–0.233 |
| Heading (deg) | 62.953–63.000 | 62.717–63.222 |

Minimum terrain clearance was 612 m. Final turbulent position differs from calm
by approximately (+1.357, −0.944, +0.028) m. Both runs recorded zero crash, gear
or body damage, body contact, stall, G-LOC and engine failure. A zero-amplitude
field gives exactly the no-field final position, quaternion, velocity and rates.
The small calm drift is the production model's open-loop cruise response, not
claimed perfect equilibrium. The 60 s audit is deterministic simulation time;
rendered-loop progress and manual input are separate browser checks.

`tests/turbulenceScenario.test.js` also exercises production physics, frame
grouping, unrelated sampling, replay after reset, nested preset cancellation,
manual control ownership and transient unsafe conditions. This is evidence for
one seed, one aircraft/loading and one starting condition, not a handling-quality
certification or general weather model.

## Turbulence strength comparison (before #563)

The Developer menu places **Moderate turbulence cruise (60 s)** and
**Strong turbulence cruise (60 s)** immediately after Light. All three reuse the
same Coastal/B738 cruise preset, position (-600, 750, 3200) m, velocity
(96, 0, -49) m/s, attitude, loading, trim, seed and 063° wind basis above.
Restart and switching levels reconstruct that start and reset the wind clock.

| Level | Profile | Base along / right / up caps (m/s) | Additional wing-scale vertical cap (m/s) |
| --- | --- | --- | --- |
| Light | `light-turbulence-v1` | 0.3 / 0.6 / 0.2 | 0 |
| Moderate | `moderate-turbulence-v1` | 0.9 / 1.8 / 0.6 | 0.8 |
| Strong | `strong-turbulence-v1` | 1.8 / 3.6 / 1.2 | 1.6 |

Mean wind stays zero. The original comparison scaled only the central field.
Moderate/Strong now also contain three vertical modes with cross-track wavelengths
70–150 m, along-track wavelengths 1,500–2,500 m and periods 5–10 s, using the
separate deterministic seed suffix `:wing-gust`. Their axes stay world-fixed at
the configured 063° heading; the field never follows the airplane. The shorter
cross-track scale gives the two wings different updrafts. At identical position
and time, the complete Strong field is exactly twice Moderate's. Light retains
its original field and central sampling. These are relative comparison levels in the existing training
model, not calibrated meteorological severity classes. Different flight paths
sample different parts of the field, so aircraft motion need not scale linearly.
The 120 Hz timestep is unchanged. There are no synthetic pose or camera shakes. All levels remain global and
invisible. The localized region in #563 is separate work.

### Wing-gradient rolling moment

For the two-panel approximation, sample the same world field at body offsets
`(-b/4, 0, 0)` and `(+b/4, 0, 0)`, rotated by the physical quaternion and translated
by the physical position. These are uniform half-wing area centroids, not the
wingtips. Both samples use the center sample's time; the clock advances only once.

Rotate `windRight - windLeft` into body coordinates. With center relative-airflow
components `u = -vBody.z`, `w = -vBody.y`, the linearized angle-of-attack difference is
`deltaAlpha = (u * deltaWind.y - w * deltaWind.z) / max(100, u² + w²)`.
The denominator floor regularizes low-speed evaluation; dynamic pressure makes
the correction vanish at zero airspeed. The incremental difference in lift is
`deltaL = q * (S/2) * CLa * deltaAlpha * (1 - separation) * liftMultiplier`.
The normal-force couple is `Mz = (b/4) * deltaL * cos(alpha)` in N m. A stronger
right-wing updraft lifts the right wing, giving positive body Z / a left bank.
Equal left/right winds produce zero additional moment. The antisymmetric force
pair has zero net force; central airflow retains the existing common heave model.

This is an attached-flow, small-gust gradient correction fading with the existing
separation state, not a full spanwise wing solver or separate left/right stall
model. It does not add angular-velocity-induced section flow: the existing `Cl_p`
already supplies roll damping. Gust-induced differential drag/yaw is omitted.
Incheon, mild, calm and Light keep center-only sampling. Reset clears all three
wind vectors so a prior Strong run cannot leave a residual rolling moment.

At the shared start and fixed seed, the first tick already sees a right-minus-left
vertical wind difference of 0.159 m/s (Moderate) or 0.318 m/s (Strong), producing
30.610/61.223 kN m of gradient moment. Attitude changes continuously after that
force is applied: Strong reaches about 3.41° of bank at 2 s and 4.62° at 2.7 s.
This guarantees an immediate disturbance for this fixture, not an instantaneous
attitude jump or a region-entry event. Both first-tick values are regression-checked.

The Node comparison test flies all levels for 7,200 ticks, checks equal starts,
increasing roll range for this seed, and no crash/damage/stall/G-LOC/engine failure.
It also checks each level's manual input, deterministic restart, and preset
cleanup, plus switching strong back to light. `scripts/verify-turbulence.mjs`
enters all three through Developer controls and records matching starts,
60-second ranges and screenshots; its input/lifecycle checks run on Strong.

Hardware Chrome 156 / Intel Arc 140V / ANGLE D3D11 verified all three menu entries,
identical starts, and 7,200 physics ticks per level. Shader preflight returned
`[255, 0, 0, 255]` with GL error 0. Measured fixed-control ranges:

| Quantity | Light | Moderate | Strong |
| --- | --- | --- | --- |
| Altitude (m) | 748.756–751.888 | 745.320–755.336 | 736.698–760.210 |
| Roll (deg) | −0.205–0.233 | −1.865–2.669 | −3.409–4.616 |
| Normal load (G) | 0.9835–1.0059 | 0.9328–1.0577 | 0.8652–1.1757 |
| Wing-gradient roll moment (kN m) | 0 | −107.031–123.863 | −325.511–338.701 |

All levels passed the no-failure observation checks. Strong also passed pause,
resume, deterministic restart, keyboard/touch hold-release and rendered-loop
progress. Exit, preset, aircraft, airport and mode-disable cleanup passed.
Desktop entries, both bank extremes for Moderate/Strong, and mobile manual-flight
screenshots were inspected. Before wing sampling, Moderate's roll range was
−0.624–0.673° and Strong's was −1.255–1.332°. `tests/wingGust.test.js` checks
the analytical moment/sign, uniform-flow cancellation, world-rotation invariance,
physical sample locations, shared time, reset and low-speed/separation behavior. Evidence
is local under `.tmp/turbulence/`; this remains a one-seed B738 comparison, not
a general strong-turbulence handling claim.
