# Missile Engagement Flight Recording & Analysis

Flight3d preserves full air-to-air missile engagement causal history inside single exported
sortie files (`flight3d.sortie.v1`), allowing pilots and analysts to trace engagements
chronologically from launch conditions through seeker tracking, sensor loss, countermeasure
reactions, guidance cutoff, aerodynamic limits, proximity fuzing, damage, and termination.

---

## Architecture Overview

```
                      AirToAirMissileSystem
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   Seeker Transitions    Flight Diagnostics    Terminal Events
   (track, lost, fov)    (qBar, lateral G)     (fuze CPA, damage, kill)
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
                       ReplayRecorder (v7)
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
      Compact Binary Track               Engagement Analysis Engine
   (COMBAT_TRACK_VERSION = 7)         (flight3d.engagement.v1)
               │                                 │
               └────────────────┬────────────────┘
                                ▼
                      flight3d.sortie.v1
               (Self-contained sortie artifact)
```

1. **Non-Intrusive Observation**: Simulation physics, seeker estimation, guidance commands, and
   countermeasure reactions are calculated authoritatively once in `AirToAirMissileSystem`, `MissileSeeker`,
   `Flare`, and `Chaff`. Recording is strictly observational and never alters physical states or sensor evaluations.
2. **Compact Binary Encoding (`COMBAT_TRACK_VERSION = 7`)**: High-rate state transition events and
   rate-limited diagnostic samples (5 Hz) are encoded in a backwards-compatible binary format.
3. **Structured Engagement Debrief (`flight3d.engagement.v1`)**: Analyzed engagement summaries
   (`analyzeCombatEngagement`) are embedded directly into `report.engagement` in exported sorties.

---

## Telemetry Fields and Units

### 1. Execution Identity
| Field | Unit / Type | Description |
|---|---|---|
| `schemaVersion` | String | Format identifier (`flight3d.engagement.v1`) |
| `appBuild` | String | Application commit or build identifier |
| `scenario` | String | Flight mission/scenario (e.g. `bvr_intercept`, `dogfight`) |
| `aircraft` | String | Player aircraft type (e.g. `F16`) |
| `airport` | String | Active theater or runway (e.g. `coastal`, `incheon`) |
| `durationSec` | Seconds (s) | Total simulated flight duration |
| `sortieReason` | String | Reason for sortie conclusion (`completed`, `manual`, `crashed`) |

### 2. Launch Conditions & Seeker State
| Field | Unit / Type | Description |
|---|---|---|
| `launchTimeSec` | Seconds (s) | Exact time of rail separation |
| `launchLocked` | Boolean | Seeker lock status at trigger release |
| `launchLockProgress` | Fraction (0.0–1.0) | Rail lock acquisition progress |
| `launchPosition` | Meters [x, y, z] | Three.js world coordinates (+Y up) |
| `launchVelocity` | m/s [vx, vy, vz] | World velocity vector at launch |
| `seekerState` | Enum | `search`, `acquire`, `track`, `memory`, `lost` |
| `lossReason` | Enum | Actual cause of observation failure: `fov_limit`, `range_limit`, `terrain_occlusion`, `low_signal`, `invalid_geometry`, `target_destroyed`, `incompatible_decoy` |
| `signalQuality` | Fraction (0.0–1.0) | Target thermal/radar contrast ratio |
| `angleOffDeg` | Degrees (deg) | Off-boresight angle between seeker centerline and target LOS |

### 3. Flight Dynamics & Guidance Diagnostics (5 Hz)
| Field | Unit / Type | Description |
|---|---|---|
| `guided` / `guidanceActive` | Boolean | Whether guidance command output was active |
| `cutoffReason` | Enum | Guidance inhibition cause: `none`, `range_too_close`, `low_speed`, `gimbal_limit`, `negative_closure`, `no_estimate` |
| `speedMps` | m/s | True airspeed |
| `mach` | Dimensionless | Airspeed relative to local speed of sound |
| `altitudeM` | Meters MSL (m) | True altitude |
| `dynamicPressurePa` | Pascals (Pa) | Dynamic pressure ($q = \frac{1}{2}\rho v^2$) |
| `requestedLateralG` | g (load factor) | Commanded proportional navigation lateral acceleration |
| `availableLateralG` | g (load factor) | Aerodynamically achievable lift limit under current $q$ |
| `deliveredLateralG` | g (load factor) | Actual actuator response clamped by available and structural caps |
| `dragN` | Newtons (N) | Total aerodynamic drag (base drag + induced maneuver drag) |
| `propellant` | Fraction (0.0–1.0) | Remaining rocket motor burn capacity |
| `targetRangeM` | Meters (m) | Slant range to target |

### 4. Countermeasures & Decoys
| Field | Unit / Type | Description |
|---|---|---|
| `decoyType` | String | `flare` (IR countermeasure) or `chaff` (RF countermeasure) |
| `decoyId` | Integer | Unique identifier of dispensed decoy cloud |
| `sourceId` | String | Aircraft releasing countermeasure (e.g. `bandit_1`) |
| `decoy_transfer` | Event | Seeker tracking redirected from target to decoy due to signal dominance |

### 5. Terminal Phase, Fuze & Damage
| Field | Unit / Type | Description |
|---|---|---|
| `fuzePolicy` | String | Proximity fuze algorithm (`continuous_fuze_cpa` or `direct_hit`) |
| `distanceM` | Meters (m) | Distance at closest point of approach (CPA) burst |
| `damage` | Percentage (0–100%) | Integrated warhead fragment structural damage |
| `hitZone` | Enum | Airframe component impacted (`fuselage`, `wing`, `engine`, `tail`, `nose`) |
| `kill` | Event | Confirmed target airframe destruction |
| `outcome` | Enum | `kill`, `survived_fuze_blast`, `expired`, `ground_impact`, `unresolved_sortie_ended`, `other` |

---

## Storage Budget & Pruning Policy

To prevent recorded replays from exceeding `localStorage` quotas or causing memory strain:

1. **Fixed Header & Sample Sizing**:
   - Section header remains 18 bytes for seamless backward compatibility.
   - Diagnostic samples (28 bytes each) are appended after combat events when present.
2. **Prioritized Pruning Ladder**:
   When storage budget pressure occurs during long sorties:
   - **Stage 1**: Decimate diagnostic samples (halve rate, double interval).
   - **Stage 2**: Decimate missile kinematic samples (halve rate).
   - **Stage 3**: Decimate bandit position samples (halve rate).
   - **Critical Preservation**: Discrete combat events (`launch`, `seeker_state`, `decoy_dispense`,
     `decoy_transfer`, `detonation`, `damage`, `kill`, `expire`, `unresolved_end`) are **never dropped**
     unless the entire combat section must be cleared.
3. **Fidelity Integrity**:
   Whenever decimation occurs, the recorder stamps `fidelity.downsampled = true` and updates
   `diagnosticIntervalSec` in the exported metadata so analysts know data resolution was reduced.

---

## Backward Compatibility & Legacy Files

- **Track Versions v1 through v6**: Decoders parse older binary formats without regression. Missing
  sensor, guidance, and countermeasure fields decode as `null` or `unknown`.
- **Attached v6 Replays (e.g. `flight3d-F16-flight _3_.json`)**:
  - Automatically recognized as `fidelity.isLegacyTrack = true`.
  - In-flight missiles alive at sortie termination are designated `unresolved_sortie_ended` with
    clear explanations that v6 tracks lacked sensor state telemetry.
- **Sortie Unification**:
  `createSortie(report, trackOrReplay)` automatically analyzes combat tracks and populates
  `report.engagement` without mutating original references or interfering with peaceful flights.
