# Bandit threat response and evasion

Implements the first bounded pilot-response item from
[issue #713](https://github.com/stlim0727/flight3d/issues/713).
This is a trial sensor model plus an aircraft pilot, not a verified F-16 warning
suite or a claim that missile hit probability is now realistic.

## Observation and response contract

`src/weapons/BanditThreatResponse.js` provides a deterministic, idealized
omnidirectional optical plume-warning fixture. It observes live, burning missiles
within 4,000 m whose measured relative range closes by at least 50 m/s. Terrain
height is sampled along the sightline at intervals no larger than 150 m. A track
must remain observable for 0.65 s before the pilot responds; observations of
different missiles do not share confirmation time. The smallest observed
range/closure ratio selects the track when multiple plumes are visible.

All thresholds are **simulation assumptions**, not published equipment data.
The fixture reads position, velocity and burning state to stand in for idealized
optical tracking. It never reads missile target identity, seeker lock or predicted
future trajectory. A plume approaching a different aircraft can still cause a
warning. This is intentionally not an aircraft radar/RWR warning and adds no
fictitious radar emissions for an IR launch.

This first model omits optical noise, real sensor field of view/signatures,
cloud/building occlusion and real missile-approach-warning hardware. Sampling can
miss narrow terrain features. Coasting missiles are not newly detected, even if
they are dangerous. Loss of observation retains the last confirmed escape course
for 3 s; unseen missile state does not update that course.

The response phases are `patrol`, `detect`, `evade` and `recover`. After track
confirmation the pilot requests a horizontal course perpendicular to the observed
bearing, choosing the closer turn direction at encounter start and retaining that
side to prevent flip-flopping. Near-vertical bearings retain current horizontal
course. The response blends in with a 0.45 s time constant and out with 1.5 s;
speed demand blends toward at least 250 m/s. These are pilot-command assumptions,
not guarantees that a particular turn defeats a missile.

`BanditTarget` passes heading, speed and terrain-clearance altitude demands to
the existing `BanditFlightModel`. No position/velocity changes, extra forces or
new aerodynamic coefficients are introduced for evasion. The shared F-16 plant
still determines bank, load, damage, available lift, speed and terrain impact.
Its pilot reserves lift margin and commands at most 7G; the actual response is
not prescribed by a scripted animation. After memory expires the original orbit
guidance resumes gradually. Respawn clears track confirmation, memory and response;
the combat system's zero-delta pause freezes them and reset removes the actors.

Default combat-spawned bandits enable this behavior. Controlled baseline callers
can use `new AirToAirMissileSystem({ banditEvasion: false })`, or
`new BanditTarget({ ..., evasion: false })` for an explicitly added patrol target.
Non-orbit ballistic fixtures retain their previous behavior. The setting is a
constructor-level test/control option, not a new user-facing difficulty toggle.

## Repeatable comparisons and limitations

`scripts/lib/banditEvasionScenario.mjs` compares paired patrol/evasive targets
from the same initial conditions: 3,000 m altitude, 180 m/s patrol, a locked AIM-9X
launch from a stationary-position test launcher with 250 m/s inherited velocity,
three initial offsets (tail/head/beam) and 1,800 / 3,500 / 5,500 m separation.
The launcher points at the target during acquisition. The aspect names describe
initial geometry, not a promise that a turning patrol retains that aspect.

Each run records hit or expiry/terrain termination, time to termination, first
reaction, sampled minimum separation and maximum load. Sampled separation is an
end-of-step diagnostic, not the substep closest-approach fuze distance.

Initial Node comparison: **9/9 patrol shots and 9/9 evasive shots hit**. Eight
evasive cases reacted and seven changed termination time by more than 0.01 s.
The 5,500 m tail shot did not provide enough visible plume time to confirm before
burnout. This establishes observable, physical reaction, not a reduced or
real-world-calibrated hit rate. The existing ideal missile guidance, fixed 35G
authority and simplified damage remain separate follow-up work. No random miss
chance or guaranteed survival is added.

## Verification

Focused logic coverage includes interrupted observations, range/closure/burnout
and terrain rejection, track replacement, finite memory/recovery, pause/reset,
respawn, force-driven trajectory divergence, long-run orbit/altitude recovery,
and the paired launch matrix. Run:

```sh
node --test tests/banditThreatResponse.test.js tests/banditFlightModel.test.js tests/airToAirMissile.test.js
```

For actual rendered aircraft pose and recovery, follow
[browser GPU setup](browser-gpu.md), inspect device access and wrappers, then run:

```sh
GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless node scripts/verify-bandit-evasion.mjs
```

The script runs the hardware WebGL2 renderer/shader/readPixels preflight before
loading the simulator. It advances a controlled real-combat plume encounter,
checks that the scene mesh matches the physical aircraft pose, captures evasion
and recovery screenshots, and runs the paired launch matrix in the browser.
Artifacts go to `.cache/bandit-evasion/` (override with `ARTIFACT_DIR`). Screenshots
hold controlled physics states; they are not an unmodified human-flown sortie.

An existing Vite origin can be supplied with `APP_URL`. If the host exhausts file
watch resources, use a task-owned server with file watching disabled rather than
stopping other tasks' servers. Build and Node results do not substitute for the
hardware browser check. This feature does not implement countermeasures, incoming
hostile launches, a complete sensor model or multiplayer combat ownership.

Recorded acceptance on 2026-11-13: 39 focused tests passed (threat response,
bandit flight, missiles, cannon, RWR and combat replay), along with `npm run check`
and `npm run build`. Hardware Chrome 156.0.8078.73 reported ANGLE / Intel Graphics
(ADL-N) / Vulkan 1.4.335; the shader readback was `[255, 0, 0, 255]` with GL error
0. The controlled scene reacted at 0.65 s, the rendered pose matched physics,
and the target survived the controlled observation/recovery sequence and returned
to patrol. The separate 18-run browser comparison retained the 9/9 versus 9/9
hit result. This is controlled acceptance evidence, not human combat validation.
