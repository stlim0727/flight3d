# Combat matrix evidence

The authoritative implementation status and follow-up order remain in
[issue #713](https://github.com/stlim0727/flight3d/issues/713).
This tool checks model behavior; its scenario fractions are not real-world kill probabilities.

For comparisons with independently controlled chaff, flares and warning/reaction
on the same initial flight fixture, see [controlled defense audit](combat-defense-audit.md).

## Reproduce a report

From a clean checkout with installed dependencies:

```sh
mkdir -p .cache
timeout 30s node scripts/sweep-combat-situations.mjs --output .cache/combat-matrix.json
```

The versioned JSON records the Git revision, dirty status, Node version, timestep,
duration, flat terrain fixture, sweep configuration, resolved per-case inputs,
results, cell denominators and investigation patterns. Commit changes before
collecting final evidence; a dirty report is provisional and its SHA alone cannot
identify the modified source. Compare result rows rather than elapsed wall time.
No stochastic inputs are used by this fixture, so the seed is null.

`rangeM` and `aspectDeg` label the initial setup. Lock acquisition advances both
aircraft, so these are not necessarily the launch conditions. `launchState`
records actual range, simulation time, positions and velocities immediately before
firing; it is null for an unsuccessful launch. Times in `defense` are seconds
after launch, sampled at 120 Hz. They record observed warning, confirmed threat,
response weight above 0.01, and actual chaff/flare release counts. The response
weight is a controller demand, not evidence that a particular G was achieved.
The current warning interface does not distinguish optical and RF detection.

`countermeasures: true` permits inventory; it does not force release. In the
default 1,280-condition sweep, straight/orbit/break_turn released no decoys.
The evasive AI cases released 92 chaff clouds and 92 flares. This does not measure
their individual effectiveness or represent player countermeasure controls.

## Outcome and investigation policy

Every row has one terminal outcome. The summary preserves no-lock, fire refusal,
kill, non-lethal detonation, ground impact, expiration, other missile loss,
independent target destruction and unresolved timeout separately. A target
destroyed without the missile kill event is not credited as a missile kill.
Timeout is not a confirmed miss. Empty denominators are null, not 0% or 100%.
Each type/range/aspect cell includes total situations, launches and kills.

Short-range beam cohorts are checked per missile type. One type's successful
intercepts cannot hide the other's zero-kill cohort. All-hit and zero-kill patterns
request investigation; they do not establish missing RWR, insufficient TVC or
other physical causes. A non-lethal detonation is not automatically a dud, and a
kill beyond 10 km is not automatically impossible. Those outcomes remain in rows
and summaries without unsupported anomaly labels.

## Historical result correction (2026-11-15)

The CLI's same 1,280 cases were run on the pre-review TVC commit `21c0664`
and compared to baseline `e5e0919` (no weapon/matrix changes after #756 merge).
The only runtime source changes between the pre-review commit and #756 merge
are `MissileFlightModel.js` and `missileSpecs.js` in `f23047d`, which bound the
nozzle lateral force and account for high-alpha lift and axial thrust loss.

| Outcome | Pre-review `21c0664` | Merged baseline `e5e0919` |
| --- | ---: | ---: |
| Launches / situations | 836 / 1,280 | 836 / 1,280 |
| Kills | 660 | 646 |
| Kill fraction of launches | 78.9% | 77.3% |
| Non-lethal detonations | 12 | 10 |
| AIM-9X beam kills at 400/800 m | 30 / 32 | 23 / 32 |

All 16 changed terminal outcomes are AIM-9X cases:

| Initial condition | Behavior / countermeasure inventory | Count | Transition |
| --- | --- | ---: | --- |
| 400 m, 90°, 8,000 m altitude | straight/orbit/break_turn, each with inventory off/on; evasive_ai with inventory off | 7 | kill → expiration |
| 800 m, 135°, 8,000 m altitude | same seven combinations | 7 | kill → expiration |
| 800 m, 135°, 1,500 m altitude | evasive_ai, inventory on | 1 | non-lethal detonation → ground impact |
| 800 m, 135°, 8,000 m altitude | evasive_ai, inventory on | 1 | non-lethal detonation → expiration |

Thus the old comment reproduces the pre-review implementation. The lower merged
result is not evidence of a new regression after merge. This comparison isolates
the changed implementation, not each physical term's individual contribution or
the real-world accuracy of the resulting coefficients.

The merged baseline has 444 no-locks, 646 kills, 49 ground impacts, 131
expirations and 10 non-lethal detonations. The reporting changes preserve those
outcomes. AIM-120C's 400/800 m beam cohorts remain zero-kill and now appear as a
separate investigation pattern. Node tests and the numeric sweep supply this
evidence; no browser, rendered scene or actual sortie is verified here.
