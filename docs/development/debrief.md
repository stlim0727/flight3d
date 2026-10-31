# Flight debrief

Issue #322's debrief follows the Figma D1–D4 screens: Summary, Flight log,
Share, and insufficient data. The 360px card uses the existing `.btn` primitive.
The backdrop is the live Three.js scene; the chart uses recorded observations
instead of the design's example curve.

End flight is available in the pause menu and held-flight lobby. A recorded
sortie also ends on a crash, or after a qualifying touchdown followed by three
seconds on the ground below 1 kt ground speed. Completed flights cannot resume.
Fly again restores that sortie's metadata and respawns it. Main menu returns to
the existing cinematic/menu flow.

## Crash observation (issue #362)

The [crash/recovery UX flow](https://www.figma.com/design/XmTUnPoI13ISmLJABHx2Bo/Flight3d?node-id=107-86)
specifies **impact → three seconds of crash scene → accident debrief**. At the
impact tick, finalize the recorded sortie, including that tick's telemetry. Keep
the exterior crash camera, wreckage physics, explosion animation and existing
collapsed crash report visible before opening the debrief once. Observation time
does not extend flight duration, peaks, trajectory or sharing eligibility.

Count the three seconds with foreground rendered frame deltas, not fixed physics
ticks or a wall-clock timeout. Deterministic stepping cannot skip the scene.
Pause/background holds the countdown. Menu entry (including Space/R/Enter),
crash reset and a new sortie cancel the pending automatic transition. Explicit
End flight from a held crashed sortie still opens its finalized accident report.
Developer scenarios and unrecorded cinematic crashes retain their existing flow.
Manual flight completion and the three-second landing-stop criterion are unchanged.

This changes presentation timing, not aerodynamic forces, collision thresholds,
debris integration or camera projection. The existing Three.js crash rig continues
following wreckage in world space until the debrief freezes physics/effects.

## Crash report (issue #365)

The same Figma page's #365 row (D′, D-R′, D-S′, D-E′) adds the collision to a
crash-ended debrief. `FlightRecorder.finish('crash', crashResult)` snapshots the
collision type, localized name and description, impact speed and impact time
(the sortie duration) into `report.crash`; other reports carry `crash: null`.
Name and description keep the language active at impact, like exported text.

- Summary: the headline is the collision name, a crash block shows description,
  impact speed and impact time, and the touchdown block appears only when a
  touchdown was recorded. Short records keep their headline and name the
  collision inside the block; sharing limits are unchanged.
- Flight log: the final event shows the collision name and impact speed, and a
  red marker sits at the last recorded sample.
- Share: copied/shared text adds an impact line; JSON exports are version 2.

Impact speed is the collision detector's world velocity magnitude in knots
(`|v| × 1.94384`), not indicated airspeed. Opening a detailed debrief through an
external URL is tracked separately in issue #368.

## Recording and measurement

`FlightRecorder` observes telemetry after each fixed physics tick and integrates
duration using simulation `dt`. Pause, held menu, terrain waiting, developer
scenarios and debrief time are excluded. Aerodynamic/contact forces are unchanged.
Max altitude, IAS and signed cabin-axis load are accumulated every tick;
trajectory observations normally sample every 0.2 seconds.

- Coordinates are Three.js +Y up, x/z horizontal, in meters. MSL altitude is
  world Y / 0.3048 in ft; pitch, roll and heading are degrees.
- Speed is indicated airspeed in knots. G is the existing integrator measurement
  `nonGravForceWorld · cabinCeilingWorld / (m g0)`, not a separately inferred peak
  impact acceleration.
- Touchdown requires a ground transition after at least 1.5 seconds airborne.
  Ground spawns and short bounces do not create landing events. Positive-down
  contact sink rate in m/s becomes ft/min by `60 / 0.3048`. The last touchdown's
  sink rate and measured G are displayed without an invented landing grade.
- At 18,000 trajectory observations, every other observation is retained and the
  recording interval doubles. First/latest observations and all-tick maxima stay
  available, while long-flight trajectory time resolution decreases.
- Nonfinite observations cannot contribute statistics. Sharing requires at least
  five valid simulation seconds and two observations. Short records are visible
  but cannot be copied or exported.

JSON exports are versioned immutable snapshots containing metadata, units, end
reason, duration, extrema, touchdowns and trajectory. Replay/import is outside
this feature.

## Verification

Run the recorder, game-flow, physics-timing and i18n Node tests, then the normal
repository gate. Tests exercise sampling, between-sample extrema, invalid/short
data, bounded memory, bounce, touch and go, pause/menu exclusion, crash, landing
stop and fresh sortie isolation.

Start Vite and a private hardware Chrome/CDP browser using
[browser-gpu.md](browser-gpu.md), then run:

```sh
CDP_URL=http://127.0.0.1:9432 SIM_URL=http://127.0.0.1:5232/ node scripts/verify-debrief.mjs
```

The script checks a hardware WebGL2 draw/red pixel (including Windows/D3D11),
manual end, tabs, chart selection, clipboard success/failure, downloaded JSON,
responsive layouts, retry, insufficient data, menu return, visible moving wreckage
before delayed debrief, pause exclusion, immutable impact data and crash-menu cancellation.
Screenshots, GPU details and results go to `review-artifacts/debrief`. Headless
focus emulation prevents the simulator's background-tab hold during startup.
This is desktop Chrome evidence, not a physical mobile/native share test.
