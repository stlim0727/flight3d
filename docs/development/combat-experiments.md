# Numerical combat experiments

Use this entry point for weapon physics, locked-shot failures and controlled
defense comparisons. It runs the existing `simulateCombatSituation` production
fixture in Node without a renderer, browser, Vite or GPU.

```sh
# Default: 100 IR geometries × patrol / reaction / reaction + flare = 300 cases
npm run combat:experiment

# Existing 48-geometry defense grid × all five defense controls = 240 cases
npm run combat:experiment -- --scenario defense

# One confirmed-lock attempt, with histories, diagnostic events and analysis
npm run combat:experiment -- --scenario single --ranges 2500 --aspects 0 \
  --speeds 108 --altitude-pairs 750:1210 --defense reaction-flare --diagnostics

# Restrict the paired comparison to a reported geometry
npm run combat:experiment -- --ranges 1500,2500 --aspects 0,90 \
  --speeds 108 --altitude-pairs 750:1210 --timeout 30 \
  --output .cache/combat-experiment/reported.json
```

`--types AIM9X,AIM120C`, `--ranges` (m), `--aspects` (degrees, 0 = tail),
`--speeds` (shooter m/s) and `--altitude-pairs shooter:target` (m) accept
comma-separated values. Each option replaces that dimension's defaults.
`single` requires exactly one geometry and one defense variant. Default target
speed is 180 m/s for `locked-ir`/`single`, 200 m/s for the existing `defense`
grid. All targets use the same physical `evasive_ai` patrol fixture.

Defense variants are `passive`, `reaction-only`, `reaction-flare`,
`reaction-chaff`, `reaction-both` or `all`. For `locked-ir`, `all` selects the
three IR controls; for `defense`, it selects all five. For `single`, the default
is `reaction-flare`. These reuse `DEFENSE_VARIANTS`; inventory does not force a
release. The existing audit scripts remain available for their historical
reports and additional behavior probes.

Every attempted shot requires confirmed rail lock. Paired variants must have
identical actual launch states. Withheld no-lock, fired misses, nonlethal fuze
bursts, kills and unresolved timeouts are separate summary categories; no-lock
does not enter the kill fraction of launches. No ideal sensor override or
gameplay coefficient change is made.

## Low-output workflow

The command prints one compact JSON result with per-type/defense denominators
and artifact paths. By default it saves `.cache/combat-experiment/<scenario>.json`
and `<scenario>.summary.json`. Read the summary first, then inspect selected
full-report cases. Histories and diagnostic events/analysis are omitted unless
`--diagnostics` is set. See [diagnostic event bridge](combat-diagnostic-events.md)
for the event clock, measured CPA, analyzer contract and fidelity limits.
Metadata includes source revision, dirty state, Node version, fixed timestep,
flat-terrain fixture and resolved inputs. Dirty results are provisional.

The worker deadline defaults to 60 seconds (`--timeout` changes seconds).
Termination works even when the physics loop is synchronous. Errors and
timeouts exit nonzero and replace both report and summary with `incomplete`
status and completed-case count; no partial summary is presented as a pass.
Starting a new run marks both outputs `running` so an older successful summary
cannot be mistaken for the current run. Git metadata queries separately have
5-second deadlines. Outputs use atomic replacement.

These are deterministic geometry fixtures: acquisition points the kinematic
shooter at the target; after launch the shooter moves straight. They do not
simulate a human pilot, player control response, the Coastal Cruise preset,
UI, rendered images or real-world weapon probabilities. Use the existing
`HeadlessSimulation` for actual player/preset physics, and browser verification
only for behavior that needs a browser.
