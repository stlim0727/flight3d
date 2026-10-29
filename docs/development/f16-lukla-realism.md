# F-16 Lukla landing: fidelity limits and evidence boundaries

Community discussion: [#306](https://github.com/stlim0727/flight3d/discussions/306) (Korean).

The experimental landing extension introduced in [PR #304](https://github.com/stlim0727/flight3d/pull/304)
shows a controllable, undamaged landing **in Flight3d's existing game model**.
It does not validate real F-16 operation at Lukla. Keeping the physics code and
coefficients unchanged is a statement about patch scope, not proof that those
models or coefficients match the real aircraft.

This assessment refers to the landing implementation at
[`92d978f`](https://github.com/stlim0727/flight3d/tree/92d978f514c61298a9ef03b086d4c95322036952).
PR #304 was merged into main in
[`5f7b73a`](https://github.com/stlim0727/flight3d/commit/5f7b73a).
Its availability on main does not change the fidelity limits described here.

## What was measured

The [recorded landing evidence](https://github.com/stlim0727/flight3d/tree/92d978f514c61298a9ef03b086d4c95322036952/review-artifacts/f16-lukla-landing)
reports approximately 130.58 KIAS at main-wheel touchdown, normal-to-runway
wheel impacts of 2.601 / 2.580 m/s on the mains and 2.527 m/s on the nose,
zero modeled gear damage, a stop with 41.63 m of runway remaining, and no
movement during a ten-second parking hold. These are simulator observations,
not manufacturer landing-performance or certification data.

The recorded strict sweep has zero FAIL, REPORT and KNOWN findings. It checks
route execution, state finiteness, modeled envelope/damage limits and the parked
handoff. A baseline generated from successful runs checks repeatability of the
current implementation; it is not an independent real-world reference.

## Concrete limitations

| Component | Current implementation | Consequence for interpreting success |
| --- | --- | --- |
| Airbrakes / lift dump | [Aerodynamics.js](../../src/physics/Aerodynamics.js) subtracts `0.38 * spoilers` from CL and adds spoiler drag. The proposed F16 pilot uses this shared variable during approach and rollout. | This is a generic lift-dump proxy, not a measured F16-specific speedbrake lift/drag model. Reduced lift can increase wheel loading and available tire braking. Its quantitative contribution to this landing has not been isolated. |
| Lift, drag and flaps | The shared model applies a flap lift increment and drag polar; [aircraftConfigs.js](../../src/config/aircraftConfigs.js) supplies simplified F16 derivatives and discrete flap angles. | Successful low-speed flight does not validate F16 lift/drag curves, automatic flap scheduling, ground effect or approach speed at the tested weight/altitude. Some configuration comments explicitly identify game estimates rather than manufacturer data. |
| Wheel braking | [LandingGear.js](../../src/physics/LandingGear.js) limits tire forces using normal load and fixed friction coefficients. | No calibrated F16 brake-energy, temperature/fade, tire-speed or detailed anti-skid envelope was established. Existing body-contact friction-work damage is not a brake thermal model. |
| Impact and structural limits | [gearDamage.js](../../src/physics/gearDamage.js) sets common main/nose impact limits, labeled tunable simulation values rather than aircraft certification values. | Zero modeled damage means the configured game thresholds were respected. It does not establish acceptable real F16 gear or airframe loads. |
| Pilot and conditions | The director reads exact simulation state each 120 Hz tick and was tuned for a specific route and loading. | Human sensing/reaction, disturbances, and a matrix of weights, winds, runway conditions and approach errors were not validated by repeating this route. |
| Airport and terrain | [Lukla terrain documentation](lukla-terrain.md) describes a measured regional surface model combined with a locally graded simulator runway. | A DEM and an approximate runway model do not establish surveyed obstacles, pavement strength, usable landing distance or operational suitability. |
| Final parking | [main.js](../../src/main.js) contains an existing near-zero-speed stop clamp below 0.4 m/s with brakes applied. | Scenario code does not teleport the landing, but the common engine still has numerical parking assistance. This low-speed clamp is not an explanation for hundreds of metres of high-speed deceleration. |

The existence of these approximations is established by the source. It has
**not** been established which one makes the difference between a real-world
failure and the observed simulator success. In particular, the possible braking
advantage from the shared spoiler/lift-dump implementation is a hypothesis to
measure, not a quantified result from an ablation test.

## Real-world context

[CAAN's Lukla description](https://caanepal.gov.np/storage/app/uploads/public/677/4d9/cac/6774d9cac6b61388068785.pdf)
describes a 527 m paved runway, 30 m width and 11.7% gradient, serving small STOL
aircraft. Historical official documents differ on reported runway width; the
simulator's 30 m width should not be treated as surveyed current operational data.

The [USAF's published 2019 demo-team support manual](https://www.acc.af.mil/Portals/92/Change%205%20to%202019%20Demo%20Team%20and%20HF%20Support%20Manual%20%28002%29.pdf)
specifies a 7,000 ft minimum runway length for F16 demo aircraft in its operating
context, with additional alternate/arresting-system provisions. This is an
operational criterion, **not** a universal shortest physical stopping distance or
a current performance calculation for a particular F16 weight and configuration.
It cannot be used alone to prove mathematical impossibility on a 527 m uphill runway.

[NASA's F16XL history](https://www.nasa.gov/wp-content/uploads/2015/06/elegance_in_flight.pdf?emrc=f8edbf)
describes the standard F16-derived speedbrakes on the aft fuselage beside the
engine nozzle. Their location and function are a reason to validate a dedicated
model rather than assume that a generic wing-lift-dump response is equivalent.
The reference does not supply the coefficient corrections needed here.

These sources support caution about operational realism. They do not validate
the game's 132-KIAS target, stopping distance, impact tolerance or safety margin.

## Validation work before claiming F16 landing realism

1. Assemble attributable reference data for the specific variant, weight, CG,
   pressure altitude, temperature, configuration and runway conditions. Separate
   airborne landing distance, ground roll and operational safety margins.
2. Validate aircraft-specific speedbrake/flap effects, approach lift/drag and
   control response against those references. Keep forces continuous and follow
   the [physics modeling principles](physics-modeling-principles.md).
3. Benchmark braking and landing-gear behavior independently of the demo pilot,
   including load transfer, energy/thermal limits and normal-to-surface impact.
4. Run controlled sensitivity/ablation comparisons of the current generic
   lift-dump contribution, then test weight, wind, surface and initial-error
   variations. Report both successes and failures.
5. Re-run the demo after model corrections. If a better-supported model cannot
   complete the landing, retain that failure rather than inflate lift, friction,
   impact tolerance or safety-area allowances to restore a green sweep.

Until that work exists, describe this as an experimental game-model landing.
Do not equate regression-test success, unchanged physics code or skilled
in-model control with validation of real-world F16 landing feasibility.
