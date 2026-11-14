# Missile observations and finite track memory

Follow-up to [missile energy](missile-energy.md) and
[issue #713](https://github.com/stlim0727/flight3d/issues/713). Each missile owns a
`MissileSeeker`; guidance consumes its copied/predicted estimate, not the live
target object. This is bounded sensor infrastructure, not validated IR/radar
hardware performance or completion of the S3-2 sensor contract.

## Observation and state

`seekerCanObserve()` checks live contact, range, observer attitude, cone and terrain
LOS. It retains the existing 28° prelaunch cone, 65° airborne gimbal and 8.5 km
range. Terrain height is sampled every <=150 m, including endpoints. Nonfinite
terrain rejects observation; missing terrain means a clear-space fixture. Narrow
unsampled ridges, buildings, clouds and material properties remain unmodeled.

Geometry necessarily reads truth inside the observation gate. Only confirmed
visible measurements copy target position/velocity into the guidance estimate.
Hidden velocity is not sampled. The actual target reference remains available
for camera presentation and physical collision, never directly for PN guidance.

| State | Information available to guidance |
| --- | --- |
| `search` | No estimate. |
| `acquire` | Visible candidate awaiting continuous confirmation; no estimate yet. |
| `track` | Confirmed visible position/velocity copied each step. |
| `memory` | Last observed position extrapolated at stored constant velocity. |
| `lost` | Memory expired; no new PN/gravity-compensation demand. |

| Explicit simulation assumption | IR / AIM-9X | Active radar / AIM-120C |
| --- | --- | --- |
| Acquisition and reacquisition confirmation | 0.15 s | 0.25 s |
| Last-observation memory | 0.6 s | 1.5 s |
| Minimum normalized signal quality | 0.25 | 0.25 |

These are model assumptions, not manufacturer data. An optional world callback
`seekerSignalQuality({ type, observer, target, rangeM })` provides independent `IR`
and `ACTIVE_RADAR` observation inputs to both the rail and airborne gates.
Absent the callback, quality is an idealized 1; nonfinite/below-threshold quality
is rejected. The callback should be pure. This does not implement heat signatures,
RCS, clutter, flares/chaff, sensor noise or radar emissions. The active-radar
profile is autonomous from release; midcourse data links and activation timing
remain separate work. Visible velocity is still an ideal measurement.

A completed rail lock seeds a missile only after a fresh visibility check.
An unlocked launch must confirm a visible candidate. A visible established track
has priority; otherwise the nearest observable candidate is considered.
Interrupted glimpses and different targets cannot share confirmation time.

Terrain/range/cone/signal loss starts memory. Reappearance requires confirmation
again, while memory continues to age. Predicted guidance still respects ordinary
closure/gimbal checks. After expiry the flight plant unloads actuator response;
thrust, drag and full gravity continue. Pause freezes sensor state. Reset/new
missiles have independent fresh state.

## Physical collision and evidence boundaries

The proximity solver checks real live targets independently of acquisition.
A ballistic missile can still hit without a sensor track. This preserves one
terminal detonation/kill path and does not add IFF, safe separation/arming,
multi-target fragmentation or improved fuze timing/damage.

Tests cover visibility gates, malformed geometry, uninterrupted per-target
confirmation, hidden-velocity read protection, memory/reacquisition, pause/reset,
stale handoff and physical impact without acquisition. A paired combat test gives
targets different hidden maneuvers and requires identical missile trajectories.

`scripts/lib/missileSeekerScenario.mjs` compares both types against a controlled
kinematic target with a scripted post-launch ridge: exposed shots remain tracked
and hit; brief masking gives `track → memory → track` and a hit; persistent masking
gives `track → memory → lost` followed by terrain impact. The persistent ridge
affects physical collision too, so that miss cannot be attributed to sensing alone.

```sh
node --test tests/missileSeeker.test.js tests/airToAirMissile.test.js tests/missileFlightModel.test.js
GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless node scripts/verify-missile-seeker.mjs
```

Follow [hardware GPU setup](browser-gpu.md). The dedicated browser check uses a
task-owned watch-disabled Vite server, the hardware WebGL2 shader/readPixels
preflight, the six combat sequences, and the production missile mesh at an actual
memory-state pose. It checks non-background drawing pixels and captures a screenshot
plus JSON under `.cache/missile-seeker/`. This is model-level rendering/numerical
evidence, not the full simulator scene, a rendered terrain ridge, a human defensive
sortie or a real-world probability-of-kill measurement. The earlier full-scene
verification timed out and is not claimed as passing for this change.

Recorded recovery-build validation on 2026-11-14: 78 focused tests, syntax/action
checks and production build passed. Chrome 156.0.8078.73 used Intel ADL-N Vulkan;
the WebGL2 preflight pixel was `[255, 0, 0, 255]` with GL error 0. All six combat
sequences passed, and the production mesh drew 5,880 non-background pixels at
a sampled memory-state pose, also with GL error 0. This does not claim the
earlier timed-out full simulator scene check passed.
