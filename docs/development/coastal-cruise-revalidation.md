# Coastal Cruise locked-shot revalidation

Production source baseline: main `f8e2215`, including #778, 2026-11-15.
Tracked by #770, updating PR #767. No production gameplay coefficients changed.

```sh
timeout --signal=TERM --kill-after=5s 60s node scripts/probe-cruise-combat.mjs
```

Reuses `HeadlessSimulation`, the actual F-16 Coastal Cruise preset, player
physics/controls/physiology, seeded Coastal terrain and live combat system.
The existing bandit pursuit law supplies pilot commands through FlightControls;
there is no teleporting, sensor override or missile-guidance truth override.
Target truth supplies only pilot steering and diagnostic observations. This is
a deterministic instrumented pilot, not a human or rendered-scene acceptance.

## Experiment correction

The original PR #767 adapter passed the pursuit controller the player host,
but only roll/throttle commands reached its control API. The bandit controller
writes elevator/rudder directly to aerodynamics; player physics overwrites
those fields from FlightControls before integration. The corrected adapter
routes those two commands into virtual input before each physics step, retaining
input slew and pilot physiology. The earlier acceleration/pilot results are
provisional; they do not establish missile behavior. Regression tests exercise
the adapter through the real player integration path.

## Design

Three speed commands (107.78, 180, 250 m/s), three launch policies (first full
lock, full lock within 2.5 km, full lock within 1.5 km), countermeasures on/off:
18 sorties. Every sortie starts at the unchanged preset velocity `[96,0,-49]`
m/s and position `[-600,750,3200]`. Speed commands accelerate through forces;
they do not replace the initial velocity. No target attitude, altitude, starting
aspect or placement is edited to manufacture a shot; actual launch pose and
aspect are recorded.

Each policy fires at most one AIM-9X, after full rail lock and before 75 s.
Run at 120 Hz for at most 100 simulated seconds, stopping after the missile's
terminal event. Countermeasure controls must have identical actual launch state
(pilot/target pose and velocity, launch time, observation), or the audit fails.
Inventories are disabled every tick for the control; enabled uses production
flare and chaff behavior. Chaff does not compete with the IR seeker.

Detailed results in `.cache/cruise-combat/report.json` include 5 Hz missile
samples plus state/guidance transitions, target and missile positions, LOS angle,
speed, propellant and requested/available acceleration. The summary omits dense
trajectories. `ARTIFACT_DIR` selects another directory. Reports are marked
`running`, then `complete` after paired-state validation, or `incomplete` on a
caught failure. An outer-process timeout is incomplete evidence even if only a
`running` checkpoint survives. Full trajectories remain local; the small
[latest result record](coastal-cruise-revalidation-results.json) preserves inputs,
launch conditions, transitions and terminal outcomes for all 18 cases.

## Results with the corrected adapter

The initial-speed command produces six confirmed-lock launches:

| Policy | Launch time | Actual range | With countermeasures | Without countermeasures |
| --- | ---: | ---: | --- | --- |
| First lock | 27.55 s | 3048.58 m | expiry, closest 122.70 m | kill, fuze CPA 0.441 m |
| Within 2.5 km | 29.60 s | 2498.11 m | expiry, closest 37.95 m | kill, fuze CPA 0.041 m |
| Within 1.5 km | 33.20 s | 1498.81 m | kill, fuze CPA 0.945 m | kill, fuze CPA 0.945 m |

The first-lock and 2.5 km missiles each confirm a flare track approximately
0.783 s after launch. They follow it until memory/loss, without reacquiring the
aircraft. Memory starts at about 6.325 s and 5.333 s respectively, with
propellant zero, followed by gimbal-related cutoff. Both expire. The 1.5 km
case retains aircraft tracking and kills with zero confirmed decoy transfers.
This reproduces the reported post-lock problem in the actual start flow and is
consistent with the separate 2.5 km recovery audit; it is not just no-lock.

All 12 acceleration-command sorties withhold launch. The pursuit controller does
not establish full lock/range opportunity within its firing window. These are
not missile misses or evidence that higher launch speed reduces effectiveness.
Improving intercept/boresight control remains necessary before assessing faster
actual-start launches. No pilot crash or nonfinite pilot state occurred.

The corrected 18-case run completes in about 12 seconds under the 60-second
guard. It samples one initial placement and one pursuit law; range policies also
change launch time, attitude, aspect and engine state. This is a scenario
comparison, not an isolated distance coefficient test or real-world kill rate.

The next modeling question remains sustained flare observation/association,
with explicit assumptions and sensitivity. This experiment alone does not
justify reducing flare emission/lifetime, increasing G/gimbal limits, or claiming
the remaining misses are realistic. Browser/UI and human-sortie acceptance are
still unverified.
