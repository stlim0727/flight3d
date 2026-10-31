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
