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
responsive layouts, retry, insufficient data, menu return and crash termination.
Screenshots, GPU details and results go to `review-artifacts/debrief`. Headless
focus emulation prevents the simulator's background-tab hold during startup.
This is desktop Chrome evidence, not a physical mobile/native share test.
