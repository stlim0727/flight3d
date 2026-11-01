> Historical WIP handover at 122bb4b. Follow-up implementation and current verification: [shared mission documentation](pilot-arena.md#shared-f16-valley-mission-382) and [current sweep results](f16-valley-acceptance.json).

# Handover: F16 Lukla valley mission and shared human/AI scoring

Status: work in progress, not merged or deployed. Original context:
https://github.com/stlim0727/flight3d/discussions/356

## User requirements

- Replace exhaustive URL tables with ordinary dependent selectors, displaying
  only the selected gameplay link and pilot source link.
- Implement an ambitious F16 (not Cessna) Lukla valley low-flight mission.
  Choose meaningful start/finish positions; climb when terrain requires it,
  then return low. Define observations before relying on them.
- Use rendererless production-physics sweeps; no GPU needed for these checks.
- Latest addition: let a human fly exactly the same mission, judged by the same
  criteria as AI, and record both in a scoreboard.
- User requested this handover issue before completion. Do not treat WIP as shipped.

## Preserved implementation

Branch: `feat/f16-valley-pilot`; worktree: `/workspace/flight3d-f16-valley`.

- `src/flightLinks.js`, `flights.html`, `src/config/flightLinkSelection.js`:
  terrain/aircraft/scenario and pilot/environment/seed selectors; removed huge
  tables. Pilot examples use bundled source-file URLs.
- `src/arena/valleyCourse.js`, `ValleyMission.js`: frozen route and pure evaluator.
- `src/pilot/TerrainPerception.js`: bounded forward terrain point-ray observations.
- `src/arena/ValleyMissionAdapter.js`, `PilotMissionAdapter.js`: actual Lukla DEM,
  F16 configuration/spawn, wind, navigation observations, adapter routing.
- `MissionRunner.js`, `PilotProtocol.js`, `PilotPerception.js`,
  `src/ui/PilotArenaPanel.js`, `src/config/pilotCases.js`: mission integration,
  briefing contract, instruments, selectable calm and five mild cases.
- `src/pilot/examples/valley.js`: SDK-only terrain-aware controller; static route
  plus noisy gate bearing/range, bank-aware ray interpretation and lookahead.
- `tests/helpers/valleyFlight.js`, `scripts/test-valley-pilot.mjs`:
  rendererless harness using actual production physics/DEM, not another model.
- See `f16-valley-pilot.md` for the implementation plan and observation contract.

The shared F16 model has excess idle thrust at the spawn speed. Adapter accepts
its feasible idle-limited trim and preserves actual acceleration. It does not
modify engine thrust, terrain, physics or mission rules to force completion.

## Frozen mission

Airborne start: local world x=-1700, z=500, 120 m AGL, 220 KIAS, heading183.18°.
Finish: x=-3100, z=6000; approximately5.728 km. Ordered intermediate gates:
(-1750,1400), (-2100,2200), (-2450,3000), (-2550,3900), (-2850,4800).
Coordinates are metres east/south, not latitude/longitude. The course follows
terrain west of the airport; finish has approximately1 km recovery space.

Rules: ordered gate-plane crossings within200 m, corridor half-width400 m,
minimum clearance20 m, IAS160–320 kt, timeout120 s; no contact/damage/crash.
There is no ceiling prohibiting a necessary climb. Successful flights minimize
`0.7*mean(excessAGL) + 0.3*P95(excessAGL)` over first-crossed25 m progress bins,
where `excessAGL=max(0,AGL-50m)`. Lower cost is better. Failure cannot earn a
successful altitude score. Max/median/min AGL and duration are diagnostics.

Terrain is the bundled Copernicus DEM, grid spacing42.97 m. This is a game-model
challenge, not a surveyed obstacle-clearance or real F16 operating procedure.

## Observation boundary

5 Hz decisions,120 Hz physics,24-tick command delay. No live world position,
quaternion, velocity vector, terrain callback or heightmap is sent to the guest.
Public static route coordinates are navigation-chart information.
Instruments include IAS/TAS, attitude/heading, radio altitude, VSI and body rates.
Navigation provides noisy absolute gate bearing/range and active gate index.
Virtual terrain sensor:84 body-relative point rays, ±60° azimuth,
-35°..25° elevation,2000 m range, nearest sampled surface, seeded correlated
noise2 m+3%. Available, clear-to-range and unavailable are distinct.
A clear point ray does not prove the whole sector clear;20 m marching can miss
thin geometry. Do not claim visual perception or real sensor fidelity.

## Verification and known limitation

Controller calibration agent reported calm completion and mild/noisy seeds1–5
completion after commit8428f18 (integrated ased4a72a). Root rerun: focused tests23/23 passed; mild/noisy seeds1–5 completed6/6 gates each; calm/no-noise seed1 completed. See `f16-valley-handover-results.json` for exact metrics. Earlier controller failed course/floor constraints;
rules were not loosened. Current successful baseline is too high for the intended
ultra-low challenge: agent reported median AGL roughly294–312 m and max415–444 m.
Safe completion is not proof of good low-altitude performance.

Do not claim full check/test/build, isolated Worker acceptance, browser visual
acceptance, deployment or CI unless the corresponding result has been observed.
The earlier full gate was started, but its log/session did not survive environment
continuation; its result is unknown. Browser visual acceptance has not been run.

## Next implementation steps

1. Complete the isolated Worker end-to-end F16 mission test using PilotHost,
   MissionRunner, PilotThreadWorker and createValleySimulation. Assert completion,
   unchanged24-tick delay, bounded observations and release/manual handover.
2. Add human control mode. Reuse the same prepare/spawn, fixed configuration,
   seeded environment and ValleyMission evaluator. Use normal rendered physics
   with human inputs, not virtual AI inputs; ensure exactly one physics owner.
   Pause/background must pause judged simulation time. Manual abort/reset ends
   the attempt; never turn an aborted AI run into a scored human completion.
3. Add a shared scoreboard of completed attempts with explicit human/AI identity,
   mission/rules/terrain versions, environment profile/seed, result/failure,
   altitude cost (lower is better), duration, gates, AGL diagnostics, and AI source
   hash where applicable. Compare matching conditions. Preserve failed attempts
   as failures, never substitute a zero score. Start with local persistence and
   label it local/unranked; shared online ranking/storage is not implemented or
   designed yet. User asked for a scoreboard, not a specific backend.
4. Improve descent/recovery of the pilot using only observations, retaining course
   and evaluator. Keep a passing baseline; report both completion and altitude.
5. Run focused tests and calm/noisy production sweeps. Add meaningful human-mode
   lifecycle tests (same evaluator, one physics owner, pause/abort/reset, recording).
   Run Node22.23.2 `npm run check`, `npm test`, `npm run build` for final code.
6. Fetch latest main, inspect diff for unrelated deletions, resolve concurrent
   changes without overwriting them; preserve mobile panel/debug features.
   Push and open focused PR(s) when actually ready. Do not merge without `mac`.

Useful commands (Node22.23.2):

```sh
npm ci
node --test tests/flightLinkSelection.test.js tests/pilotCases.test.js tests/terrainPerception.test.js tests/valleyMission.test.js tests/valleyPilot.test.js tests/valleyAdapter.test.js
npm run test:valley
PILOT_SEEDS=1 PILOT_PROFILE=calm-debug-v1 PILOT_SENSOR_NOISE=0 npm run test:valley
npm run check && npm test && npm run build
```

`PILOT_REPORT=/path/report.json` saves the sweep, including traces and commands.
The native Worker remains trusted-code-only, not a security sandbox.

## Root rerun evidence

Node22.23.2 focused tests:23 passed,0 failed. Mild/noisy sweep:5/5 completed; altitude cost270.79–282.25 m. Calm/no-noise seed1:completed, cost269.65 m, median AGL286.89 m. These are synchronous controller runs, not isolated Worker or browser acceptance.
