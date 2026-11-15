# Coastal Cruise virtual-pilot experiment

> Historical baseline. Its pursuit adapter omitted the player's virtual
> elevator/rudder routing, so the acceleration/controller conclusions below
> are provisional. See [latest-main revalidation](coastal-cruise-revalidation.md)
> for the corrected adapter and confirmed-lock single-shot results. Current
> `probe-cruise-combat.mjs` runs that corrected 18-case experiment.

2026-11-15, main `c2331901b5cbdd7f581a36573825e74395a6ea8d`, issue #713.
This is a deterministic numerical reproduction of a reported difficult start,
not a real-world missile success-rate estimate or a browser acceptance test.
No gameplay coefficients were changed.

## Reproduce

```sh
timeout --signal=TERM --kill-after=5s 60s node scripts/probe-cruise-combat.mjs
```

Twelve sorties, 100 simulated seconds each, 120 Hz. Local outputs:
`.cache/cruise-combat/report.json` (full trajectories) and `summary.json`
(initial conditions, individual missiles, guidance, outcomes and event records).
The historical recorded summary is preserved at
[commit 367af0a](https://github.com/stlim0727/flight3d/blob/367af0a/docs/development/cruise-combat-results.json).
The final run completed in approximately 11 seconds on this host.

## Scope and controls

- Coastal Cruise position `[-600,750,3200]`, velocity `[96,0,-49]` m/s,
  preset yaw `-0.35π`, computed hands-off trim and settled engine spool reproduce
  `PresetSpawner.js`. Initial target ranges and IR qualities match the earlier
  browser startup snapshot, but no completed browser sortie is claimed.
- Uses the existing `createHeadlessSimulation` with production `PresetSpawner`,
  player `PhysicsIntegrator`, `FlightControls`, F-16 aerodynamics, engines, mass,
  physiology and collision handling. `BanditFlightModel.guide` supplies only the
  pursuit controller through virtual inputs; it does not own the player's plant.
  UI, audio, rendering, and human piloting are not exercised. No teleportation or
  direct pose rotation occurs during flight; Coastal wind remains the preset default.
- Uses production target placement, Bandit flight/evasion, seeker, countermeasure,
  missile physics, fuze and damage code. The production seeded Coastal analytical
  height function is used without allocating its meshes/textures. Water at 0 m
  is additionally a pilot crash boundary.
- Pilot uses target truth only to command pursuit heading/altitude; weapon
  sensing and guidance receive no ideal-quality or truth override.
- Immediate policy fires all six rails at 0.35 s intervals. Locked policy fires
  one IR missile after full lock; close-locked adds range ≤2.5 km. One shot avoids
  counting a redundant shot at an already-destroyed target as a weapon failure.
- All sorties start at the same actual 107.78 m/s. Speed commands are either
  107.78 or 250 m/s; the latter accelerates through engine forces, not a faster
  spawn. The firing window ends at 75 s; missiles are followed through 100 s.
- The countermeasure control sets both flare/chaff inventories to zero on every
  tick, including respawns. Evasion and all other models remain enabled.

## Results at the starting speed command

| Policy | Countermeasures | Fired | Fuze bursts on aircraft | Kills |
| --- | --- | ---: | ---: | ---: |
| Immediate six-rail salvo | enabled | 6 | 2 | 2 |
| Immediate six-rail salvo | disabled | 6 | 1 | 1 |
| Locked single AIM-9X | enabled | 1 | 0 | 0 |
| Locked single AIM-9X | disabled | 1 | 1 | 1 |
| Locked single AIM-9X within 2.5 km | enabled | 1 | 0 | 0 |
| Locked single AIM-9X within 2.5 km | disabled | 1 | 1 | 1 |

Initial IR quality is **0.0861 / 0.0668**, below the **0.25** threshold,
at **5.46 / 6.34 km**. Thus an immediate launch is unlocked. All four immediate
AIM-9X expire in both controls, after delayed in-flight acquisition. With default
countermeasures their closest sampled separations from BANDIT 1 are 897–1140 m;
the first missile flies approximately 3.14 s without an estimate. Their sampled
control-limited time is zero, so this run does not support blaming turn-authority
saturation. Energy/sensor causes would require isolated interventions to separate.

The later two rails are AIM-120C, not IR. With countermeasures they each detonate
and kill an aircraft. Without countermeasures the first kills BANDIT 1 and the
second loses that now-destroyed target. This shared-target interaction explains
why the enabled salvo can produce more kills; it is not evidence that chaff
generally improves missile performance. Six-rail totals are not six independent
attempts against fresh targets.

The locked single AIM-9X launches at 27.275 s / 3.045 km, and the close-locked shot
at 29.30 s / 2.499 km. Both miss with countermeasures (closest sampled distances
210.56 m and 126.94 m), pass through gimbal-related guidance cutoff/lost estimate,
then expire. Both kill with countermeasures disabled (continuous fuze distances
0.624 m and 0.370 m). Since histories are identical before the single launch,
this paired result supports countermeasure influence in this particular case.

The 250 m/s-command pilot fires the same immediate salvo while still slow, with
the same terminal counts. Both lock-gated policies fire **zero** shots: the
pursuit controller fails to hold acquisition geometry long enough (sampled
maximum lock 0). These are withheld launches, not missile misses, and do not
show that acceleration makes missiles worse. The virtual pilot needs better
intercept/boresight control before judging faster lock-gated launches.

No pilot terrain collision or non-finite pilot state occurred. All fired
missiles terminated inside the observation window. These are deterministic
cases, not statistical confidence estimates; repeating identical inputs does
not add independent samples.

## Follow-up findings

1. Default initial geometry is unsuitable for an immediate IR lock. Weapon-type,
   lock state and launch-envelope communication should be evaluated in the UI.
2. Investigate flare susceptibility with a denser geometry/engine-state sweep
   before changing coefficients. This run reproduces a sharp paired difference.
3. `decoy_transfer` is emitted repeatedly for the same bandit/flare during
   confirmation: one locked missile emits 18 such events, one tick apart.
   These are raw emitted events, **not 18 confirmed transfers**. Inspect event
   semantics and seeker confirmation before interpreting aggregate diagnostics.
4. Improve the accelerated pursuit pilot, then vary heading/altitude/speed and
   acquisition duration. Current results do not certify full player behavior,
   human usability or realistic weapon performance.
