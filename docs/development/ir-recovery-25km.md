# 2.5 km post-lock IR recovery audit

Follow-up to the [locked-shot audit](locked-ir-audit.md) and the
[IR association model](ir-track-association.md), tracked by issue #770. Base is
`fix/ir-decoy-recovery` (PR #769, stacked on #768) with main `20e0d94`. The
question is why the paired 2.5 km flare cohort stayed at **2/20 kills** after
the angular-motion association change while the 1.5 km cohort rose to 14/20.

No gameplay coefficient or seeker selection rule changed. The only source
change is a diagnostic-only 120 Hz trace and two test interventions in
`scripts/lib/combatSituationMatrix.mjs`; neither is reachable in the game.

## Method

`scripts/audit-ir-recovery.mjs` reuses the production locked-shot fixture and
fires one AIM-9X only after full rail lock. It runs the same 20 initial
geometries as the 2.5 km cohort: two shooter speeds (107.78 m/s and 250 m/s),
two altitude pairs (shooter/target 750/1210 m and 1500/1500 m), and aspects
0/45/90/135/180 degrees. Actual launch ranges are retained per row because rail
acquisition moves the shooter before firing.

Every control is paired: the launch state JSON must match across variants, and
all runs must launch. Variants:

- **Evasion only** — warning response, no flares.
- **Flare only** — no warning response/evasion; one flare is inserted at the
  control run's observed dispense time.
- **Reaction + flare** — the current production control.
- **Flare hidden at 0.2 s / 2 s / 4 s age** — the flare is still dispensed and
  can transfer the track, but becomes unobservable after the stated age. This is
  a diagnostic intervention, not gameplay behavior; it tests whether aircraft
  reacquisition and intercept work when the sustained decoy return is removed.

The 120 Hz trace records seeker state/target/loss reason, estimate, range, LOS
from missile velocity, closing rate, target warning phase, missile speed,
propellant, dynamic pressure, requested/available/delivered lateral
acceleration and all live flares. Trajectory samples do not feed simulation
state.

```sh
timeout --signal=TERM --kill-after=5s 60s node scripts/audit-ir-recovery.mjs
```

Writes `.cache/ir-recovery/report.json` and `summary.json`; the run completes in
about 2.5 seconds on this host.

## Results

| Control | Kills / 20 | Terminals | Aircraft reacquired | Mean confirmed flare track |
| --- | ---: | --- | ---: | ---: |
| Evasion only | **20** | 20 hits | — | 0 s |
| Flare only, no evasion | 2 | 2 hits, 18 timeouts | 8 | 5.31 s |
| Reaction + flare | 2 | 2 hits, 18 timeouts | 8 | 4.51 s |
| Flare hidden at 0.2 s | **20** | 20 hits | 20 | 0.19 s |
| Flare hidden at 2 s | 18 | 18 hits, 2 nonlethal bursts | 20 | 1.99 s |
| Flare hidden at 4 s | 8 | 8 hits, 12 timeouts | 10 | 3.86 s |

The two reaction+flare hits are aspect 0 and 45 degrees, low-speed shooter at the
750/1210 m altitude pair. The flare-only control hits aspect 45 degrees at both
altitude pairs. All other reaction+flare cases expire. The flare-only control
keeps the target out of evasion and still produces 2/20, so the aircraft's
defensive turn is not the dominant cause.

In the reaction+flare cohort:

- **12/20 never reacquire the aircraft after the flare.** Their last aircraft
  track is before the transfer at 0.78 s. The missile follows the flare and the
  aircraft leaves the 65-degree seeker field of regard; closest approaches are
  30.8 m to 713.1 m, usually after the missile has flown past the target.
- **8/20 reacquire the aircraft after flare loss** at 438-714 m. Six of those
  still miss. In all six, propellant is zero at closest approach, available
  lateral acceleration is the 35 g structural cap, and requested acceleration
  exceeds available from the first reacquisition seconds.
- **14/20 have zero propellant at closest approach.** The remaining six still
  have 0.06-0.24 propellant but never reacquire.
- Terminal loss reasons are `fov_limit` and guidance `gimbal_limit`; there is no
  missing estimate or stalled seeker state before the decoy track.

### Representative timeline

Reaction+flare, aspect 0, shooter 250 m/s, 1500/1500 m. Launch range 2448.7 m;
decoy transfer at 0.8 s; closest approach 84.45 m at 6.5 s; timeout.

| Time | Seekers | Range to aircraft | LOS off missile velocity | Speed | Propellant | Requested / available |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 0.008 s | track aircraft | 2448.7 m | 0.7° | 273 m/s | 1.00 | 10 / 281 m/s² |
| 0.800 s | track flare | 2343.1 m | 0.8° | 356 m/s | 0.82 | 11 / 343 m/s² |
| 5.308 s | memory flare | 572.8 m | 11.8° | 729 m/s | 0 | 0 / 343 m/s² |
| 5.450 s | track aircraft | 501.3 m | 14.5° | 727 m/s | 0 | 769 / 343 m/s² |
| 6.300 s | track aircraft | 122.0 m | 42.1° | 671 m/s | 0 | 2695 / 343 m/s² |
| 6.442 s | memory aircraft | 88.3 m | 69.5° | 659 m/s | 0 | 0 / 343 m/s² |
| 7.042 s | lost | 258.7 m | 154.8° | 647 m/s | 0 | 0 / 343 m/s² |

With the flare hidden at 0.2 s, the same launch transfers at 0.8 s, loses the
flare at 0.85 s and reacquires the aircraft at 0.992 s, 2307.7 m from the
target. It hits with a 0.86 m closest approach. The cutoff controls therefore
show that the seeker state machine, reacquisition, PN guidance and fuze all work
when the aircraft remains inside the field of regard.

## Cause classification

| Layer | Evidence | Classification |
| --- | --- | --- |
| Seeker selection/confirmation | One transfer event per run; flare is a valid brighter return at the aircraft's release state | Working as modeled |
| Recovery/memory | 8/20 recover at 438-714 m; hiding the flare at 0.2/2 s restores 20/20 and 18/20 kills | Working; late only because the flare remains a valid return |
| Terminal guidance | 6 recovered misses saturate the 35 g cap; peak request 2695 m/s² vs 343 available; LOS reaches 69.5° | Geometry/authority, not a state bug |
| Energy | Propellant zero at closest in 14/20; recovered misses have no thrust | Energy spent during the decoy track |
| Damage/fuze | No close approach within the 14 m fuze radius in the misses | Consequence of geometry |

The dominant cause is a **sustained, credible flare track**. Once transferred,
the point-source seeker follows the flare while it remains brighter than the
aircraft. At 2.5 km the flare stays observable for roughly 4.5 seconds, which is
enough for the missile to fall far off the aircraft's path. Recovery then either
does not happen because the aircraft is outside the 65-degree field of regard,
or happens too late for the 35 g missile to correct. The 4 s cutoff result
(8/20) shows the residual is a monotonic function of decoy track duration, not a
particular confirmation tick or event counter.

This audit found **no production defect to fix**. The flare model is intentionally
a point source with no imaging, spectral or range-rate discrimination; a flare
that matches the aircraft's initial motion and remains bright is expected to
capture this seeker. Changing flare lifetime/emission, the 1 mrad association
assumption, the 65-degree gimbal or the 35 g limit to raise the 2.5 km rate would
be tuning to a desired outcome, which issue #770 explicitly rules out. Shortening
the decoy track would require a separate imaging/spectral/range-rate rejection
model with its own evidence; that is beyond this follow-up.

## Limits

- Twenty deterministic geometries, not a statistical sample or a real AIM-9X
  kill-rate claim.
- Node numerical evidence only; flat terrain, no browser, no human sortie and no
  rendering acceptance.
- The flare dispenser, emission curve, 6 s lifetime, 1 mrad angular uncertainty,
  28-degree acquisition FOV, 65-degree gimbal and 35 g limit are simulation
  assumptions.
- Manual flare release and observation cutoff are diagnostic controls. They do
  not exist in gameplay and are not proposals for gameplay behavior.
- The 120 Hz trace is opt-in (`recordDetail`) and allocates only in the
  experiment; default simulation output is unchanged.

Focused regression coverage for the diagnostic trace and interventions is in
`tests/combatSituationMatrix.test.js`.
