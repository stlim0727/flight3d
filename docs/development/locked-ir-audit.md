# Locked AIM-9X miss investigation

The reported symptom is **misses after confirmed lock**, not inability to get
the initial Coastal Cruise lock. This investigation isolates that symptom on
main `20e0d94` (2026-11-15). No gameplay coefficients or seeker behavior changed.

## Method

```sh
timeout --signal=TERM --kill-after=5s 60s node scripts/audit-locked-ir.mjs
```

Reuses the production `simulateCombatSituation` fixture and its physical bandit,
default IR model, flare dispenser, missile dynamics/TVC, fuze and damage. A single
missile is fired only after full rail lock. No ideal sensor override is used.

100 initial geometries: ranges 0.8/1.5/2.5/3.5/5 km × aspects
0/45/90/135/180 degrees × shooter speeds 107.78/250 m/s × two altitude pairs
(shooter/target 750/1210 m and 1500/1500 m). Aspect zero is a tail shot.
For every geometry compare patrol without reaction, reaction without decoys,
and reaction plus flares. Chaff is disabled. Exact launch states must match
across the three variants. All retain the same physical patrol fixture.

The shooter is a kinematic fixture that points toward the target during rail
acquisition and moves straight after launch; this intentionally removes human
aiming errors and player-pilot controller quality from the locked-shot question.
Terrain is flat; target speed is initially 180 m/s, patrol radius 1000 m.
Use [the Coastal experiment PR](https://github.com/stlim0727/flight3d/pull/767)
for the actual player-integrator/preset investigation. This matrix is not an
exact replay of a user's sortie or browser/UI verification.

300 runs at 120 Hz, at most 25 simulated seconds per shot, complete in about
3 seconds on this host. Full 5 Hz trajectories are saved to
`.cache/locked-ir/report.json`; summary and individual-shot evidence are saved
alongside it. No-lock cases retain their own denominator and are excluded from
the post-lock success ratio. Raw decoy event counts can repeat during
confirmation; inspect confirmed flare tracks rather than treating every event
as a completed transfer.

## Observations

| Defense | Initial geometries | Confirmed-lock launches | Aircraft fuze bursts | Kills |
| --- | ---: | ---: | ---: | ---: |
| Patrol, no reaction or flares | 100 | 68 | 68 | 66 |
| Reaction, no flares | 100 | 68 | 68 | 65 |
| Reaction plus flares | 100 | 68 | 9 | 8 |

All three variants withhold the same 32 no-lock cases. Among actual locked
launches, kills fall from **65/68 (95.6%)** without flares to **8/68 (11.8%)**
with flares. These percentages describe the deliberately selected deterministic
matrix, not real-world probabilities or statistical estimates.

| Initial range | Locked launches per variant | No-flare reaction kills | With-flare kills |
| --- | ---: | ---: | ---: |
| 0.8 km | 20 | 17 | 2 |
| 1.5 km | 20 | 20 | 0 |
| 2.5 km | 20 | 20 | 2 |
| 3.5 km | 8 | 8 | 4 |
| 5 km | 0 | — | — |

Range labels refer to initial geometry, not the slightly different actual
launch range after acquisition; individual `launchState` records retain that.
In all 68 flare-enabled launches, a flare is released and the sampled seeker
enters confirmed `track` on a flare. 59 later show `lost`, and 61 contain a
gimbal-related guidance cutoff. Terminal outcomes are 51 expiries, eight ground
impacts, one nonlethal aircraft burst and eight kills. The three no-flare
reaction non-kills are nonlethal fuze bursts, not complete misses.

Example: initial 1.5 km tail geometry, shooter 750 m / 107.78 m/s, target 1210 m.
Actual launch range is 1548.86 m. With flares the sampled sequence after launch
is aircraft track → memory at 1.6 s → confirmed flare track at 1.8 s → aircraft
reacquisition at 5.4 s → memory at 6.4 s → lost at 7.0 s. Closest approach is
87.38 m and the missile expires. This shows actual decoy tracking followed by
failed recovery, not merely an inflated event counter.

## Assessment and next action

The user's post-lock symptom is reproduced across multiple favorable aiming
conditions. **Current flare susceptibility is a strong candidate for excessive
misses.** Reaction alone changes very little in this matrix; adding flares
changes outcomes sharply. This is evidence of the model's behavior, not proof
of a real-world numerical target for AIM-9X performance.

Prioritize reviewing IR return competition, decoy confirmation/track persistence
and aircraft reacquisition. Repeated `decoy_transfer` emissions are a separate
diagnostic issue and do not explain away the confirmed flare tracks. Do not
raise a hit-rate constant or simply weaken flares to hit a chosen percentage.
Any fix should address a demonstrated state/model defect, preserve independent
geometry/energy failures, and rerun these exact paired launches.
