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
| Scene rebuild hold | `applyPendingScene`, `startingFlight` | Cover loading-card paints and the whole nested spawn. |
| Exclusive scenario spawn | `startFlight`, `spawningFlight` | Every caller, including retry and tooling, shares one exclusion guard. |
| Aircraft physics reset | `PresetSpawner.setPreset`, mission adapter | Clear damage, controls, engine failures, integrator remainder and contact history before integration. |
| Temporary environment and view | Hangang, replay, developer drivers | Pair acquisition/release; scripted time must not claim a user preference. |
| Flight/replay recording | `beginFlightRecording`, recorders | Metadata must describe the installed sortie rather than pending menu choices. |

`startingFlight` and `spawningFlight` have different responsibilities: the former
also spans scene loading and final paints, while the latter excludes concurrent
calls to the inner spawn. A nested start must preserve the outer hold, and a
second direct start must return false without releasing either owner's hold.

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

Recommended sequence for subsequent refactoring, each with observable sequence
coverage before migration:

1. Extract a flight-start coordinator from `main.js`. Give it narrow scene,
   scenario, flow and recording operations. Preserve the synchronous ordinary
   preset path and the outer/inner ownership contract above. Make preparation
   report ready/failed explicitly; `startValleyMission` currently dispatches a
   DOM button and consumes `readyPromise` failures locally. Review its status
   contract before moving recording and persistence to a shared commit point.
2. Centralize selection normalization. Lobby callbacks, `setAirport`,
   `setAircraft`, demo resolution and persisted selection currently participate
   in this policy. Separate pending choices, installed selection and last flown
   selection; retain URL precedence and special aircraft constraints.
3. Route pause restart, debrief retry and lobby start through explicit shared
   start/retry operations. Today pause restart calls presets/missions directly,
   while debrief retry invokes the start coordinator. Preserve mission retry
   scoring, developer scenarios, demo profiles and sky policy with separate
   sequence tests before unifying these paths.
4. Replace positional reset flags (`isDemoInternal`, `pilotPreparation`) with
   named intent only when migrating callers. Extract reset responsibilities by
   subsystem rather than building a universal mutable state bag. Exercise
   runway → approach → cruise → crash → retry for each aircraft.
5. Make temporary environment/view ownership explicit. Hangang snapshots world
   visibility, wind and time; replay snapshots view state; developer scenarios
   snapshot cameras. Define precedence for settings changed while an override
   is active before replacing these snapshots with a shared mechanism.

These are design risks and migration proposals, not claims that all those paths
currently fail. Multiplayer has separate locked/preparing ownership and was
checked as a guard dependency, not comprehensively retested in this review.

## Verification

- `mainMenuFlow`: pending choices versus Resume, unchanged-selection restart,
  delayed and rejected spawn, duplicate direct callers, failure before leaving
  the held lobby, and guard recovery after failure.
- `simulatorPreferences`: startup defaults/restoration, malformed/unavailable
  storage, independent saves, joystick calibration retention and explicit clear.
- `hangang`: temporary sunset/restore preserves both automatic and explicit
  user-time ownership using the production time setter.
- Existing `presetReset`, flow, demo, replay and mission tests remain part of
  the full Node gate. The Node simulator helper extracts the production class
  from source; replacing that mechanism with importable coordinators is useful
  test debt, not a reason to duplicate lifecycle logic in tests.
- `scripts/verify-scenario-start.mjs` passed with Chrome/156.0.8078.73,
  ANGLE Vulkan on Intel Graphics (ADL-N). WebGL2 shader drawing returned
  `[255, 0, 0, 255]`, GL error 0. Delayed first mission import, crash/retry and
  damaged cached F16 return passed without extra explosions or runtime
  exceptions. Evidence is Chrome evidence; artifacts are in
  `.tmp/scenario-start/` in the task worktree.
- Browser coverage above does not assert every pause/debrief/settings
  combination, physical joystick behavior, subjective audio, or multiplayer.
