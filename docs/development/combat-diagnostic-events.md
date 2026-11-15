# Numerical combat diagnostic events

Use the [combat experiment runner](combat-experiments.md) with `--diagnostics`:

```sh
npm run combat:experiment -- --scenario single --diagnostics --timeout 30
```

Each launched result includes `diagnostics` conforming to
`flight3d.fixture-diagnostics.v1`. Its `track` is an in-memory input to the existing
`analyzeCombatEngagement` engine; `analysis` is that engine's
`flight3d.engagement.v1` report. There is no new binary replay codec, player
recording control or sortie export format. No-lock results have `diagnostics: null`
and do not manufacture a missile launch. The compact summary still omits per-case
histories and events. Implementation status remains in [#713](https://github.com/stlim0727/flight3d/issues/713).

## Events and observations

All event times are seconds after the actual missile launch. Native seeker state,
dispense, transfer, expiry, detonation, damage and kill events are copied as scalar
snapshots. The fixture also observes changes in confirmed seeker target,
observation loss reason, guidance cutoff, demanded-vs-available control, powered
state, and warning/confirmed-threat/reaction state every 1/120 s. A target switch
can occur while the seeker remains in `track`; `seeker_target` records it without
inventing a state change. The analyzer retains event kind, target identity/type
and previous target identity in its seeker timeline.

Global process IDs are mapped to stable fixture-local IDs. Target and missile
each use ID 1 in their separate identity domains; decoys use subsequent
target-domain IDs. Launch vectors are frozen before the first flight update.
Observation never replaces the missile's state, guidance or final outcome.

5 Hz diagnostic samples (plus initial and final samples) connect guidance state,
demanded/available/actual lateral G, dynamic pressure, drag, Mach, propellant and
actual aircraft separation. Warning source is not distinguished by the current
interface. A control limit, motor burnout or cutoff is an observation, not proof
of a unique cause of failure. Expiration is described as configured flight
lifetime ending, rather than assuming energy exhaustion.

The measured closest approach retains the production method: `continuous_fuze`
for the interpolated fuze calculation, `step_sampling` otherwise. Event times,
including the CPA timestamp supplied by the production model, are simulation-step
timestamps, not continuous event times. The continuous distance calculation does
not justify sub-step timestamp accuracy. Non-lethal detonations retain partial
damage and survival separately from kills. If the fixture stops while a missile
is alive, an observational `unresolved_end` is added without changing its live
`finalOutcome`. Manual flare and flare-observation-cutoff diagnostic interventions
are explicitly marked and their input settings are preserved.

## Verification and limits

A deliberate flare cutoff fixture (not an operational scenario) has a `memory`
interval of approximately 0.14 s between 5 Hz samples. Native transition events
and later aircraft reacquisition both survive in the analysis, while the 5 Hz
trajectory alone misses the memory interval. Separate cases exercise kill,
non-lethal blast, expiration, terrain impact, no-lock and unresolved fixture
termination. Repeated runs with incrementing live IDs produce identical
normalized diagnostic reports.

The default 1,280-case matrix was compared against main `23ec22a`; all existing
outcome, flight and defense fields were unchanged. The inspected weapon and matrix paths are identical between that baseline
and task start `107e1d9`. Diagnostic mode is optional and `recordDetail` remains available
for a separate full 120 Hz numeric trace.

These checks cover Node numerical fixtures and the shared in-memory analysis
contract. They do not validate actual user sortie recording, codec round trips
for the additional fixture event kinds, rendering or real weapon performance.
