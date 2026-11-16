# B1 Audit: Post-Lock Under-Hit Failure Classification (`#794` / `#770` / `#780`)

Baseline commit: `1bf1e94` (`main`, after PR #792/#795/#796/#797/#799/#800/#801).

## Purpose
Separate actual implementation defects, intended model limits, missing observation/ECCM/IRCCM discrimination (input to **B2**), and unresolved cases across:
1. The **100-geometry (`68` locked-IR) cohort** (`300` runs).
2. The **2.5 km / 20-geometry IR recovery cohort** (`120` paired/cutoff runs).
3. The **240-case defense grid** (`AIM-9X` and `AIM-120C` × 5 defense controls).
4. **Renderless Coastal Cruise sorties** separating single-shot (`close-pursuit`) vs multi-shot (`pursuit`) across `none`, `single`, and `burst` countermeasures.

---

## 1. Locked-IR Cohort (`300` Runs, `68` Locked Launches Each)

Command: `combatExperimentConfig({ scenario: 'locked-ir', diagnostics: true })`

| Variant | Locked / Total | Kills | Non-Lethal Blast (`intended_model_limit`) | Flare Dispensed | Confirmed Transfers | `missing_observation_discrimination` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `passive` | 68 / 100 | **66** | 2 | 0 | 0 | 0 |
| `reaction-only` | 68 / 100 | **64** | 4 | 0 | 0 | 0 |
| `reaction-flare` | 68 / 100 | **33** | 4 | 68 | 35 | **31** (`14` G-saturated late reacquire, `3` late reacquire miss, `13` FOV loss, `1` degraded non-lethal blast) |

*(The `32` `no-lock` geometries remain outside the launch denominator.)*

---

## 2. 2.5 km / 20-Geometry IR Recovery Audit

Command: `timeout 60s node scripts/audit-ir-recovery.mjs`

| Variant | Kills / 20 | Terminals | Reacquired (`< 800 m`) | Mean Flare Track | Saturated on Reacq | Propellant 0 at CPA |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| `evasionOnly` | **20** | 20 `hit` | — | 0 s | 0 | 14 |
| `flareOnly` | **2** | 2 `hit`, 18 `timeout` | 8 (8) | 4.38 s | 8 | 14 |
| `control` (`reaction+flare`) | **0** | 20 `timeout` | 8 (8) | 4.38 s | 6 | 14 |
| `cutoff0.2s` (diag) | **20** | 20 `hit` | 20 (0) | 0.09 s | 8 | 14 |
| `cutoff2s` (diag) | **16** | 16 `hit`, 4 `timeout` | 20 (6) | 2.10 s | 9 | 14 |
| `cutoff4s` (diag) | **5** | 5 `hit`, 14 `timeout`, 1 `miss-ground` | 10 (5) | 3.88 s | 8 | 14 |

**Diagnostic finding:** Hiding the flare at `0.2 s` restores **20/20** hits (0 implementation defects in seeker reacquisition, PN guidance, or fuze). The drop in `control` from `2/20` (pre-#792) to `0/20` on `1bf1e94` stems from #792's climbing evasion combined with lateral/vertical flare ejection velocity (`22 m/s` lateral, `-12 m/s` vertical), keeping the missile seduced for `4.38 s` until the target leaves the `65°` gimbal or reacquires too late inside `800 m` with `0` propellant and `35 G` saturation.

---

## 3. 240-Case Defense Grid (`AIM-9X` vs `AIM-120C`)

Command: `runCombatDefenseAudit()`

| Weapon | Variant | Locked / Total | Kills | Dispensed (Flare / Chaff) | Confirmed Transfers | `intended_model_limit` | `missing_observation_discrimination` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `AIM9X` | `passive` | 18 / 24 | **18** | 0 / 0 | 0 | 0 | 0 |
| `AIM9X` | `reaction-only` | 18 / 24 | **18** | 0 / 0 | 0 | 0 | 0 |
| `AIM9X` | `reaction-chaff` | 18 / 24 | **18** | 0 / 18 | **0** | 0 | 0 |
| `AIM9X` | `reaction-flare` | 18 / 24 | **6** | 18 / 0 | **12** | 0 | **12** (`10` untraced post-decoy terminal, `2` non-lethal) |
| `AIM9X` | `reaction-both` | 18 / 24 | **6** | 18 / 18 | **12** | 0 | **12** (`10` untraced post-decoy terminal, `2` non-lethal) |
| `AIM120C` | `passive` | 24 / 24 | **21** | 0 / 0 | 0 | 3 (`2` 800m beam G-sat, `1` terrain) | 0 |
| `AIM120C` | `reaction-only` | 24 / 24 | **21** | 0 / 0 | 0 | 3 (`2` 800m beam G-sat, `1` terrain) | 0 |
| `AIM120C` | `reaction-flare` | 24 / 24 | **21** | 24 / 0 | **0** | 3 (`2` 800m beam G-sat, `1` terrain) | 0 |
| `AIM120C` | `reaction-chaff` | 24 / 24 | **5** | 0 / 24 | **16** | 3 | **16** (`14` untraced post-decoy terminal, `2` non-lethal) |
| `AIM120C` | `reaction-both` | 24 / 24 | **5** | 24 / 24 | **16** | 3 | **16** (`14` untraced post-decoy terminal, `2` non-lethal) |

**Key structural observations:**
- Cross-channel isolation holds cleanly: `AIM-9X` rejects all `18` chaff releases (`0` transfers), and `AIM-120C` rejects all `24` flare releases (`0` transfers).
- **`AIM-120C` lacks velocity/Doppler association:** In `src/weapons/MissileSeeker.js:167-173`, `association()` returns `1` whenever `!isIR`, so active radar seekers cannot distinguish rapidly decelerating chaff from a moving aircraft by radial velocity / Doppler shift (`21/24` → `5/24` kills, `16` confirmed transfers).

---

## 4. Coastal Cruise Single-Shot vs Multi-Shot (`300 s`, `legacy-break`)

| Attack Skill | Countermeasure | Launched (Dup Follow-Ups) | Kills | Outcomes & B1 Classification |
| --- | --- | ---: | ---: | --- |
| `close-pursuit` (single) | `none` / `single` / `burst` | 1 (0) | **1** | `AIM-9X` at `1497 m`, `0` transfers, `kill` |
| `pursuit` (multi) | `none` | 1 (0) | **1** | `AIM-9X` at `2467 m`, `0` transfers, `kill` |
| `pursuit` (multi) | `single` | 5 (4) | **1** | `#1` `ground_impact` (1 flare transfer → `missing_observation_discrimination`), `#2` `kill` (1 transfer, recovered), `#3–#4` `expired` (1 flare transfer each → `missing_observation_discrimination`), `#5` `AIM-120C` `unresolved` (2 chaff transfers) |
| `pursuit` (multi) | `burst` | 4 (3) | **2** | `#1` `ground_impact` (1 flare transfer → `missing_observation_discrimination`), `#2` `kill` (1 transfer, recovered), `#3` `expired` (1 flare transfer → `missing_observation_discrimination`), `#4` `kill` (0 transfers, bandit flare stock exhausted) |

---

## 5. Summary Classification for B2 Handoff

| B1 Category | Count / Pattern on `1bf1e94` | Disposition |
| --- | --- | --- |
| **Implementation defect** | **0** cases in locked-IR, 2.5 km, defense, and coastal runs | `cutoff0.2s` restores `20/20`; cross-decoy transfers are `0`; no broken seeker/PN/fuze plumbing remains. |
| **Intended model limit** | Non-lethal blasts (`2–4/68`), `AIM-120C` 800 m no-TVC beam G-sat (`2/24`), terrain (`1/24`) | Expected physical/warhead limits under current specs. |
| **Missing observation discrimination (B2 scope)** | `31/68` (`locked-ir` flare), `12/18` (`AIM-9X` defense), `16/24` (`AIM-120C` chaff), `2–3` shots per multi-shot `coastal` sortie | Primary targets for **B2**: (1) `AIM-120C` radial-velocity/Doppler consistency against decelerating chaff; (2) `AIM-9X` temporal/spatial/kinematic flare rejection beyond single-step angular rate. |
| **Unresolved** | `0` in `locked-ir`/`defense`, `1` in `coastal pursuit+single`, `18–20` in 20 s `audit-ir-recovery` cutoff/control runs | Preserved separately as `unresolved` without inflating misses or kills. |
