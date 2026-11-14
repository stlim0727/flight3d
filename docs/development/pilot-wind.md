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
