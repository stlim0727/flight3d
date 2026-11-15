# Controlled countermeasure and reaction audit

Implementation status and subsequent work remain in
[issue #713](https://github.com/stlim0727/flight3d/issues/713).
This numeric fixture audit separates inventory, actual release, seeker transfer,
observed flight motion and terminal outcome. It does not estimate real-world
countermeasure effectiveness or validate rendered/player combat.

## Reproduce

```sh
mkdir -p .cache
timeout 30s node scripts/audit-combat-defense.mjs --output .cache/defense-audit.json
```

The report contains revision, dirty state, Node version, timestep, configuration,
all resolved scenario inputs, actual launch states, outcomes, defense events and
5 Hz target/missile histories including terminal samples. Commit changes before
collecting final evidence. A dirty report is provisional. The fixture uses flat
terrain and no stochastic inputs. Compare results rather than wall-clock timing.
No browser is needed for these pure simulation checks.

## Controlled comparisons

The default audit uses 48 initial geometries: two missile types × four ranges
(800, 1,500, 3,000, 7,000 m) × three aspects (0°, 90°, 180°) × two altitudes
(1,500, 8,000 m). Every geometry runs five variants, totaling 240 situations:

| Variant | Warning/reaction | Chaff inventory | Flare inventory | Reference |
| --- | --- | --- | --- | --- |
| passive | off | off | off | — |
| reaction-only | on | off | off | passive |
| reaction-chaff | on | on | off | reaction-only |
| reaction-flare | on | off | on | reaction-only |
| reaction-both | on | on | on | reaction-only |

Every variant uses the same physical `evasive_ai` target fixture and its 1,000 m
initial patrol radius. Passive means a patrolling physical aircraft with threat
response disabled, not a straight kinematic target. The audit rejects differing
launch states within a geometry. The response treatment includes warning,
heading and commanded-speed changes together; it does not isolate steering from
warning or throttle. These controls belong to the audit fixture, not player UI.

Inventory permission does not force release. Summaries count cases with actual
release and cases with a decoy transfer separately. A transfer is not necessarily
an escape: the missile may reacquire the aircraft or cause damage. Each paired
comparison retains both terminal labels and whether both variants launched.
No-lock cases retain their denominators and are not counted as defense success.
Timeouts remain unresolved.

## Observed results (baseline `c233190`, 2026-11-15)

The added observation/control options preserve the default matrix's existing
physics. The controlled 240-case audit produced these kills/launches:

| Variant | AIM-9X | AIM-120C |
| --- | ---: | ---: |
| passive | 18/18 | 21/24 |
| reaction-only | 18/18 | 21/24 |
| reaction-chaff | 18/18 | 7/24 |
| reaction-flare | 2/18 | 21/24 |
| reaction-both | 2/18 | 7/24 |

Each variant has 24 situations per missile type. AIM-9X has six no-locks per
variant; AIM-120C has none. With compatible inventory, all 18 launched AIM-9X
cases released flares and transferred to a decoy, but two still killed the
aircraft and two ended in a non-lethal detonation. All 24 AIM-120C cases released
chaff; 22 had a decoy transfer, while seven still killed the target. These are
selected deterministic cases, not operational success probabilities. Irrelevant
decoy inventory produced no transfers and did not change terminal outcomes.

Reaction alone changed trajectories but did not change the aggregate kill count
in this sample. Shared-time maximum position differences were about 163 m for
AIM-9X and 5,832 m for AIM-120C. The latter includes long flights already ending
in misses and must not be read as terminal miss distance. Peak observed target
G across reaction-only cases was 5.8 (existing 120 Hz maximum rounded to 0.1G),
not a guaranteed 7G break. Target bank and speed envelopes in the report are
sampled at 5 Hz and can miss extrema. Warning/response events are measured at
120 Hz; warning source remains unspecified by the current interface.

## Named behavior characterization

A separate four-case probe uses AIM-120C, 7 km, 90° aspect, 3 km altitude and no
countermeasure inventory. Unlike the treatment comparisons above, named patrol
fixtures have different geometry and can have different actual launch states.

| Target fixture | Terminal | Time after launch | Peak observed G |
| --- | --- | ---: | ---: |
| straight | kill | 9.892 s | unavailable (kinematic fixture) |
| orbit | kill | 10.808 s | 4.4 |
| break_turn | kill | 10.875 s | 4.4 |
| evasive_ai | kill | 10.008 s | 1.1 |

Orbit and break_turn share the same flight controller and differ in desired
patrol radius (1,200 vs 450 m). Their trajectories differ by up to 78.25 m over
55 common sampled instants, despite identical kill labels and rounded peak G.
Matching aggregate terminal counts do not establish duplicated scenarios.
Neither fixture name certifies a 4G or 7G maneuver. The straight fixture has
no flight controller and cannot run threat response; requesting that combination
is rejected rather than silently claiming evasion.

The 5 Hz history records target position, velocity, speed, measured G and bank,
warning phase/response weight, missile position/speed and sampled seeker
state/target type. Samples compare only at matching 120 Hz ticks; distinct
terminal endpoints are not compared as if simultaneous. This is not an exact
seeker transition log, full sortie recording integration, a complete aircraft
sensor model or calibration against real missile performance.
