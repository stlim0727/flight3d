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
# Swappable Coastal combat pilot

Use the production F16/Coastal/Cruise physics and weapons without a renderer:

```sh
npm run combat:experiment -- --list-skills
npm run combat:experiment -- --scenario coastal --seconds 300 --timeout 60 \
  --attack-skill pursuit --evasion-skill legacy-break --countermeasure-policy single \
  --diagnostics --output .cache/combat-experiment/coastal-reference.json
# Change one factor; keep the other arguments identical.
npm run combat:experiment -- --scenario coastal --seconds 300 --timeout 60 \
  --attack-skill pursuit --evasion-skill hold --countermeasure-policy single \
  --output .cache/combat-experiment/coastal-hold.json
```

Selectors apply to `--scenario coastal`; matrix modes reject them rather than
silently ignoring them. `pursuit` fires at confirmed lock within 2500 m;
`close-pursuit` uses 1500 m; `hold` holds the current heading/altitude and never
fires. Evasion `legacy-break` preserves existing warning-driven guidance;
`hold` follows patrol while keeping warning perception active. Countermeasure
`single` preserves one flare and chaff per confirmed threat, with finite stock
and existing reset/respawn handling; `none` suppresses dispensing independently
of perception and evasion. No PR is treated as the realism reference.

Policy IDs and versions appear in report/summary configuration and metadata.
The initial state is saved for paired comparisons. The sortie ends at the
simulation limit (maximum 300 seconds), crash, or resolved final missile.
Only one missile is allowed in flight at a time. The existing worker wall-clock
deadline terminates runaway physics; timed-out/failed runs remain `incomplete`.
Use distinct output paths to keep comparisons. `--diagnostics` saves sampled
position, contact, guidance and lock state; this is numerical telemetry, not an
importable visual replay.

`src/pilot/CombatSkills.js` is the local observation-to-guidance policy boundary.
Add identifiers and implementations there, and bump a policy's version when its
behavior changes. Attack receives plain own/contact/lock snapshots, never the
world, missile truth or seeker internals. The experimental contact sensor uses
ideal position samples at 5 Hz within 12 km with sampled terrain line of sight;
it is not a validated F16 radar/visual model. Defender warnings retain the
existing simplified optical-plume/RWR perception. Guidance flows through the
normal force model and player virtual controls. These policies are experiment
fixtures, not validated realistic evasion/counterattack skills. A zero-launch
sortie cannot establish missile hit probability; inspect `firstLockSeconds`,
crash state and launch records before interpreting kill counts. Developing
effective attack/evasion policies and missile-model calibration remain separate
tasks in #794.
