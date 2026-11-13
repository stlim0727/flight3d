---
name: flight-persona
description: Free-play persona: fly Flight3d, explore UI and scenarios, detect unnatural consequences (crashes, NaN physics, G-LOC, airframe breakup), and give structured feedback.
---

# Flight Persona — free play with anomaly detection

Use this skill when you want to **freely play the Flight3d simulator** (not review a PR) and report what actually happened, including unexpected or unnatural consequences.

## When to use

- Test aircraft behavior in real flight.
- Explore UI menu trees and flows.
- Reproduce a reported crash/physics issue.
- Do exploratory "adversarial" play to surface defects.

## Setup

Run the runner; it starts Vite and a headless Chrome session itself:

```sh
node scripts/persona-play.mjs
```

It defaults to the C172 on the Neon Metropolis bridge flight (issue #690), samples for
40 s, writes `.tmp/persona-play/personas-feedback.json`, and prints the report. Override
the flight with `PERSONA_AIRCRAFT`, `PERSONA_AIRPORT`, `PERSONA_SCENARIO`,
`PERSONA_DEMO_ROUTE`, `PERSONA_TICKS`, and `PERSONA_INTERVAL_MS`. Anomalies are only
published as GitHub issues when `PERSONA_PUBLISH=1` is set. The demo route defaults to
`canyon-slalom` when that profile exists, otherwise to the first available profile; an
explicit `PERSONA_DEMO_ROUTE` that the selected aircraft/airport does not offer aborts the
run and lists the available profiles.

Browser/WebGL scenarios require a hardware GPU (see
[`docs/development/browser-gpu.md`](../../../docs/development/browser-gpu.md)). The runner
refuses to sample when `detectGpuAngle()` is not `vulkan`, or when the page reports a
software/unknown renderer. Software rendering needs explicit task approval and is enabled
only with `PERSONA_ALLOW_SOFTWARE_GPU=1`, which also records the limitation in the report.

## How I play

I run the **`src/persona/flight_persona.js`** persona (imported by the game in browser context) and let it **freely explore**:

- **Lobby UI**: switches tabs (scenario, multi, settings, dev), selects each aircraft (B738, C172, F16), each airport (coastal, incheon, lukla, neon, valley), each preset (takeoff, approach, challenge, cruise, bridge, cliff, valley, demo), the demo route select, time-of-day, pilot mode (human/AI), gyro toggles, replay library, feedback dialog, multiplayer dialog.
- **Flights**: starts new flights, uses the in-flight menu toggle, pausing/restoring via ESC menu, camera switching, ending flights for the debrief overlay.

Each runner invocation flies one lobby configuration end to end; pass different `PERSONA_*` values to explore another aircraft, airport, or scenario. Sampling begins only after the requested sortie is verified: the start hold is released, the game flow is in `FLIGHT`, the recorder is active, and its aircraft/airport match the lobby choice. A start that returns to the lobby aborts the run instead of sampling the previous scene.

## Anomaly detection (the "give feedback" part)

While flying I **sample the simulator state each tick** (`window.simulator`) and **flag unnatural consequences**:

| Anomaly code | Trigger (game semantics) | Why it is unnatural |
|---|---|---|
| `NON_FINITE` | any sampled field is `NaN` / `Infinity` | physics solver produced undefined values |
| `EXTREME_G` | `gForce > 8` sustained or a spike beyond the aircraft's G-limit envelope | structural overload / terrain or water impact |
| `GLOC` | `telemetry.pilot?.isGLOC` becomes true | loss-of-consciousness incident on the runway |
| `NEG_ALT` | `altitudeFt < -200` ft MSL while airborne | implausibly deep below the sea-level reference |
| `TERRAIN_CLIP` | `radioAltFt < 1` ft above the terrain while `onGround === false` | mesh penetration |
| `BREAKUP` | `sim.isCrashed` true or `aircraftBreakup.pieces` non-empty | airframe failure |
| `STALL` | `hud-stall` banner visible | unexpected stall warning |
| `UI_MISSING` | an expected lobby/flight ID is not attached when it should be | menu tree broken |
| `CONSOLE_ERR` | any `console.error` captured from the page (clipped to 400 characters, never dropped) | any JS error during the flow |

`altitudeFt` is height above mean sea level; `radioAltFt` is height above the terrain.
Neon Metropolis canal flights are legitimately below sea level (the water sits at
-14 m), so negative MSL altitude alone is not a clip (#690).

I also read `window.simulator.debriefReport` after a flight ends and pull peaks (`gForce`, `iasKnots`, `altitudeFt`), touchdowns, and `crash` reason. While the sortie is
still active there is no debrief yet, so the summary falls back to the live
`flightRecorder` counters (elapsed time, peaks, G-LOC incidents, recorded touchdowns).

## Feedback format

I return a **JSON feedback object** so it can be saved/linked:

```json
{
  "persona": "flight-persona",
  "version": "1",
  "timestamp": "2026-11-13T...",
  "cdpUrl": "...",
  "mode": "explore",
  "anomalies": [
    { "code": "EXTREME_G", "value": 9.4, "aircraft": "B738",
      "airport": "coastal", "message": "...", "severity": "P1|P2|P3" }
  ],
  "flow": [
    { "step": 1, "action": "select-aircraft", "value": "B738" },
    { "step": 2, "action": "select-airport", "value": "lukla" },
    { "step": 3, "action": "start-flight", "preset": "rwy" }
  ],
  "flight": {
    "aircraft": "B738", "airport": "lukla", "scenario": "rwy",
    "durationSec": 120,
    "peakG": 50.25, "peakIas": 320, "peakAltitudeFt": 6000,
    "touchdowns": [{ "timeSec": 119, "sinkRateFpm": 600, "contactG": 2.9 }],
    "glocIncidents": 0,
    "endReason": null,
    "demoRoute": "canyon-slalom",
    "crash": null
  },
  "settings": {
    "aircraft": "F16", "airport": "lukla", "scenario": "demo",
    "demoRoute": "canyon-slalom", "ticks": 40, "intervalMs": 1000
  },
  "observations": [ "...", "..." ],
  "limitations": [ "...", "..." ]
}
```

**Severity rules:**
- **P1** — crash, `NON_FINITE`, `BREAKUP`, `GLOC` on ground, `TERRAIN_CLIP` at speed.
- **P2** — `EXTREME_G`, `NEG_ALT`, `STALL` without input, `UI_MISSING`.
- **P3** — `CONSOLE_ERR`, minor telemetry surprises, visual-only glitches.

## What I do not do

- I do not submit to GitHub by default; I return the JSON in chat unless `PERSONA_PUBLISH=1` is set.
- I do not run CI; I state browser/GPU limits explicitly.
- I never execute untrusted PR code; I only drive the **local** game.

## Limitations

- Depends on a GPU-enabled Chrome (Vulkan) for the flight to behave like production; the
  runner aborts without one unless a software run was explicitly approved.
- Random exploration may miss a particular code path; report any specific failure to me and I will run a targeted flight for it.