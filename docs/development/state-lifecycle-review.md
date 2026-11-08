# State lifecycle review

Reviewed against `b225281` (2026-11-07). Scope: first-visit/preference restoration,
pending menu choices versus the active sortie, fresh starts and failed starts,
ordinary preset resets, demo/arena entry, pause/debrief retry, and temporary
Hangang/replay/developer state. This is a source review plus the focused sequence
checks below, not exhaustive browser acceptance of every combination.

## Ownership and invariants

| State | Owner today | Required lifetime |
| --- | --- | --- |
| Validated saved preferences | `simulatorPreferences.js` | Survive reload; partial saves preserve siblings. No aircraft pose, pause or scripted time. |
| Pending airport/aircraft/scenario/profile | `sim.lobby`, lobby callbacks | Browsing must leave a held sortie intact; Resume ignores pending choices. |
| Flow and held-sortie permission | `GameFlowController` | A failed new start cannot offer Resume for the outgoing pose. |
| Scene rebuild hold | `FlightStartCoordinator`, `startingFlight` | Cover loading-card paints and the whole nested spawn. |
| Exclusive scene/spawn transaction | `FlightStartCoordinator.busy` | Every caller, including retry and tooling, shares one exclusion guard. |
| Aircraft physics reset | `PresetSpawner.setPreset`, mission adapter | Clear damage, controls, engine failures, integrator remainder and contact history before integration. |
| Temporary environment and view | Hangang, replay, developer drivers | Pair acquisition/release; scripted time must not claim a user preference. |
| Flight/replay recording | Preset/demo installers, `PilotMissionAdapter`, recorders | Metadata must describe the installed sortie rather than pending menu choices. |

`startingFlight` is the simulator-facing physics hold, which can also be owned
by external preparation. `FlightStartCoordinator.busy` excludes concurrent start
and rebuild transactions. The coordinator restores the previous hold only after
the final loading paint and cleanup. A competing start cannot release either
owner's hold.

## Implemented responsibility boundaries

- `core/FlightStartCoordinator.js`: importable lifecycle policy. It serializes
  starts/rebuilds, owns hold acquisition/release, and orders recovery/cleanup.
  It receives narrow ports and imports no simulator, DOM, Three.js or storage.
- `ui/FlightStartLoadingView.js`: loading-card visibility, progress paints,
  selection-busy display and latency notifications. Hidden tabs skip paints.
- `core/simulatorFlightStart.js`: composition adapter. It wires real scene
  preparation, scenario installation, flow recovery and loading presentation
  into the coordinator. Airport preparation keeps its `applyingPendingStart`
  scope and releases it on errors.
- `main.js`: keeps public `fly`, `startFlight` and `applyPendingScene` entry
  points compatible, lazily composes the coordinator and delegates transactions.
  `spawnFlight` delegates scenario installation to a separate coordinator.
- `core/ScenarioStartCoordinator.js`: installs the chosen scenario before
  committing its start. Synchronous presets remain synchronous; asynchronous
  mission preparation must succeed before persistence and analytics.
- `core/simulatorScenarioStart.js`: snapshots the launched selection after replay
  restoration, connects preset/demo/valley installers, then persists and publishes
  that snapshot. Later pending menu edits do not replace the launched selection.
- `arena/PilotMissionStartController.js`: validates a mission request, sequences
  retry/reset/pacing, and observes both readiness and runner completion. Failed,
  aborted or missing readiness cannot count as a successful launch. It does not
  wait for the full flight lifetime or depend on DOM controls.
- `ui/PilotArenaPanel.js`: adapts visible form state to mission requests. Both
  panel actions and `startValleyMission` use the controller directly, without
  clicking the Run button. Scenario/mode commands choose their example source;
  a lab Run retains edited pilot code.

Recording has one owner per entry path: ordinary `setPreset` arms recording
once its pose is installed, demos arm once their scenario starts, and
`PilotMissionAdapter` arms before course preparation so the prepared seed can be
added before the first mission tick. Scenario commitment does not re-arm or erase
that recording. A failed coordinated start stops both recorders, clears old
crash/debrief state, disables cinematic advancement and removes Resume permission.
The pause valley retry catches preparation failures through the same recovery;
its broader retry-selection policy remains a subsequent migration.

Ordinary starts still invoke scenario installation synchronously in the click
call stack. Rebuilds call that same installation port after scene preparation,
without opening a nested public start transaction. Direct callers during either
preparation, lazy spawning or final paint are rejected with false.

## Confirmed defects corrected

1. **P2: direct start reentrancy.** `fly()` guarded duplicate clicks, but
   `startFlight()` itself accepted concurrent callers. Two lazy spawns could
   mutate the same simulator and the first completion could release physics
   while the other remained pending. Guard the spawn entry itself and release
   its ownership in `finally`; report success as a boolean.
2. **P2: stale Resume after failure.** If setup threw before leaving a held
   lobby, `returnToLobby(false)` returned early because it was already in LOBBY.
   It retained `resumableFlight`. Allow an ownership change within the same flow
   state. Failed starts disable the cinematic and stay frozen without Resume.
3. **P2: failed start published Ready.** The inner start caught its error, so the
   scene-swap wrapper still painted its successful Ready stage. Consume the
   explicit start result and skip that stage on failure.
4. **P2: nested preference replacement.** Saving a joystick field replaced the
   entire saved joystick object. Merge validated joystick fields independently;
   treat `customMapping` as an atomic calibration, with null as explicit clear.
5. **P2: scripted Hangang time became a user override.** `persist: false` stopped
   storage writes but left `userChoice` at its default true. Both sunset setup
   and restoration now pass `userChoice: false`, preserving device-time/demo
   policy after leaving the scenario.

## SOLID assessment and next boundaries

The useful issue is responsibility ownership, especially SRP and DIP. Existing
pure components (`GameFlowController`, preference validation, physics models)
are good boundaries and should stay independently testable. LSP/ISP do not
justify introducing new inheritance or interface hierarchies here.

The lifecycle-policy extraction above is complete. Remaining boundaries, each
with observable sequence coverage before migration:

1. Centralize selection normalization. Lobby callbacks, `setAirport`,
   `setAircraft`, demo resolution and persisted selection currently participate
   in this policy. Separate pending choices, installed selection and last flown
   selection; retain URL precedence and special aircraft constraints.
2. Route pause restart, debrief retry and lobby start through explicit shared
   start/retry operations. Today pause restart calls presets/missions directly,
   while debrief retry invokes the start coordinator. Preserve mission retry
   scoring, developer scenarios, demo profiles and sky policy with separate
   sequence tests before unifying these paths.
3. Replace positional reset flags (`isDemoInternal`, `pilotPreparation`) with
   named intent only when migrating callers. Extract reset responsibilities by
   subsystem rather than building a universal mutable state bag. Exercise
   runway → approach → cruise → crash → retry for each aircraft.
4. Make temporary environment/view ownership explicit. Hangang snapshots world
   visibility, wind and time; replay snapshots view state; developer scenarios
   snapshot cameras. Define precedence for settings changed while an override
   is active before replacing these snapshots with a shared mechanism.

These are design risks and migration proposals, not claims that all those paths
currently fail. Multiplayer has separate locked/preparing ownership and was
checked as a guard dependency, not comprehensively retested in this review.

## Verification

- `flightStartCoordinator`: delayed scene/spawn/final paint, competing start and
  rebuild callers, recovery at each phase, external holds, locked sessions and
  cleanup failure. These tests import the policy directly, without source extraction.
- `scenarioStartCoordinator`: synchronous commitment, delayed preparation,
  installer rejection, launched-selection snapshots, persistence/analytics
  protection on failure, single recording ownership and shared failure cleanup.
- `pilotMissionStartController`: readiness versus full flight lifetime, retry
  sequencing, pacing, seed validation, conflicting preparation, startup/prepare
  rejection, missing readiness and cancellation on a real `MissionRunner`.
- `mainMenuFlow`: pending choices versus Resume, unchanged-selection restart,
  delayed and rejected spawn, duplicate direct callers, failure before leaving
  the held lobby, and guard recovery after failure.
- `simulatorPreferences`: startup defaults/restoration, malformed/unavailable
  storage, independent saves, joystick calibration retention and explicit clear.
- `bridgeFlight`: the Neon Metropolis bridge flight holds calm wind and restores the
  previous wind when it ends (#551); it no longer changes the time of day.
- Existing `presetReset`, flow, demo, replay and mission tests remain part of
  the full Node gate. The Node simulator helper extracts the production class
  from source; replacing that mechanism with importable coordinators is useful
  test debt, not a reason to duplicate lifecycle logic in tests.
- `scripts/verify-scenario-start.mjs` passed with Chrome/156.0.8078.73,
  ANGLE Vulkan on Intel Graphics (ADL-N). WebGL2 shader drawing returned
  `[255, 0, 0, 255]`, GL error 0. Delayed first mission import, crash/retry and
  damaged cached F16 return passed without extra explosions or runtime
  exceptions. Extended acceptance also checks a valley → coastal/C172 scene
  rebuild, synchronous cruise installation and an injected scene-load failure
  returning to a frozen lobby without Resume or Ready. Further checks inject a
  real runner preparation error, assert no flight-start event or saved-selection
  update, no active recorders, zero synthetic Run-button clicks and successful
  retry after the error. A real demo start also arms recording exactly once.
  Evidence is Chrome evidence; artifacts are in
  `.tmp/scenario-start/` in the task worktree.
- Browser coverage above does not assert every pause/debrief/settings
  combination, physical joystick behavior, subjective audio, or multiplayer.
