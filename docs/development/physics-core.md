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
