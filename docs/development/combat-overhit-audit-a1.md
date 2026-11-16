# A1 Audit: Over-Hit & Forbidden Information Access (`#794` / `#713`)

Baseline commit: `9aaf32e` (`main`, after T0/T1/T2 merges `#795`, `#792`, `#796`, `#797`, `#799`).

## Scope
Audit the missile guidance, seeker, flight model, and fuze/terrain collision pipeline in `src/weapons/` for defects that could cause missiles to hit unrealistically easily, using fixed policies and geometries without altering gameplay balance constants.

## Audited Paths & Findings

| Suspected Over-Hit Path | Result | Code & Evidence |
| --- | --- | --- |
| 1. Guidance receiving hidden truth during loss/occlusion | **Dismissed** | `AirToAirMissileSystem._guide` feeds `missile.seeker.estimate` only when `hasEstimate` is true (`src/weapons/AirToAirMissileSystem.js:652-653`). Under `terrain_occlusion`, `MissileSeeker.update` enters `memory` and extrapolates the frozen prior velocity without reading hidden target acceleration/position (`src/weapons/MissileSeeker.js:231-244`), expiring to `lost` after `seekerMemorySeconds`. Verified in `tests/combatOverhitAuditA1.test.js`. |
| 2. Force / turn-rate limit bypass | **Dismissed** | `MissileFlightModel.step` computes `availableLateralMps2 = min(maxLateralG * g, aeroLateralMps2 + maxTvcLatMps2)`, clamps `request`, applies first-order actuator response, and **re-clamps** `lateralAcceleration` after filtering (`src/weapons/MissileFlightModel.js:52-68`), while deducting induced drag and TVC cosine thrust loss (`lines 75-83`). Verified immediately across boost-to-coast transition in `tests/combatOverhitAuditA1.test.js`. |
| 3. Same-time fuze vs terrain collision ordering | **Confirmed Defect & Fixed** | `AirToAirMissileSystem._guide` previously evaluated `fuzeClosestApproach` across the full `[0, 1]` substep before checking terrain impact (`missile.position.y <= ground + 1`). A missile intersecting terrain at `groundTime <= triggerTime` could detonate its proximity fuze through/behind terrain instead of ending as `surface_collision`. Fixed by computing `terrainImpactFraction(prevPosition, position, terrainHeight)` and prioritizing `groundTime <= triggerTime`. Regression test in `tests/combatOverhitAuditA1.test.js` failed with `fuze_burst` before the fix and passes with `surface_collision` after. |
| 4. Reset / replay diagnostics mismatch | **Dismissed** | `combatExperiment.test.js` and `combatEvaluationContract.test.js` confirm `--diagnostics` invariance on both matrix and `coastal` scenarios, and `combatSkills.test.js` confirms `combat.reset()` clears flare threat state and skill histories. |

## Verification & Regression
- Regression suite: `tests/combatOverhitAuditA1.test.js` (including pre-fix reproduction of terrain-before-fuze `fuze_burst` -> `surface_collision`).
- Unfavorable control (`AIM9X`, `10000 m`, `180°` head-on aspect, `reaction-flare`): `noLock: 1`, `kills: 0`.
- B-condition locked-IR regression (`AIM9X`, `1500/2500 m`, `0°` tail, `750:1210` m, `108 m/s`): `passive` vs `reaction-flare` ordering intact (`passive.kills >= flare.kills`) with existing matrix and coastal tests passing.
