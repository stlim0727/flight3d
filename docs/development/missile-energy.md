# Missile aerodynamic authority and maneuver energy

Follow-up to [bandit threat response](bandit-evasion.md) and
[issue #713](https://github.com/stlim0727/flight3d/issues/713).
The velocity-aligned point-mass model limits lateral force by dynamic pressure
and charges drag for the maneuver actually delivered. It does not target a
chosen hit percentage or introduce random misses.

## Model and evidence

`src/weapons/MissileFlightModel.js` owns independent actuator state per missile.
The existing 120 Hz combat loop supplies mass, rocket thrust, density and a PN
request. Propellant mass, burn duration, thrust taper, lifetime, seeker gates and
proximity/damage logic retain their existing parameters.

The force model uses SI units and frontal reference area `S = pi*d²/4`:

```text
q = 0.5 * density * speed²
available lateral acceleration = min(structuralG * g, q * S * CLmax / mass)
CL = mass * delivered lateral acceleration / (q * S)
base drag = q * S * CD0
maneuver drag = q * S * K * CL²
```

NASA Glenn's [lift equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/)
supports the general pressure/area/coefficient scaling. Its
[drag coefficient discussion](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-coefficient/)
explains reference-area consistency, lift-related drag and flow-condition limits.
These sources were checked on 2026-11-14. They do **not** validate missile-specific
coefficients: this quadratic maneuver polar is a game approximation, not a
demonstrated supersonic missile polar derived from NASA's wing example.

| Parameter | Current value | Evidence status |
| --- | --- | --- |
| `maxLateralG` | 35, both types | Existing game structural cap; not manufacturer-certified. |
| `maxLiftCoefficient` | 12, both types | New assumption, referenced to frontal area, not wing area. |
| `inducedDragFactor` | 0.025, both types | New assumption using the same frontal-area convention. |
| `autopilotTimeConstantS` | 0.12 s, both types | New response assumption, not measured actuator data. |
| `dragCoefficient` | 0.32 / 0.28 | Existing constant base-drag approximations for AIM-9X / AIM-120C. |

Constants are explicit in `missileSpecs.js`. Low-pressure authority follows
density and speed squared, up to the structural cap. Mach-dependent coefficients,
separated body attitude, fin deflection and AIM-9X thrust vectoring remain
unmodeled. The aerodynamic low-speed bound must not be presented as a validated
AIM-9X launch envelope. Real seeker estimation, warhead effects and missile-specific
propulsion calibration remain separate work.

## Force and integration invariants

- PN produces a line-of-sight-normal request. The plant projects it onto the
  velocity-normal plane. This approximation is not the unmodified true-PN law
  or a certified real-missile controller.
- While guidance is valid, lateral gravity compensation consumes the same
  control authority. Full external gravity always remains active, including
  after tracking loss and during coast.
- The command passes through exponential first-order response. Stored acceleration
  is projected and limited **again** against current pressure and structural
  authority after filtering; it cannot preserve unavailable force after a drop.
- Maneuver drag uses delivered aerodynamic force, not raw command magnitude.
  All control force in this bounded model is aerodynamic. Zero pressure yields
  zero lift/drag without dividing by zero.
- Turning rotates velocity direction instead of applying an Euler normal-vector
  kick that would create speed numerically. A positive scalar drag update
  dissipates speed without reversing it; thrust supplies energy, and full gravity
  changes the velocity vector. Position uses old/new velocity trapezoidal
  advancement, exact for force-free ballistic motion under constant gravity.
- Split turning/gravity and scalar thrust/drag integration remain approximations.
  Variable-force trajectories have timestep error. Refinement tests are required.
  At zero speed, each missile uses its own orientation, never shared scratch state.

`missile.flight` exposes pressure, requested/available/delivered acceleration,
base/maneuver drag, mass and thrust for diagnostics. These are not new HUD claims
or sensor observations supplied to the bandit pilot.

## Repeatable comparisons

The original 18-run paired matrix remains at 9/9 hits for patrol targets and
9/9 for evasive targets. A force model does not require favorable shots to miss.

Those are pre-IR acceptance results. The subsequent [IR model](infrared-signal.md)
can reject rail acquisition; current default comparisons report `no-lock` separately.
The aerodynamic regression now explicitly requests `{ idealSensor: true }` to keep
its sensor-independent control, rather than overriding the default model silently.

`compareMissileEnergyEnvelope()` adds 24 runs: both missile types and patrol/evasive
targets for each set below. Target speed is 240 m/s and commanded orbit radius
1,500 m. The launcher retains the stationary-position fixture and acquisition
procedure. Aspects describe initial geometry, not constant-aspect trajectories.

| Separation | Initial aspect | Altitude | Inherited launch speed |
| --- | --- | --- | --- |
| 1,800 m | Head | 1,000 m | 300 m/s |
| 5,500 m | Beam | 1,000 m | 150 m/s |
| 5,500 m | Beam | 10,000 m | 150 m/s |
| 7,500 m | Tail | 10,000 m | 300 m/s |
| 8,000 m | Beam | 1,000 m | 100 m/s |
| 8,000 m | Beam | 10,000 m | 100 m/s |

Recorded Node results: 20 hits and four lifetime expiries. The expiries are the
AIM-9X 8 km / 100 m/s launches, at both altitudes with both pilot settings;
AIM-120C hits in those samples. Existing lifetime contributes to the boundary and
was not changed. These are newly added samples, **not** proof that all four hit
previously or that the new model alone caused the misses.

Reports include terminal state/speed, approximate integrated maneuver-drag work
per mass, duration where requested acceleration exceeded capacity, bandit reaction
and sampled separation. In the AIM-9X 5.5 km / 150 m/s beam sample, demand exceeds
capacity for about 0.04 s at 1 km altitude and 1.98 s at 10 km. Lower drag at altitude
can still preserve more speed: range and agility cannot be inferred from density
alone. Sampled separation is not the substep fuze distance.

A controlled coast comparison starts at 700 m/s with no thrust/gravity, density
1 kg/m³ and a 180 m/s² rotating normal demand for six seconds. Straight flight
ends at about 624.1 m/s; turning ends at about 486.1 m/s. This isolates maneuver
energy loss, not real missile performance or probability of kill.

## Verification

```sh
node --test tests/missileFlightModel.test.js tests/airToAirMissile.test.js tests/banditThreatResponse.test.js
APP_URL=http://127.0.0.1:PORT GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless ARTIFACT_DIR=.cache/missile-energy node scripts/verify-bandit-evasion.mjs
```

Follow [hardware GPU setup](browser-gpu.md). The script verifies hardware WebGL2
shader/readPixels drawing, renders controlled evasion/recovery poses, then moves
to a lightweight same-origin page for numerical comparisons. It checks the coast
experiment, pressure-limited force and 24-run envelope in addition to the original
matrix. Snapshots and `report.json` are local artifacts. The normal animation loop
is stopped during the scene check. This is not an unmodified human sortie or
a complete missile-defense acceptance scenario.

Focused tests cover density/speed scaling, saturation, abrupt pressure loss after
response filtering, force/drag accounting, unloading, no-work lateral turning,
free fall, zero-speed orientation, burnout/pause/reset and timestep refinement.
For the six-second coast/turn probe, 120 Hz position error must be below 4 m versus
a 960 Hz reference and shrink versus 60 Hz. Logic, bundling and rendered-scene
checks establish different things; none certifies real-world kill probability or
completes issue #713.

Recorded acceptance on 2026-11-14: 48 focused tests, syntax/action checks and
production build passed. Chrome 156.0.8078.73 used ANGLE / Intel Graphics ADL-N /
Vulkan 1.4.335; WebGL2 shader readback was `[255, 0, 0, 255]`, GL error 0.
Controlled scene pose/recovery, the original 18-run matrix, the 24-run envelope
and the coast experiment all passed in that browser. Early combined runs timed
out; final acceptance stopped the normal scene loop, bounded recovery steps and
used a lightweight page for numerical work, with a task-owned watch-disabled
server kept alive for the complete check. No software rendering was used.
