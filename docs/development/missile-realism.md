# Missile realism: model review and acceptance

Status: design and verification guidance for [issue #713](https://github.com/stlim0727/flight3d/issues/713), not implemented or flight-validated behavior.
Code baseline: `359813e`. This review inspected source; it did not measure a hit rate or run browser combat scenarios.

## Current behavior and why hits are easy

The combat row in [the task map](agent-task-map.md) and the
[air-to-air combat plan](air-to-air-missiles.md) identify the implementation and remaining scope.

| Source | Observed behavior at the baseline |
| --- | --- |
| `src/weapons/AirToAirMissileSystem.js`, `BanditTarget.update()` | F-16-based flight dynamics follow a circular patrol and avoid terrain; the pilot does not react to inbound missiles. |
| `_guide()` / `_applyGuidance()` | Rocket thrust, propellant mass, atmospheric drag, gravity and proportional navigation are integrated at a fixed 120 Hz. Guidance reads exact target position and velocity. |
| `src/weapons/missileSpecs.js` | AIM-9X and AIM-120C have different propulsion parameters but share 35G, 8.5 km seeker range, 65° gimbal, navigation constant 4 and 14 m fuse radius. These are game-calibrated values. |
| `_applyGuidance()` | A fixed acceleration cap and gimbal gate exist; dynamic-pressure-dependent authority, actuator response and maneuver drag are absent. |
| Fuze / detonation | See [missile fuze and damage](missile-fuze-damage.md) for the current same-time closest-approach policy, independent damage distances and remaining limitations. |

IR/radar-specific signal quality, terrain sensor occlusion, countermeasures and
threat-driven evasion are not implemented in this path. High hit rates against
these patrol targets do not establish realistic combat effectiveness. Misses are
possible; the code does not guarantee a hit.

The project uses Three.js and ES modules; the missile core has its own 120 Hz
accumulator. The supplied research's claims of an existing Rapier engine,
240 Hz missile loop and drop-in TypeScript interfaces are not repository facts.

## Full research archive

The [versioned research archive](missile-research/README.md) retains all four
supplied shared pages, including numeric tables, equations, example code, source
links and scenario proposals. Its confidence and correction register distinguishes
source claims from repository facts, assumptions and known errors.

## Evidence and parameter provenance

Keep three categories separate for every parameter:

- **Source-confirmed:** record the exact primary-source URL, passage/table,
  missile variant/block, units and conditions after checking the source.
- **Unverified:** an attributed value whose supporting source has not been
  checked, or for which public evidence is insufficient. This does not establish
  that the value is classified.
- **Model assumption:** a documented simulation approximation with a rationale,
  sensitivity range and calibration/validation scenario.

The Gemini exchanges below are review inputs, not authoritative specifications.
Their quoted fact sheets and numeric tables have not been independently verified
in this document. Do not promote their thrust curves, propellant masses, seeker
limits, G limits, fuze radii or damage radii into certified missile data. Keep
AIM-9M separate from AIM-9X and distinguish AIM-120 variants. Advertised maximum
speed or range alone cannot validate a trajectory or engagement envelope.

Research inputs, in review order:

- [Initial research](https://share.gemini.google/XwO8Isutc9dQ)
- [Architecture and provenance revision](https://share.gemini.google/78hnvVreueiF)
- [Guidance and simultaneous CPA revision](https://share.gemini.google/MmsXMVRuk7Z3)
- [Gravity, TVC and fuze revision](https://share.gemini.google/Emf3m94rBCFt)

## Model boundaries and invariants

Start with a bounded point-mass simulation consistent with the existing core.
Full attitude dynamics are a separate scope; a velocity-aligned body cannot
substantiate high-angle attitude, seeker-boresight or thrust-vectoring fidelity.
Follow [the modeling principles](physics-modeling-principles.md).

### Forces, response and numerical integration

- Distinguish acceleration normal to line of sight from acceleration normal to
  missile velocity. A model claiming purely lateral control must project its
  control acceleration onto the velocity-normal plane. This changes the guidance
  model; do not present a projected heuristic as a verified manufacturer's law.
- Apply the complete gravity vector in the final equation of motion. If the
  controller compensates lateral gravity, that compensation consumes available
  control authority and responds through the actuator model. Saturation and
  response delay prevent an unconditional claim of exact cancellation.
- Separate requested, filtered and physically achievable acceleration. After
  response filtering and reprojection, enforce the **current** structural and
  actuator limits again, including abrupt loss of thrust-vectoring authority at
  burnout. Integrate only forces the actuators actually deliver.
- Split delivered lateral force into aerodynamic and thrust-vectoring portions.
  Compute maneuver drag from the aerodynamic portion; account for forward thrust
  lost to vectoring. The sum must equal the force used by the integrator.
  Allocation priority is a model assumption, not established missile behavior.
- Requested force belongs in the clamp: delivered magnitude cannot exceed the
  request, structural limit or available combined actuator force.
- Derive motion direction independently for each missile. Never retain another
  missile's scratch direction when speed is near zero or target distance vanishes.
  Use an explicit per-missile orientation fallback and guard normalization.
- Keep reference areas and coefficients consistent, including Mach dependence.
  Check propulsion impulse, mass consumption and burnout timing together.
- Velocity-normal acceleration does no instantaneous work in continuous time;
  explicit time stepping can still add numerical energy. Measure step-size
  sensitivity and energy drift rather than assuming projection fixes integration.

### Sensors and target response

Guidance should consume sensor estimates with defined noise, latency, memory,
loss and reacquisition behavior. Exact simulation state may serve as a labeled
ideal-sensor baseline, not the default proof of realism. Target acceleration for
augmented guidance must likewise be estimated rather than silently omniscient.

Differentiate aircraft radar, radar missile seekers, IR seekers and warning
sensors. IR launches must not generate fictitious radar emissions. Model terrain
LOS and countermeasures through continuous signal and geometry state; avoid a
fixed universal notch threshold, guaranteed lock break or unsupported success
percentage. Define coordinate frames and ground-clutter reference explicitly.

Bandits should react only to observable threats with stated detection and reaction
assumptions, then maneuver through existing aircraft dynamics. Keep a non-evasive
patrol baseline. Do not replace missing sensors/evasion with a random miss chance.

### Fuze, explosion and damage

Treat fuze activation and damage as separate models with no required ordering
between trigger distance and a chosen damage radius. Damage depends on the
explosion and target state; a fixed guaranteed-kill sphere is a game assumption.

Use one shared interpolation time within each physics step for the missile and
all affected targets. General spatial distance between two independently
parameterized segments is not simultaneous closest approach. The existing
relative-motion approach is the correct baseline for same-time interpolation.

Specify trigger policy explicitly:

- **Entry:** evaluate entry during the current step without waiting for closest
  approach. Define behavior when the step starts inside the trigger volume.
- **Closest approach:** distinguish a genuine minimum crossing from a clamped
  interval endpoint. A clamped time of zero alone does not prove passage;
  stationary relative motion needs an explicit policy.

A perfect closest-approach trigger is an idealized policy, not evidence of a real
fuze's sensing or delay. Define arming/safe separation, direct impact, target loss
and reset behavior before adopting either policy. Interpolate explosion position,
target positions and damage distances to the actual trigger time. Emit one
terminal event and prevent repeated damage on subsequent steps.

A normalized-distance-squared falloff is an arbitrary quadratic curve, not an
inverse-square law. Any selected damage curve must declare its approximation,
outer cutoff behavior and target dependence. Fuze radius must not silently set
maximum fragment reach or guarantee destruction.

## Verification and delivery order

These are future acceptance checks, not test results:

| Case | Required evidence |
| --- | --- |
| Burnout and abrupt dynamic-pressure loss | Filtered acceleration never exceeds current delivered force; TVC stops contributing at burnout. |
| Lock loss, low/zero speed and coincident target | Finite state; full gravity remains; per-missile fallback direction is used. |
| Interleaved updates of differently oriented missiles | Results do not depend on shared scratch history or update ordering for independent actors. |
| Entry while still approaching; CPA at step boundaries; zero relative motion | Policy-specific, single trigger with consistent same-time explosion/damage coordinates. |
| Coast and sustained turns at multiple step sizes | Energy loss and numerical drift are recorded, including actuator saturation. |
| Occlusion, reacquisition and countermeasure sequences | State transitions are sensor-driven and replayable; no guaranteed random lock break. |
| Fixed launch-condition matrix | Compare patrol and evasive targets across range, aspect, altitude and speed; record hit/miss causes, not just aggregate percentage. |
| Reset, respawn, pause and replay | No stale lock/force state, duplicate explosion or repeated kill. |

Do not target an invented real-world hit percentage. Report assumptions and
sensitivity; explain misses through tracking, energy, geometry or target response.

Implement in reviewable increments: establish baseline telemetry and sequence
checks; then force/energy limits; sensor and warning contracts; bandit reactions;
independent fuze/damage; countermeasures; broader battlefield integration.
Coordinate with S3-2/S3-3/S3-4 and S4-1 in the existing plan. Its 5 m lethal and
5–14 m damage bands are project targets, not source-confirmed weapon effects.
SAMs, MANPADS, multiplayer and new aircraft combat scenarios remain separately
scoped work, not implicit additions required to close this documentation change.

Run focused logic tests for implemented changes. HUD, effects, audio and actual
combat lifecycle require hardware Chrome evidence under [browser-gpu.md](browser-gpu.md),
including renderer identification and shader pixel readback. No browser evidence
is claimed by this source review or by a production build.
