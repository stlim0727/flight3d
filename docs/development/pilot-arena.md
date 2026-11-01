# Local pilot missions (Discussion #356)

This implements the local, trusted-code portion of the v6 plan in
[Discussion #356](https://github.com/stlim0727/flight3d/discussions/356).
It is unranked. A native Worker is not a hostile-code security sandbox.
Community uploads, server scoring, physiological impairment and visual object
recognition are not enabled.

## Run the physics sweep

Use Node 22.23.2 and `npm ci`, then `npm run test:pilot`. The sweep runs the
production 120 Hz integrator, controls, aerodynamics, engines, gear contacts,
terrain sampling and collision policy without a renderer. Each pilot runs at
5 Hz with exactly 24 physics ticks between observation and command application.
No GPU or software rendering is involved. UI, particles, audio and asset loading
are omitted; physics is not replaced by a second simplified engine.

Default cases are takeoff and landing with mild wind, correlated sensor errors,
and seeds 1–5. Any non-success makes the command fail. The cases and their
thresholds are fixed before evaluating pilots. Available controls:

```sh
PILOT_PROFILE=calm-debug-v1 PILOT_SENSOR_NOISE=0 npm run test:pilot
PILOT_MISSION=landing PILOT_SEEDS=1,2,3,4,5 npm run test:pilot
PILOT_REPORT=/tmp/pilot-report.json npm run test:pilot
```

`PILOT_PROFILE` can be `calm-debug-v1` or `mild-disturbance-v1`.
Sensor noise is controlled separately in this CLI to permit the four
wind/noise on/off diagnostic combinations. The browser's calm option defaults
to sensor noise off; mild defaults to on. In addition to the sweep, `npm test`
covers exact deadlines, first-contact anchoring, bounce, stop hold, malformed
snapshots, lifecycle cancellation and isolated-thread watchdog behavior.

The supplied examples passed both missions on mild-wind/noisy seeds 1–5 and
the calm/no-noise baseline. See [the acceptance report](pilot-mission-acceptance.json).
Manifests identify this limited calibration as `limited-training-suite-v1`;
it does not certify arbitrary seeds, aircraft, weather or real-aircraft behavior.
A separate integration test runs both missions through the actual isolated
JavaScript-thread pilot runtime and asynchronous runner, with production physics.
The standalone sweep evaluates synchronous SDK hooks; it does not itself test
the Worker transport. A passing logic suite/build alone is not a flight sweep.

## Opt-in browser laboratory

Start Vite and open `/?pilotArena=1`. Choose a mission, wind profile and seed,
load an example or a trusted local `.js` file, and run it. Nothing is uploaded.
The expandable panel includes an editor, result metrics, a 2D runway trace and
downloadable run data. Ordinary game URLs keep their existing behavior.

Pause and browser background hold the attempt without advancing judged ticks
or the wind clock. Leaving flight for the lobby, external aircraft/preset/airport
changes, or explicit manual takeover abort the attempt. Starting a mission
replaces the current flight with the selected B738/coastal or F16/Lukla scenario.
Mission preparation calls explicitly identify themselves so they do not trigger
the external-change cancellation path. While active, the asynchronous runner
owns physics advancement; the animation loop continues rendering and does not
also integrate physics.

Playback defaults to 1×: unchanged 120 Hz physics steps are paced against wall time, yielding to display frames. Worker stalls can make playback slower; physics steps and reaction-delay ticks are never skipped. Deadlines more than 50 ms overdue are rebased so stalled wall time does not become a fast-forward burst. Fast evaluation retains one frame per decision interval. The displayed clock is simulation time.
Worker wait consumes wall time only. Prepared controls are held during the
initial 24-tick delay. Mission failure is terminal; subsequent visual behavior
cannot turn it into success.

## Pilot API

```js
export function createPilot(api) {
  return {
    reset(briefing) {},
    onTick(observation) {
      return { elevator: 0, aileron: 0, rudder: 0, throttle: 0.5, brakes: 0 };
    }
  };
}
```

Hooks are synchronous. Pilot state persists in the instance. Every run starts
a new instance; asynchronous hooks and external imports are unsupported.
`api.random()` is a deterministic guest stream, independent of hidden sensor
and environment seeds; `api.log()` is bounded. Runtime/startup faults terminate
the Worker. All five axes are required and finite; surface axes use -1..1 and
throttle/brakes 0..1. Validation is atomic. Existing physical response limits
remain in the control path.

`PilotPerception.js` defines the allowlisted flat host-snapshot contract and
sensor units. Available observations are instruments, training-navigation
deviations, actuator feedback and debounced weight-on-wheels. Continuous values
use `{status, mean, std, sampleTick}`; unavailable values have null mean/std.
Navigation deviations are explicit training equipment, not synthetic vision.
No raw simulator objects, world coordinates, hidden seeds or exact mission state
are passed to the pilot. Visual contacts are disabled.

Gear, flaps, trim, spoilers and reversers are fixed by the mission. Activating
another controller or changing that configuration ends the run. Throttle is
explicitly retained on release, while surface virtual targets and brakes are
released; this is a deterministic handover policy, not an automatic safe landing.

## Validation boundaries

The rendererless sweep validates implemented numerical flight behavior, not
real-aircraft fidelity or the browser panel's visual layout. Worker scheduling
and timeout behavior have separate tests. Following the user's direction, GPU
rendering is not an acceptance dependency for this physics/algorithm feature.
The browser UI remains opt-in until its interaction and layout have been checked.

Future work: validate additional scenarios and held-out seeds, restricted guest
runtime, authoritative evaluation, configurable physiology and visual contacts.
See [pilot wind](pilot-wind.md) for the physical-disturbance audit and model.

## Direct live cases

The [flight URL directory](../flight-urls.md#ai-pilot-mission-selector) selects one built-in case at a time. `pilotArena=1&pilotCase=landing-mild-3`, for example, selects the landing pilot, mild disturbances and seed 3, waits for startup readiness, then starts 1× playback. Only known built-in case IDs autostart; links cannot supply executable source. Backgrounding the browser aborts the active mission to prevent invisible simulation or catch-up bursts.

## F-16 Lukla valley

The [valley mission plan](f16-valley-pilot.md) defines its fixed start/finish, virtual terrain-range sensor, ordered gates and distance-weighted altitude objective. Select the valley mission in the directory or local console. `npm run test:valley` executes its real-DEM production-physics sweep without a renderer. It permits avoidance climbs and rewards returning low; it is a game-model challenge, not real F-16 terrain-following validation.

## Shared F16 valley mission (#382)

Open `/?pilotArena=1`, choose **F-16 루클라 계곡 저공**, and read the route
briefing. Choose **사람** for ordinary keyboard/HOTAS/touch flight controls or
**AI** for a trusted SDK pilot. Human mode always uses real-time pacing. The
panel collapses when human flight starts, leaving the common navigation HUD
visible. Expand it to abort, inspect the briefing, export the run or see results.

Both modes use `ValleyMissionAdapter.prepare`, the production integrator and
`ValleyMission`; the arena runner is the sole physics owner in either mode.
There is no AI-to-human continuation of a scored run: stop aborts the old attempt
and releases controls; a human scored run requires a fresh start. Fixed gear,
flaps, trim, spoilers and reversers apply equally. Pause/background hold time,
while reset, aircraft/airport changes and leaving flight end the attempt.

The chart uses the same static course as the SDK briefing. It shows local east/
south coordinates, ordered waypoints, departure and final crossing direction;
it has no live truth-position marker or terrain predictions. Navigation HUD
values come directly from the exact observation delivered to the AI: next-gate
and final-destination absolute bearing/range plus gate index, at 5 Hz using the
same seed and correlated errors. `gate-finish-bearing-range-v2` identifies this
aid. The HUD is navigation equipment, not obstacle detection.

The scoreboard stores the most recent 200 terminal attempts in this browser's
localStorage. It is local/unranked, with no server or shared online ranking.
Human/AI identity, rules/terrain versions, environment/sensor seeds and noise,
navigation profile, fixed/spawn configuration, source hash (AI), gates,
duration and AGL diagnostics are recorded. Failed/aborted attempts retain null
altitude cost; only successful attempts have a comparable lower-is-better cost.
After a run, the board filters to exactly matching conditions. On initial load
it labels the list as all conditions, without a cross-condition rank. Storage
failure is shown and does not stop flight; the run can still be downloaded.

`tests/valleySharedMission.test.js` covers isolated Worker completion, 24-tick
AI delay, bounded observations, human input ownership, held ticks/wind,
abort/restart, shared navigation and local persistence. `npm run test:valley`
runs the synchronous production-physics sweep. The exact current six-case
results are in [f16-valley-acceptance.json](f16-valley-acceptance.json). Mild/noisy
seeds 1–5 and calm/no-noise seed 1 complete all six gates. Costs are 263.16–279.92 m
for mild and 263.36 m for calm; median AGL is 283–304 m. A steeper recovery descent
slightly improves the preserved baseline, but the example remains conservative
and does not demonstrate sustained ultra-low flight. No course, terrain or
physics thresholds were relaxed.

### Browser acceptance (2026-11-01)

Chrome 156.0.8078.73 on hardware ANGLE/Vulkan Intel Graphics ADL-N passed
`scripts/verify-browser-gpu.mjs`: accessible renderD128, WebGL2 shader center
pixel `[255,0,0,255]`, GL error 0. The same isolated browser then verified:

- Human keyboard elevator input with no virtual-input target; pause and
  background held mission ticks; resume advanced them; preset reset recorded an
  aborted human attempt with no score and released control.
- AI mild/noisy seed 1 completed all six gates, cost 279.218326 m; every applied
  command retained 24 ticks of delay. HUD text exactly matched the shared
  navigation observation, with gate indices 1–6 across the flight.
- Desktop 1440×900 briefing chart and mobile 390×844 flight/navigation views
  were captured and inspected. Human start collapsed the panel and retained
  navigation visibility. This was viewport/layout evidence, not native touch or
  HOTAS device acceptance. A human full-course completion was not performed.
- Human failures/aborts and AI success appeared in local storage; page reload
  preserved the records. Obscura separately checked the ordinary URL selector,
  Hangang's dependent C172 selection, and valley gameplay/source links.

Final local gate: Node 22.23.2, `npm run check` (491 JavaScript files / 14 pinned
action references), `npm test` (1077 passed), `npm run build` passed. These are
local results; CI and deployment must be checked independently on the PR.
