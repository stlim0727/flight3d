# F-16 Lukla escape guidance

Base: `e402bf3` (main, including demo sweep PR #289). Tested 2026-10-29,
Node 22.23.2, loaded bundled Lukla DEM, shared Flight3d Chrome session.

## Result

| Observation | Original | Tuned |
| --- | --- | --- |
| Route | Nose-radome terrain crash at 28.0 s | Completed at 42.22 s |
| Peak sampled IAS | 388.7 kt | 308.3 kt |
| Minimum clearance recorded by scenario at 120 Hz | 7.7 m | 151.52 m |
| Maximum bank before impact / tuned route | 33.1° | 37.47° |
| Tuned maximum absolute G, checked every tick | — | 1.3985 |
| Control handoff | Never reached | Powered, inputs released; actual pose/rates retained |

The original is **climbing**, not descending, at the ridge: +10,052 fpm at
27.75 s, but the terrain rises faster. `comparison.json` retains the baseline
KNOWN findings and the tuned measurements. The old crash exemptions are removed
from the route table, so recurrence now fails the sweep.

The turn begins 1 km earlier; its bank command limit is 45° rather than 35°.
The climb target is 300 KIAS rather than 340, with 35 m/s vertical command rather
than 55. Reduced fighter-specific throttle feed-forward avoids accelerating into
the ridge while the bank develops. Lift/AoA feedback still commands pitch through
normal control surfaces; no physical forces, terrain or collision limits changed.

The old handoff forcibly flattened velocity and reset attitude/rates, then solved
level trim (which yielded zero commanded throttle). Completion now waits for an
actual escape: at least 30 s in CLIMB, within 5° of heading 195°, bank under 10°,
positive vertical velocity and clearance over 150 m. It preserves flown motion.

## Browser verification

The sweep's physics/checking code was run using a temporary adapter that replaces
only browser startup/cleanup with the shared project CDP browser on port 9225,
and serves this worktree through Vite on port 5197. Ports/browser lifecycle are the
only changes to the normal driver in this adapter.

- Final strict sweep: **0 FAIL / 0 REPORT / 0 KNOWN**, with the new baseline.
- Repository gate: `npm run check`, `npm test` (871/871), and `npm run build` passed.
  Focused guidance/sweep tests passed again after the baseline was written.
- Original route reproduced once with 0.25 s samples (`KEEP_SAMPLES=1`): crash at 28 s.
- Tuned route completed; separate baseline collection flew it three times on one
  page, recording the worst peaks. Baseline generation reports NO BASELINE until
  it writes the new entry; those reports are expected.
- Additional acceptance run wrapped `integratePhysics` to collect unrounded
  clearance, IAS, absolute G, stalls and crashes **after every physics tick** and
  extended the driver from four to eighty inactive slices (20 s after handoff).
  All 7,440 ticks: minimum clearance 151.684 m, peak IAS 308.292 kt, peak |G|
  1.3985, zero stalls/crashes. The scenario also measures before integration,
  explaining its slightly lower 151.520 m minimum.
- After the unattended 20 s hold: 273.7 KIAS, 2,400.5 m AGL, no damage or stall.
  This is a bounded hold check, not a promise of indefinite hands-off flight.
- Existing `scripts/verify-f16-lukla.mjs` passed completion, clearance, shader,
  restart and cancellation checks with one-second stepping. Its captures show
  the escape turn and exit climb without the sweep's pause-menu overlay.

`escape-turn.png`: approximately 21 s, 307 kt, heading 217°, 1.34 G.
`exit-climb.png`: approximately 41 s, heading 200°, nearly wings-level.
These are frame captures, not a real-time animation or listening acceptance.

Normal reproduction (private browser supported by the repository driver):

```sh
npm ci
npm run build
node scripts/demo-sweep.mjs --only f16-lukla-low-pass --strict
```

For the existing shared-browser capture harness:

```sh
APP_URL=http://127.0.0.1:5197/ chrome-session --project flight3d node scripts/verify-f16-lukla.mjs
```
