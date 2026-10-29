# Demo sweep — first accepted full matrix

Fast-played all fourteen cinematic demo routes through deterministic 120 Hz physics in
headless Chrome and judged the flight, not the code path. Reproduce with:

```sh
npm ci && npm run build
ARTIFACT_DIR=review-artifacts/demo-sweep node scripts/demo-sweep.mjs --tier all --shots
```

Run 2026-10-29 against this branch, `google-chrome-stable` with Vulkan
(`--use-gl=angle --use-angle=vulkan`, `/dev/dri/renderD128`), 0.25 s slices, 11,877 slices and
2,960 s of simulated flight in 257.7 s of wall clock. `demo-sweep-report.json` is the machine
record of this run; the 28 PNGs are one mid-route stage plus the handoff frame per route.

## Verdict

| route | tier | verdict | sim s | wall s | FAIL | REPORT | KNOWN |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `b738-coastal-classic` | core | clean | 161 | 30.7 | 0 | 0 | 0 |
| `c172-coastal-scenic` | core | clean | 77 | 6.8 | 0 | 0 | 0 |
| `c172-coastal-maneuvers` | full | reports | 75 | 5.0 | 0 | 1 | 0 |
| `c172-coastal-proximity` | full | clean | 38 | 3.4 | 0 | 0 | 0 |
| `b738-lukla-classic` | core | known issue | 126 | 24.8 | 0 | 0 | 1 |
| `c172-lukla-scenic` | full | clean | 73 | 7.5 | 0 | 0 | 0 |
| `c172-lukla-maneuvers` | full | clean | 75 | 5.0 | 0 | 0 | 0 |
| `f16-lukla-low-pass` | core | known issue | 28 | 3.1 | 0 | 0 | 5 |
| `f16-lukla-canyon-chase` | full | clean | 38 | 3.8 | 0 | 0 | 0 |
| `b738-incheon-departure` | full | clean | 385 | 48.8 | 0 | 0 | 0 |
| `c172-incheon-tour` | full | clean | 477 | 32.2 | 0 | 0 | 0 |
| `b738-incheon-sihwa-tour` | full | clean | 378 | 28.9 | 0 | 0 | 0 |
| `c172-incheon-sihwa-tour` | full | clean | 689 | 28.2 | 0 | 0 | 0 |
| `f16-incheon-sihwa-tour` | full | clean | 341 | 14.5 | 0 | 0 | 0 |

**0 hard failures, 1 soft report, 6 declared known issues.** Every route visited its expected
stage sequence and handed the controls back in its declared mode; no stall, no gear damage, no
non-finite state, no browser exception anywhere in the matrix.

## The two Lukla routes are broken, and the sweep says so out loud

Neither Lukla demo has ever flown unattended before, and both end in a terrain crash. They are
declared in `scripts/lib/demoSweepSpec.mjs` as `knownIssues`, which absorbs the matching FAIL,
prints it in the report, refuses to baseline the route, and re-appears as a report asking to be
deleted once the guidance is fixed.

- `b738-lukla-classic` crashes in `CANYON_APPROACH` at 126.0 s: 13 m agl at 111 kt with +15° pitch
  and a positive vertical speed. The valley climbs faster than the guidance climbs and the airframe
  reaches the wall — "Excessive belly impact or accumulated structural damage".
- `f16-lukla-low-pass` ends at 28.0 s in a zoom climb that cannot outrun the ridge. At 27.8 s it is
  at 47.6 m of clearance (the route intends 50 m) at 389 kt, 15.3° of pitch and **+10,052 fpm still
  climbing**; one slice later it is at 6.6 m, still climbing at +10,266 fpm, and the nose radome
  contacts the ridge at 36 rad/s of angular rate. The scenario's own `result.minClearanceM` is
  7.7 m, below the 50 m `scripts/verify-f16-lukla.mjs:79` asserts.

Both reproduce byte-identically through the arming path the existing benchmark uses
(`sim.clock.getDelta = () => 0`, `setAirport`, `demoDirector.start`), so they are demo faults, not
fast-play artifacts. `npm run test:lukla` never caught them: it fails earlier, at
`scripts/test-lukla-demo-benchmark.mjs:81`, because a fresh browser profile auto-starts the coastal
demo instead of the Lukla one. Fixing the guidance is follow-up work outside this change.

## A third finding, which only shows up sometimes

`c172-coastal-scenic` reached the water on 3 of 37 cold-page flights: the route dips below its 25 m
clearance intent at 73.3-74.3 s (23.7 m down to 3.9 m) and then `CRASH WATER` at 86 kt. All three
shared the same signature, and they happened on the pre-Hangang build and on `main` alike, so this
is not a regression from the merge that landed while this branch was open.

It is declared `intermittent` in the route table rather than baselined, because a fault that only
appears on some page loads cannot be proven absent by one clean flight — and the *crashing* runs
are never folded into `demo-sweep-baseline.json`, since `--update-baseline` refuses to widen a
baseline past a FAIL.

The interesting part is the direction. During that clearance collapse the reported vertical speed is
a **climb** of 865-872 fpm, not a descent — the aircraft is gaining height and still ends up on the
water surface, so the open question is what the sampler is measuring the clearance *against*, not
why a command would descend too fast. An earlier draft of this note said "sink", because the
checker printed `vsiFpm` under a "sink" label regardless of sign; that bug is fixed here (see
below) and the mechanism claim built on it is withdrawn.

## The checker bug this found in itself

The first version of the clearance and stall messages was:

```js
`(sink ${round(sample.vsiFpm)} fpm, ...)`
```

`telemetry.vsiFpm` is signed like a real VSI — `src/systems/FlightWarnings.js:66` takes the sink as
`Math.max(0, -vsi)`, and `src/main.js:2145` calls `> 300` "CLB" — so every climb in a message was
printed as a sink. The measurements were always right: `maxSinkFpm` accumulated only negative
`vsiFpm`, which is exactly why `f16-lukla-low-pass` correctly reported `maxSinkFpm = 0` for a route
that never once descended before it hit the ridge. It was the prose — the FAIL text, the route-table
notes and this document — that inherited the wrong word from the template. Messages now go through
`vsiText()`, which prints `climb`/`sink` by sign, and
`tests/demoSweepChecks.test.js` pins both directions plus the rule that a sink is never printed
with a negative magnitude.

All three findings are tracked together in
[issue #292](https://github.com/stlim0727/flight3d/issues/292), which is also the measurement side
of the shared-guidance refactor proposed in [#286](https://github.com/stlim0727/flight3d/issues/286).

## The one soft report

`c172-coastal-maneuvers` peaked at 250 fpm sink against a 228 fpm baseline, and a repeat of the
core tier showed `c172-coastal-scenic` at 48.7 m of clearance against a 55.1 m baseline. These are
drifts against measured worst-of numbers, not envelope violations, and city/ship scenery is placed
with `Math.random` today, so they are advisory by design. Deterministic scenery seeding is the
follow-up that would let them tighten.

## Proof the checker is not a no-op

A gate that always passes proves nothing, so both paths were exercised against real flights.

`STRICT=1` promotes a soft report to a failure and the process exits 1:

```
FAIL c172-coastal-maneuvers · 75s sim in 18.2s wall (303 slices)
  → STRICT: peak sink 250.0 fpm exceeds baseline 228 fpm
1 route(s): 1 fail(s), 1 report(s), 0 known issue(s) in 23.8s wall   exit=1
```

Setting an impossible ceiling on a healthy route (proximity's 140 s budget temporarily edited to
10 s) produces the stuck-route and skipped-choreography failures and exits 1:

```
FAIL c172-coastal-proximity · 11s sim in 16.3s wall (44 slices)
  → STUCK: still active after 11.3 s of simulated time (ceiling 10 s, last stage 2)
  → STAGES NOT FLOWN: TREE_CANOPY, LAKE_SKIM, TOWER_BUZZ, COMPLETED
2 fail(s)                                                            exit=1
```

The ceiling edit was reverted before commit; `git diff` on `scripts/lib/demoSweepSpec.mjs` is the
declared route table only.

## What this costs CI, measured on the hosted runner

Pull request #289 ran the gate for real on `ubuntu-latest`, which has no GPU, so these are
SwiftShader numbers:

| run | tier | routes | result | sweep wall | job wall | ceiling |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| [40807282232](https://github.com/stlim0727/flight3d/actions/runs/40807282232) | core (PR) | 4 | success, 0 fail / 0 report / 6 known | 152.8 s | 177 s | 25 min |
| [40807349278](https://github.com/stlim0727/flight3d/actions/runs/40807349278) | all (dispatch, shots) | 14 | success, 0 fail / 2 reports / 6 known | 941.7 s | 969 s | 45 min |

The pull-request gate costs under three minutes end to end, and the full matrix under sixteen,
both with wide margins. The same commit's `CI` workflow also passed (run 40807282075).

The physics agrees across both drivers: on SwiftShader `b738-coastal-classic` flew 161.07 s of
simulated time and `b738-lukla-classic` crashed at 125.75 s, exactly as on the Vulkan GPU, which is
what deterministic 120 Hz stepping is supposed to mean. Wall clock is what differs — 3 to 4 times
slower without hardware rendering.

Locally, for comparison: the core tier is 66 s and the full matrix 258 s with screenshots, driven
by `google-chrome-stable` on Vulkan.

## Limits of this evidence

This is flight-path and control-contract evidence only. It does not judge audio, camera framing,
or whether the scenery looks right, which the `scripts/verify-*.mjs` harnesses still own. The
screenshots are single frames chosen by the driver at each route's declared `shotStage` and at
handoff. Nothing here claims a deployment, and the PR's own `demo-sweep.yml` run plus a full
dispatch are recorded separately once they exist.
