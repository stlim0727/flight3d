# Opt-in arena wind and straight-flight audit

Discussion [#356](https://github.com/stlim0727/flight3d/discussions/356), plan v6,
requires physical disturbances separately from noisy observations. This change
adds only the wind foundation; it does not calibrate or claim completed missions.

## Existing behavior inspected

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
