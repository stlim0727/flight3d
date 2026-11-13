# Fixed-step physics core

Task 1-1 (#185, following #131) retains the custom JavaScript integrator at
120 Hz. This is a compatibility choice, not evidence that 120 Hz is more
accurate than 240 Hz. Rapier adoption and changing integration algorithms are
separate decisions.

## Time and state

`SIM_CONFIG.physics.targetHz` defines the rate; `fixedDt` is derived from it.
Both real-time accumulation and `stepSimulation()` call `stepPhysics()` in
`src/core/physicsTiming.js`. The director runs before integration on each tick.
Real-time frames accept at most 0.1 seconds, approximately 12 steps including
any fractional carry. Excess wall time is discarded, not caught up later.
Negative or nonfinite frame deltas contribute no time.

The accumulator retains fractional time. Binary floating-point rounding can
place an exact mathematical tick boundary just below the threshold; tests
allow a negligible final time increment rather than changing the established
integration schedule. Presets, frozen/menu-held flight and deterministic
stepping discard the accumulator as before. Deterministic stepping preserves
its existing nearest-tick rounding and minimum one-tick behavior.

Physics position, orientation and velocity remain authoritative. `RenderPose`
interpolates only the displayed transform one physics tick behind; it must not
feed back into force/contact queries. Reset discards the displayed history.

## Frames and units

The aircraft's local axes are right +X, up +Y and forward -Z. These are project
conventions, not a mandatory forward axis for all Three.js models.

| Rotation | Local axis and positive sense |
| --- | --- |
| Pitch | +X raises the nose |
| Yaw | +Y turns the nose left |
| Roll | -Z lowers the right wing |

Forces and linear velocity are world-frame quantities. Aerodynamic moments
and angular velocity use the aircraft frame. Thrust rotates from local -Z to
world space; gravity stays world -Y. Aeronautical inertia names map to the
Three.js axes as X -> Iyy (pitch), Y -> Izz (yaw), Z -> Ixx (roll).
Units are meters, seconds, kilograms, newtons, newton-meters and radians/sec.
Attitude integrates local incremental quaternions and normalizes each step.
Euler angles remain valid for initialization, instruments and controller
measurements, but are not accumulated as the authoritative attitude.

## Allocation and ownership

`Aerodynamics` owns its temporary vectors and quaternion per instance.
`createAeroResult()` creates a caller-owned output buffer. Passing it as the
ninth argument to `computeAero()` overwrites its vectors and scalar fields.
The live simulator owns one such buffer and consumes it before the next call;
its engine-out torque adjustment is overwritten on the next computation.
Do not retain its vectors as historical samples without copying them outside
the hot path. Do not alias the output vectors with inputs or with each other.

Omitting the output argument preserves the snapshot API: callers receive new
vectors and a new result. Existing tests and offline calculations can retain
these results across calls. No existing consumer is silently switched to
borrowed output.

The live call removes two Vector3 allocations and one result object per tick
(240 vectors and 120 result objects per simulated second at 120 Hz). Existing
integrator scratch objects are retained. This is not a globally allocation-free
loop: atmospheric results, engine/gear/contact outputs, telemetry, callbacks,
notifications and effects still allocate. FPS or elimination of GC pauses is
not guaranteed by this change.

## Verification

- `tests/physicsTiming.test.js`: frame grouping, input ordering, fractional
  carry, delay clamp, invalid frame times and reset history.
- `tests/aeroResult.test.js`: reused versus snapshot outputs over stall/recovery
  and control/flap transitions, instance isolation, unchanged inputs, world
  force transforms and control torque signs.
- `tests/renderPose.test.js`: display-rate interpolation and reset behavior.
- Run the repository check/test/build gate and browser verification described
  in `ci.md`. A successful Node suite does not establish browser acceptance.

See [the recorded browser comparison](physics-core-verification.md) for the
baseline, measured results, reproduction steps and remaining limitations.

## Normal load and impact contact

`telemetry.rawGForce` is unfiltered normal specific force at the instantaneous CG,
not resultant acceleration or a cockpit/seat sensor. `normalLoadFactor` measures
`(deltaVelocity / dt - gravity) / g0` projected onto the midpoint body-up axis.
The velocity interval starts after the moving-CG reference rebase and ends after
body contact constraint impulses. At rest this reads +1g; free fall reads 0g.

### F-16 normal-load protection

`F16_FALCON.flightControls.gLimiter` enables a simplified pitch-envelope
controller in `Aerodynamics`, shared by manual, AP and director commands.
It uses the aircraft's `specs.limitLoad` (-3/+9g). Other aircraft retain their
existing surface response. This is a game control law, not a reproduction of
the complete F-16 FLCS or its stores/AoA/landing gain schedules.

The controller estimates normal load and its rate from current airflow, gravity
and body angular velocity, rather than delayed HUD telemetry. It bounds requested
pitch acceleration with a critically damped approach to the load boundary,
then converts the permitted moment into a bounded tail deflection. Trim goes
through the same protection. Forces and moments are recomputed from that
deflection; velocity, measured G and recorded peaks are never clipped.
A 0.35g reserve plus the neutral-tail estimate makes sustained maximum pull
conservative (about 8g in the high-speed regression cases).

Protection operates with forward airflow above 30 m/s, including low flight;
below that, the original surface command is retained. Physical surface authority
still limits recovery from an already excessive load or external disturbance.
Contact impulses are measured normally and are not covered by a manoeuvre
limiter. The controller has no persistent state to carry across reset or swap.

`tests/gLimiter.test.js` exercises production 120 Hz integration at 200–650 KIAS,
banked/inverted holds, releases, push/pull reversals, trim, AP and reset. The
input-shaping audit disables envelope protection explicitly to check raw actuator
resolution and symmetry independently of the asymmetric G limits.

Hardware Chrome verification:
`GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless node scripts/verify-g-limiter.mjs`.
The script runs the required GPU preflight, then compares protected/unprotected
650 KIAS pull/push and release sequences in the live simulator. Reports and a
scene screenshot are saved under `review-artifacts/g-limiter/`.
Constraint impulses are physical velocity changes and must be included. Their
step-averaged peaks can depend on the physics timestep; they are not certified
real-aircraft crash measurements. Do not clamp or smooth them to hide solver errors.

Body support uses backward-Euler spring/damper compliance with the contact's
effective mass, including the CG arm and rotational inertia. This prevents a
stiff aft-body damper from reversing a light aircraft's contact velocity in one
120Hz step and slamming its nose down. Speculative contact retains signed
clearance rather than applying full damping before the surface is reached.
The penetration constraint remains a last-resort unilateral safeguard.

Gear damage never consumes `gForce`. It uses local contact closing speed,
combined normal/side/drag loads, overtravel, lock state and accumulated damage.
The first-contact damage curve starts at 0.35 at `impact` and reaches 1 at
`collapseImpact`; a fresh leg must not collapse from that speed term below the
configured collapse speed. Other simultaneous overload or existing damage can
still cause earlier failure. These limits are simulator tuning, not F16 or other
aircraft certification data.

Regression checks: `tests/loadFactor.test.js`, `tests/contactCompliance.test.js`,
and `tests/gearDamage.test.js`. The F16 contact regression uses the aft support
geometry and closing speed reconstructed from the November 2026 landing replay;
it checks dissipated energy at 60/120/240Hz rather than an arbitrary G ceiling.
