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

## Usage

Run the free-play persona from the repo root:

```sh
PERSONA_AIRCRAFT=F16 PERSONA_AIRPORT=valley PERSONA_PRESET=valley \
  PERSONA_DEMO_ROUTE=valley PERSONA_TICKS=60 \
  node scripts/persona-play.mjs
```

Env vars:

| Var | Default | Meaning |
|-----|---------|---------|
| `PERSONA_AIRCRAFT` | `C172` | Aircraft ID (`B738`, `C172`, `F16`) |
| `PERSONA_AIRPORT` | `lukla` | Airport ID (`lukla`, `incheon`, `valley`, `coastal`, `neon`) |
| `PERSONA_PRESET` | `demo` | Lobby preset (`demo`, `valley`, `runway`, `cliff`, ...) |
| `PERSONA_DEMO_ROUTE` | `maneuvers` | Demo route sub-profile when preset=`demo` |
| `PERSONA_TICKS` | `40` | Number of 1-second sample ticks |
| `PERSONA_ARTIFACTS` | `.tmp/persona-play` | Output directory |

The script launches Chrome via `scripts/lib/browserHarness.mjs`, configures the scenario through the simulator's trusted state, flies for `PERSONA_TICKS` seconds, runs `detectTrends` over the collected history, writes `.tmp/persona-play/personas-feedback.json`, and — if anomalies were found — publishes a GitHub issue labelled `persona-anomaly` via `scripts/persona-issue.mjs`.

Hardware GPU acceleration is required for the flight to behave like production (Vulkan via `--use-gl=angle --use-angle=vulkan` per AGENTS.md). Software rendering requires explicit user approval.

## How I play

I run the **`src/persona/flight_persona.js`** persona (imported by the game in browser context) and let it **freely explore**:

- **Lobby UI**: switches tabs (scenario, multi, settings, dev), selects each aircraft (B738, C172, F16), each airport (coastal, incheon, lukla, neon, valley), each preset (takeoff, approach, challenge, cruise, bridge, cliff, valley, demo), the demo route select, time-of-day, pilot mode (human/AI), gyro toggles, replay library, feedback dialog, multiplayer dialog.
- **Flights**: starts new flights, uses the in-flight menu toggle, pausing/restoring via ESC menu, camera switching, ending flights for the debrief overlay.

The persona **randomly selects** which menu tree and scenario to touch on each loop, so it never repeats the same path.

## Anomaly detection (the "give feedback" part)

While flying I **sample the simulator state each tick** (`window.simulator`) and **flag unnatural consequences**:

| Anomaly code | Trigger (game semantics) | Why it is unnatural |
|--------------|--------------------------|---------------------|
| `NON_FINITE` | any sampled field is `NaN` / `Infinity` | physics solver produced undefined values |
| `EXTREME_G` | `gForce > 6` sustained or `> 8` spike | structural overload / impact |
| `GLOC` | G-LOC incident flagged | loss-of-consciousness incident |
| `NEG_ALT` | negative altitude while airborne | terrain penetration |
| `TERRAIN_CLIP` | ground distance < 0 while airborne | mesh penetration |
| `BREAKUP` | `aircraftBreakup.active` true | airframe failure |
| `STEEP_DIVE` | pitch < -30° with VSI < -4000 fpm | unrecoverable dive |
| `STALL` | `hud-stall` banner visible | unexpected stall warning |
| `FALSE_STALL` | stall warning at \|g\| < 1.5 with high airspeed | UI/state mismatch |
| `RAPID_DESCENT` | altitude dropped > 1000 ft over window | abnormal sink rate |
| `SUSTAINED_HIGH_G` | \|g\| > 6 on 3+ samples | sustained structural overload |
| `CONSOLE_ERR` | any `console.error` captured | JS error during flow |

I also read `window.simulator.debriefReport` after a flight ends and pull peaks (`gForce`, `iasKnots`, `altitudeFt`), touchdowns, and `crash` reason.

## Feedback format

The runner writes `.tmp/persona-play/personas-feedback.json`:

```json
{
  "persona": "flight-persona",
  "version": "1",
  "timestamp": "2026-11-13T...",
  "mode": "demo-f16-valley",
  "anomalies": [
    { "code": "FALSE_STALL", "value": 245.3,
      "message": "stall warning at 245 kt with |g| 1.0 — UI/state mismatch",
      "severity": "P2", "source": "persona-sampling", "tick": 23 }
  ],
  "flow": [
    { "step": 1, "action": "configure-scenario", "target": "F16/valley/demo" },
    { "step": 2, "action": "start-flight", "target": "btn-fly" }
  ],
  "flight": { "aircraft": "F16", "airport": "valley", "scenario": "demo", ... },
  "observations": [ { "trajectory": { "maxG": "1.28", "minAltFt": "10335.1", ... } } ],
  "limitations": []
}
```

**Severity rules:**

- **P1** — crash, `NON_FINITE`, `BREAKUP`, `GLOC`, `TERRAIN_CLIP` at speed.
- **P2** — `EXTREME_G`, `NEG_ALT`, `STALL` without input, `FALSE_STALL`, `UI_MISSING`.
- **P3** — `CONSOLE_ERR`, minor telemetry surprises.

## What I do not do

- I do not submit to GitHub; I return the JSON in chat.
- I do not run CI; I state browser/GPU limits explicitly.
- I never execute untrusted PR code; I only drive the **local** game.

## Limitations

- Depends on GPU-enabled Chrome (Vulkan) so physics evidence matches production; software rendering weakens evidence.
- Sampled ticks (default 40×1s) may miss transient events; raise `PERSONA_TICKS` for longer coverage.
- Reports anomalies to GitHub only if `publishAnomalyIssue` is reachable (auth/token present); otherwise the JSON is written locally.