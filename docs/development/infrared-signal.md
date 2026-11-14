# Relative IR observation signal

First IR signal-model increment for [issue #713](https://github.com/stlim0727/flight3d/issues/713).
The default IR gate in `MissileSeeker` now uses emitter state, aspect and distance
instead of constant quality 1. It drives existing confirmation, finite memory,
loss and reacquisition; it does not prescribe hits, misses or flare success.

## State and evidence boundary

Live bandits publish `infraredSignature` after each physical step and on respawn:

- `enginePower`: actual spooled N1 normalized between configured idle and maximum.
- `heat`: the engine model's lagged EGT normalized from 15 to 850 °C.
- `afterburner`: explicit continuous 0..1 `infraredAfterburnerLevel` input.
- `omnidirectional`: false for live aircraft, which use their physical attitude.

N1/EGT come from the existing engine model. The normalization and emission mapping
are **simulation assumptions**. EGT is not an aircraft skin temperature or a
measured narrow-band radiance. This model does not use the Stefan–Boltzmann law
or claim radiometric units. A throttle command alone cannot change the signature;
engine spool and EGT response must advance. A failed engine stays warm while its
existing physical states decay. Respawn replaces those states and clears AB input.

The engine currently has **no independent afterburner dynamics or player AB
control**. Live AB input therefore defaults to zero. Explicit AB fixtures test
signal response without inventing a throttle threshold or changing thrust/fuel
physics. Connecting a real future AB state remains separate propulsion work.
Multiple engine state inputs are averaged; this is not calibrated multi-engine
aircraft radiometry. Kinematic `BanditTarget` fixtures explicitly default to a hot
omnidirectional signature; they do not represent actual patrol engine states.
Other contacts lacking valid signature/attitude fail closed rather than silently
receiving ideal IR quality.

## Relative signal equations

All emission, received signal and quality values below are dimensionless. Distances
are metres. With `p = clamp(enginePower)`, `h = clamp(heat)`, `b = clamp(afterburner)`:

```text
rear = (1 - dot(target forward, target-to-observer direction)) / 2
aspect = 0.2 + 0.8 * rear²
emission = 0.08 + 0.2*h + h * (p² + 3*b*p) * aspect
received = (emission / 1.28) * 4000² / max(range², 1)
quality = received / (1 + received)
```

Forward is local `-Z`. A rear observer has dot=-1, giving maximum plume visibility;
a frontal observer has dot=+1. The hot-body/floor terms are isotropic in this model.
The 1 m range softening lies below the seeker's existing minimum geometric gate.
Quality remains finite/bounded, while the existing threshold (0.25) decides whether
an observation qualifies. Current 28°/65° cones, maximum range and LOS gates still
apply before the signature is sampled.

The compact-source free-space inverse-square shape is supported by NASA's
[electromagnetic propagation discussion](https://science.nasa.gov/learn/basics-of-space-flight/chapter6-1/)
(checked 2026-11-14). That source does **not** validate this engine proxy, aspect
curve, relative floor, gain 3, reference emission 1.28, 4 km normalization or
quality threshold. All are explicit model constants in `InfraredSignal.js`.
No actual AIM-9X acquisition distance, detection probability or countermeasure
resistance is established. Atmospheric absorption, background contrast, sensor
spectral response/noise and target discrimination remain outside this increment.

## Channel integration and controlled comparisons

The default IR path uses this model; default active radar remains ideal quality 1.
`world.seekerSignalQuality(...)` remains an **explicit complete override** for
controlled sensor fixtures/extensions. It is not silently multiplied into the IR
model. Callers choosing that override must provide the observation policy they
intend. The aircraft dynamics are unchanged by the signal model.

Missing/invalid signature data returns quality 0. Diagnostics are cleared before
an invalid result, preventing a stale valid-looking sample. Terrain visibility
is checked before the IR source state is read; guidance still consumes only the
seeker's copied/predicted estimate when observations are lost.

The locked-launch comparison helper now returns `terminal: 'no-lock'` and
`launched: false` if a rail lock cannot be obtained. That is an unattempted launch,
not a fired missile miss. Player Maddog firing remains available as before.
`compareMissileEnergyEnvelope({ idealSensor: true })` explicitly isolates the
previous aerodynamic experiment from signal acquisition. Its records are labeled
`sensorModel: 'ideal-fixture'`; the default is the actual IR model.
The generic `verify-f16-missiles.mjs` rail/HUD/director/FX smoke also opts into an
explicit ideal signal override; it does not certify default IR acquisition.

At this change's acceptance, the original 18 default comparisons produce six hits
and 12 no-lock cases; the expanded 24 default comparisons produce 14 hits and ten
no-lock cases. The explicitly ideal-sensor energy control remains 20 hits and four
lifetime expiries. These are different observation conditions, not a new real-world
kill-rate estimate or evidence of 12 successful evasions. Results depend on the
assumed IR constants and the short acquisition window in the test launcher.

## Verification

```sh
timeout --signal=TERM --kill-after=5s 30s node --test tests/infraredSignal.test.js tests/missileSeeker.test.js tests/missileFlightModel.test.js
timeout --signal=TERM --kill-after=10s 180s env GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless ARTIFACT_DIR=.cache/infrared node scripts/verify-missile-seeker.mjs
```

The held-pose IR fixture begins with a hot rear track, reduces power/heat to cause
memory then loss, exposes a hot but frontal emitter that remains untracked, then
uses an explicit bright AB input to require confirmation before reacquisition.
The radar channel remains tracked throughout. Other checks cover inverse-square
received signal, smooth aspect/power/heat/AB changes, invalid data, live engine
spool/failure cooling and respawn. Synthetic input changes in the fixture are not
claims that a real engine can cool instantly.

Acceptance on 2026-11-14: 84 focused tests passed. Hardware Chrome 156.0.8078.73 /
Intel ADL-N Vulkan passed shader pixel `[255,0,0,255]`, GL error 0, the IR sequence,
six existing terrain sequences, default launch comparisons and production-mesh
drawing (5,880 non-background pixels). Reports/screenshots are local under
`.cache/infrared/`. This is numerical/model-level rendering evidence; the full
simulator scene and a human-flown IR defense sortie are not claimed as tested.
