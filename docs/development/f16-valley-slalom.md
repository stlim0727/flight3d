# Valley slalom — course and judging contract (`valley-slalom-v1`)

## Experience goal

The valley is meant to be carved, not survived. The line a good run flies stays
low, rolls through every bend and comes back down after it is forced up; a run
that climbs out of the valley and levels off above the ridges is a failed run
even when it crosses every gate. That is why the objective is measured against a
ceiling that moves with the ground underneath it rather than against a single
flat target: staying in the low passage space is the whole game, and the speed
that makes the bends tight enough to be exciting is the speed the airframe was
measured at.

The accepted `valley-low-v1` runs on Lukla sit at 283–304 m median AGL over a
5.7 km valley. Those numbers are evidence that the physics, the sensor model and
the scoring path work end to end. They are not the goal of this mission and they
are not used to size anything in it.

## What this file freezes, and when

Order matters: the contract is fixed **before** any controller is tuned against
it, so no threshold here is a by-product of a pilot's result.

- Course geometry, generation rules and validity criteria: this file plus
  `src/arena/generatedValley.js`, `src/arena/slalomCourse.js`.
- Measured basis: `docs/development/f16-valley-envelope.json`, frozen into
  `src/arena/slalomEnvelope.js` as `f16-slalom-envelope-v1`.
- Judging: `src/arena/SlalomMission.js`.
- Validation seeds, pre-fixed and not to be edited after tuning: dev `1..10`
  (allowed to shape the controller), evaluation `101..108` (used only after the
  parameters are frozen). Both lists live in `scripts/validate-valley-courses.mjs`
  and `scripts/run-valley-slalom.mjs`.

A seed that generates an un-flyable valley is a **generation failure**; a seed
the aircraft cannot finish is a **pilot failure**. The runner classifies the two
separately and exits non-zero only on the former. Neither list may be shortened
after the fact: dropping a course because a pilot failed it turns the mission
into a report about the courses nobody failed. Any change to these numbers
requires a new version string and its own score space — old results are never
re-judged under new rules.

`valley-low-v1` stays exactly as it is: the same course, evaluator, cost formula
and score space, kept as the regression baseline for the shared navigation work.

## Measured basis

`scripts/measure-valley-envelope.mjs` runs the production F-16 (12 000 kg, clean,
idle to a quarter throttle, no terrain, no pilot) through sustained-turn, sink,
climb and roll sweeps at 2 100 m and 2 500 m and writes the raw archive to
`docs/development/f16-valley-envelope.json`. `src/arena/slalomEnvelope.js`
freezes the pessimistic side of both altitudes, with no extrapolation outside the
measured grid:

| Quantity | Value | Measured |
| --- | --- | --- |
| Scored airspeed band | 220–320 KIAS | plant held, `MEASURED_ROWS` |
| Maximum bank for credit | 60° (1.95–1.97 g, attached, 237–296 kt) | the measured 70° rows settle at 189–206 KIAS — below the scored band — at 22–27° α |
| Roll establishment to 60° | 1.6 s worst case | roll-response sweep, peak ≈90–97°/s |
| Decision plus command lag | 0.4 s | 5 Hz period + 24-tick delay |
| Bank reversal, both sides | ≈519 m at 280 kt, ≈593 m at 320 kt | `bankReversalMeters` |
| Sustained climb authority | 27–36 m/s; budget 21.6 m/s | `energy`-hold climbs at a third of throttle |
| Sustained sink at 60° bank | −33.3 m/s at 220 kt, −28.7 m/s at 320 kt (−10.6 to −16.2 m/s wings-level) | `energy`-hold sink sweeps at both altitudes |
| Energy sink conversion | 0.6 | baseline trace trades 14–16 m/s for 3.2–3.7 kt/s |

With PR #384 eliminating the idle thrust creep artifact, idle throttle produces
sustained natural sink across all speeds in the band (−10.6 to −16.2 m/s wings-level),
and steep bank deepens the sink via induced drag (−28.5 to −33.3 m/s at 60° bank).
A course that demands a descent steeper than what the airframe can sustain or pay
for in airspeed is refused by `assessLeg` at generation time.

## Course generation

`mulberry32(seed)` drives a heading-continuous polyline of constant-curvature
legs sampled every 25 m, with smooth value noise added so a valley is not a
perfect prism and stays exactly reproducible.

| Rule | Value | Why |
| --- | --- | --- |
| Gates | 7 (6 scored legs) | ~6.8 km of valley per course at these legs |
| Leg length | 750–1200 m | floor is the 320 kt bank reversal (≈593 m) plus room |
| Heading change per leg | 8–24°, alternating side | a 750 m leg at 240 kt has a 24.7° turn budget, so the band tops out exactly where the shortest leg stops being flyable; mean bend over the seeds is 16°/leg |
| Corridor half-width | 240–340 m | flat valley floor; the walls rise outside it (180–500 m of ridge, 1.4–3.0 exponent) |
| Passage half-width | 130 m | lateral band a gate is credited in |
| Gate aim offset | 0.4–0.85 of the room left after the band, alternating | the low line runs at the wall side, not down the middle |
| Passage band | 60 m floor + 40–90 m | a real slab of air above the ground under it |
| Floor step | −25 m down, up to +72 m on 35% of legs | the shortest leg can sink 143 m and climb 131 m at cruise |
| Speed envelope | 220–320 KIAS, legs assessed at the 240 kt cruise the spawn declares | turn rate and sink ceiling are both measured, never extrapolated, at that speed |
| Clearance floor | 20 m AGL | shared with low-v1 |
| Chart resolution | 100 m along a 25 m sample grid | a route to read, not a terrain array |
| Timeout | 14 400 ticks = 120 s | same wall clock as low-v1; ~55 s of flying at cruise |

Arc integration is half a step at the old heading, the whole step's turn, then
half a step at the new heading; each leg begins at the previous leg's last
sample. Anything cheaper quietly shortens every bend, and the gate then sits
~1.4° upstream of the geometry it was sized for. `tests/generatedValley.test.js`
holds both invariants: the declared per-leg bend and the measured gate-to-gate
heading change agree to 0.5°, and walking the route equals the reported length.

## Validity gate

`assessCourse` checks the generated ground, not the idealised profile, and
rejects:

- `leg-turn` / `leg-climb` / `leg-sink` — the leg demands more heading, ascent or
  descent than `assessLeg` budgets at cruise;
- `leg-shorter-than-a-bank-reversal` — the line the gates describe cannot exist;
- `passage-space-outside-the-corridor`, `passage-crosses-a-wall` — the band does
  not fit inside the valley;
- `passage-band-anchored-to-a-hillside` (>20°) and
  `gate-floor-is-not-the-ground-under-it` — an AGL ceiling that depends on which
  line the pilot chose is not a rule;
- `passage-band-above-the-ridge` — climbing out would be the easy option;
- `line-leaves-the-corridor` and `line-climb-demand-exceeds-the-airframe` along
  the gate-to-gate line;
- `line-leaves-the-valley` — the intended lateral move is wider than the valley.

Override the rules to something impossible and the gate bites: `headingChangeDeg:
[40, 60]`, `floorStepDownM: 200`, `passageBandM: [400, 600]`,
`corridorHalfWidthM: [60, 80]` all produce generation failures rather than
harder levels. Over the fixed seeds, all 18 courses generate valid (dev mean
6 792 m, eval mean 6 876 m).

    npm run test:slalom:courses    # generation + validity only
    npm run test:slalom            # generation + validity + production-physics flights

## Judging

Gates are ordered and each is a **terrain-connected passage space**: the lateral
band around the gate's own aim point, under a ceiling measured from the ground
under that band. A gate is credited where its plane is crossed — signed
cross-track and AGL interpolated between the two samples that straddle `gate.sM`
— inside the band and under the ceiling. A missed gate ends the run, because
slalom order cannot be recovered later.

Corner cutting is closed by geometry rather than by a rule nobody can read: the
corridor follows the curving centreline, so a straight line across a bend leaves
the course (`corridor-excursion`) before it saves anything, and the gates alternate
sides so the middle of the valley is not the short path anyway.

Hard ends: `invalid-snapshot`, `crash`, `body-strike`, `damage`, `timeout`,
`clearance-floor`, `speed-envelope`, `invalid-spawn`, `discontinuous-flight`,
`corridor-excursion`, `gate-missed`.

Altitude cost uses fixed 25 m progress bins sampled on first entry (loitering
cannot dilute a bin), against the **interpolated passage ceiling** rather than a
flat target:

    excess(bin) = max(0, AGL − ceiling(progress))
    altitudeCostM = 0.7 · mean(excess) + 0.3 · P95(excess)   # successful runs only

so an avoidance climb over rising terrain is allowed and is charged for, and
returning into the low space stops the charge. `medianAglM`, `minAglM`,
`maxAglM`, `meanIasKnots`, `gatesCleared`, `progressM` and `durationSeconds` are
reported next to it; a failure earns no altitude score.

## What a pilot may know

Host-only: the terrain itself, the ground heights behind the gates, and the seed
that regenerates both (`manifest.terrain.seed` is not in the briefing; the
briefed course has no `seed` and no `floorM`). A seed in the chart would be a
terrain array by another name.

Briefed chart (`createBriefing` → `course`): the 100 m route with its corridor
widths, the ordered gates with their lateral band and AGL range, the waypoints
(`start` plus one per gate at the middle of its passage space), the clearance
floor and the envelope version. It is labelled as a chart — a navigation aid, not
a steering solution.

Live measurement: one shared navigation model for the HUD and for SDK pilots, at
5 Hz with the same 24-tick delay and the same noise — noisy bearing and range to
the next waypoint *and* to the finish, each as `{status, mean, std, sampleTick}`.
There is no recommended altitude, no future terrain array, no terrain-relative
climb command and no position-indexed hint anywhere in the observation; the
forward terrain range sensor is unchanged from low-v1.

## Baseline before controller work

`scripts/run-valley-slalom.mjs` with the `valley-low-v1` example pilot
(`examples/valley.js`), mild disturbance, sensor noise on, 2026-11-01:
18/18 seeds fly on production physics, 0 generation failures, 0 completions.
Every run ends `gate-missed` at 0–4 of 6 gates, median AGL 76–130 m, 241–269 kt.

That is the intended starting point. The pilot was written for a point-gate
course with a flat 50 m target and no ceiling to stay under; on a contract that
credits only the band at the wall side, it misses gates it never aimed at. This
row is the number controller work has to move, recorded before any controller
touched the thresholds. Generalisation is judged by the same two lists: lower
altitude cost on the unseen evaluation valleys while completion and clearance
hold, with the course, the judging and the physics left exactly as documented
here.
