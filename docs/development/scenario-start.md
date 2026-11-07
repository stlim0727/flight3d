# Fresh scenario starts

A new flight must not integrate the outgoing flight's pose before the new
scenario installs its position, terrain and aircraft. `FlightStartCoordinator` owns
`startingFlight` across `spawnFlight()`, including the first lazy import of
`PilotArenaPanel`. `applyPendingScene()` delegates a rebuild transaction that
keeps its hold through scene preparation, spawning, the final loading-card paint
and cleanup. Ordinary preset spawning still runs inside the initial click task. `stepPhysics()` rejects pending-start ticks.

The scene-swap-only hold from #487 did not cover a lazy mission import after
`startFlight()` entered FLIGHT. Clearing damage after that import cannot undo
an explosion sound already played during the gap (#524).

Damage cleanup must also target the selected airframe. Aircraft instances are
cached: a clean global `isCrashed` does not prove every cached aircraft is clean.
Ordinary presets clear crash visuals/effects unconditionally; slalom preparation
selects the F16 before clearing them. A new slalom mission selects HUD through
`CameraSystem.MODES.HUD`, cancelling the lobby's AUTO/temporary belly view.

## Regression checks

- `tests/mainMenuFlow.test.js`: delayed spawn, rejected duplicate start, failed
  load returning to a frozen lobby without offering resume of the stale pose.
- `tests/presetReset.test.js`: cached damage, separation, virtual inputs and
  accumulator reset across runway/approach/cruise for B738, C172 and F16.
- `tests/slalomAdapter.test.js`: crashed retry and a damaged cached F16 selected
  after another aircraft; checks the production CameraSystem's HUD mode.
- `node scripts/verify-scenario-start.mjs`: hardware Chrome preflight, a 1500 ms
  network delay during the first arena import with a deliberately invalid
  outgoing pose, no collision/explosion, HUD start, real crash/retry, and cached
  F16 return after C172. Reports and screenshots go to `.tmp/scenario-start/`.
  Follow [GPU setup](browser-gpu.md); this script defaults to the user-owned
  hardware Chrome wrapper and requires Vulkan. The explosion counter checks
  sound dispatch, not subjective listening quality.

For the broader ownership inventory, confirmed lifecycle fixes and staged SOLID
refactoring recommendations, see [state lifecycle review](state-lifecycle-review.md).

The coordinator is directly importable without browser startup. Its narrow ports
separate lifecycle policy from `FlightStartLoadingView` presentation and the
`simulatorFlightStart` composition adapter. The `busy` guard covers both direct
starts and rebuilds; competing entry points cannot release the active hold.

Scenario installation is delegated to `ScenarioStartCoordinator`, with simulator
services wired in `simulatorScenarioStart`. The launched selection is captured
before asynchronous mission preparation and committed only after it succeeds.
`startValleyMission` invokes `PilotMissionStartController` directly: the mission
panel is a form adapter, not an execution API accessed via synthetic clicks.
Preparation rejection/cancellation propagates to the outer start transaction.
Ordinary presets, demos and mission adapters each own their own fresh recording;
commitment must not reset the prepared mission seed. Failed coordinated starts
stop recording and discard old crash/debrief presentation state.
