# F-16 air-to-air combat (Sprints 1-2)

Current missile-realism **Done / In progress / Todo** is maintained in
[issue #713](https://github.com/stlim0727/flight3d/issues/713). Update that tracker
when work starts and after merge, with implementation/evidence links and remaining
limits. The S3/S4 tables below define broader scope and dependencies; a completed
bounded realism item does not mark an entire sprint milestone complete.

Discussion #612 originally split the air-combat work into three sprints. Sprint 1 covers
Milestones 1 and 2: six rail missiles, 3D true proportional navigation (TPN),
HUD lock symbology and the three-stage radar warning receiver. Sprint 2 adds
Milestones 3 and 4: the M61A1 Vulcan cannon with an LCOS pipper, progressive
combat damage, and the landed rearm turnaround. The remaining work is now split
between Sprints 3 and 4 as specified below; the original Sprint 3 summary did
not include every detail in the discussion.

## Missile realism review (#713)

See [missile realism: model review and acceptance](missile-realism.md) for the
current hit-rate limitations, research provenance rules, force/sensor/fuze
invariants and required sequence checks. It is design guidance, not implemented
or validated behavior. The damage distances below are project model targets,
not verified real-world weapon specifications.

## Revised remaining scope (Discussion #612)

Baseline: `4b86b7f` (including #702's F-16-based bandit flight dynamics).
Sprints 1-2 deliver the core firing loop, not the full original damage model or
an end-to-end hostile radar/launch loop. Drone damage already reduces engine
performance and increases drag; per-part damage and player combat damage remain.
The incoming RWR contact direction fix in this change corrects both bearing and
elevation without changing the approach gate.

Difficulty is relative implementation/integration risk, not a duration estimate.

### Sprint 3: single-player combat contracts and integration

| ID | Work / acceptance | Difficulty | Dependencies |
| --- | --- | --- | --- |
| S3-1 | Shared target identity, faction and IFF: friendly/hostile/unknown HUD symbols; identification progression; friendly lock/launch inhibition, including autonomous seeker acquisition. Define gun no-fire behavior explicitly. | Medium | Existing target/HUD interfaces |
| S3-2 | Explicit radar emitter search/track/off state, range/FOV and terrain LOS; distinguish aircraft radar, missile seeker lock and RWR. Define IR vs active-radar seeker state and lock loss/reacquisition rather than treating both missile types identically. | High | S3-1 |
| S3-3 | Airborne bandit engagement and hostile missile ownership/targeting; actual search → track → launch → inbound → lost/expired state drives RWR and audio. IR-only missiles must not fabricate a radar emission. | High | S3-1, S3-2 |
| S3-4 | Connect 5 m lethal / 5-14 m fragment falloff to real detonations for player and AI; route per-part damage into controls, engine, fire/smoke and breakup. Preserve monotonic accumulation and single kill/respawn events. Audit CPA detonation position against damage distance. | High | Existing damage/physics; S3-3 for live incoming acceptance |
| S3-5 | HOTAS/gamepad missile fire, gun hold and target cycle; retain ground brakes, block modal input, clear held triggers on pause/reset/disconnect; physical cannon recoil force/moment. | Medium | Existing controls/cannon |
| S3-6 | Complete runway/apron service-area eligibility, resupply feedback and lifecycle checks; verify departure, landing, interrupted stop, 5 s completion and next sortie. | Medium | Existing turnaround; S3-4 damage policy |

Sprint 3 exit: a human-flown F-16 can identify a target, engage, receive a real
hostile radar/launch warning, take graded damage, and land/rearm. Friendly
protection, terrain lock break, reacquisition, destruction, pause and reset need
sequence tests. This is not completion of all Discussion #612 requirements.

### Sprint 4: countermeasures, battlefield operations and multiplayer

| ID | Work / acceptance | Difficulty | Dependencies |
| --- | --- | --- | --- |
| S4-1 | Flare/chaff inventory, keyboard/touch/HOTAS dispensing, FX, HUD and ground resupply. Flares influence IR seekers; chaff influences radar tracking/seekers through continuous signal/geometry state, with loss/reacquisition tests rather than a guaranteed random lock break. | High | S3-2, S3-3, S3-6 |
| S4-2 | SAM sites in explicitly enabled Incheon/Sihwa/valley combat scenarios; site geometry, search/track/launch, threat envelope, terrain masking and player damage/RWR integration. Protect ordinary demos/missions from unintended combat. | High | S3-1 through S3-4; S4-1 for complete defensive loop |
| S4-3 | Faction-assigned airfields, player/AI runway starts, scramble and waypoint CAP; use current F-16 flight dynamics instead of a second kinematic controller. Terrain-safe takeoff, return/service and respawn/reset lifecycle. | High | S3-1, S3-4, S3-6; current bandit dynamics |
| S4-4 | Multiplayer team tags/IFF, remote target adapters, authoritative launch/hit/damage ownership, event IDs/deduplication and network synchronization; preserve existing room/voice/replay contracts and handle disconnect/rejoin. | Very high | Stable S3 combat contracts; S4-1 countermeasure replication |
| S4-5 | Minimal ownship radar contact display with IFF symbols, range, target designation and lock state, backed by S3 sensor data. Full realistic F-16 radar modes are a separate future proposal. | Medium | S3-1, S3-2 |
| S4-6 | End-to-end battlefield regression: airfield → takeoff → identify → engage → RWR → countermeasure/terrain evade → damage → land/rearm; record/replay new actors, threats and countermeasure events, including multiplayer. | High | S4-1 through S4-5 |

Sequence: identity/IFF → sensor/seeker contracts → hostile engagement and damage
→ countermeasures/SAM/airfield operations → multiplayer → final acceptance.
HOTAS/recoil can proceed independently; multiplayer comes after stable combat
ownership rather than simply removing the current multiplayer exclusion.

Completion requires focused physics/state tests and hardware Chrome evidence
for HUD/FX, controls, audio and the full lifecycle, following browser-gpu.md.
The original seven extension requests plus flare/chaff, remote-aircraft targeting,
HOTAS and the minimal radar display are assigned above. Sprints 3-4 close that
scope only after their acceptance criteria pass; this plan does not mark them
implemented. Original Enter/Space behavior has deliberately become Enter for
missiles and airborne Space for guns; retain N for cycling instead of stealing
browser Tab navigation. Countermeasures need a dedicated binding: C already
cycles cameras and must not be silently reassigned.

## Controls

Bandit patrol pilots now react to observable incoming rocket plumes using a
bounded trial optical-warning model, then return to patrol through the existing
F-16 flight dynamics. See [bandit evasion](bandit-evasion.md) for detection/reaction
assumptions, non-evasive comparison controls, actual outcomes and verification.
This does not complete S3-2/S3-3 sensor/hostile-engagement work or S4 countermeasures.

Missile control now uses pressure-limited aerodynamic authority, actuator-response
memory and delivered-force maneuver drag. See [missile energy](missile-energy.md)
for assumptions, integration invariants and launch-envelope comparisons.

See [radar signal](radar-signal.md) for the active missile seeker observation model and its limits.

See [missile seeker](missile-seeker.md) for terrain-gated observations, finite
track memory and confirmed reacquisition. IR/radar timing and signal inputs are
explicit model assumptions; full sensor physics and countermeasures remain pending.

The default IR channel now uses [relative engine/aspect/range signal](infrared-signal.md)
from live N1/EGT. Its coefficients and explicit AB input are model assumptions;
the existing engine has no independent afterburner dynamics. Radar signal modeling
and countermeasures remain separate work.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Fire the next loaded missile | `Enter` | `FIRE MSL` |
| Fire the cannon | `Space` while airborne (hold) | `GUN` (hold) |
| Cycle the selected bandit | `N` | `TGT` |

`Space` remains the wheel-brake key on the ground; the combat system consumes
it as a trigger only while airborne. Missile firing is refused on the ground
and when all six rails are empty. Firing before lock is a Maddog launch: the missile flies
ballistically until a visible bandit inside the 65° gimbal meets seeker confirmation. The launcher releases rails in the order
`STA 1 → 9 → 2 → 8 → 3 → 7` (4× AIM-9X then 2× AIM-120C). A preset restart
reloads every rail.

## Implementation

- `src/weapons/missileSpecs.js` — missile data and F-16 station coordinates in
  the aircraft frame (+X starboard, +Y up, -Z nose).
- `src/weapons/missileGeometry.js` — procedural AIM-9X / AIM-120C and bandit
  meshes. No new binary assets. All weapon meshes use local forward `-Z`;
  `ConeGeometry` apexes point `+Y`, so nose cones rotate `-90°` about X to lead
  the airframe instead of trailing into it.
- `src/weapons/AirToAirMissileSystem.js` — pure combat state: seeker lock
  integration, 120 Hz rocket mass/thrust, atmospheric drag, gravity, seeker
  gimbal limit, pressure-limited projected PN and closest-approach proximity fuse. It owns the
  cannon step and the shared damage/respawn path. Bandit targets patrol
  a commanded circular route and respawn 8 s after a kill or terrain impact.
- `src/weapons/VulcanCannon.js` — 510-round M61A1 state: 100 rounds/s,
  projectile inheritance of aircraft velocity, gravity and atmospheric drag,
  segment-to-sphere hit tests, projectile life, and the LCOS lead point.
- `src/physics/combatDamage.js` — monotonic damage accumulation, damage-state
  bands and fragmentation falloff. Gun hits add graded damage; missiles use the
  fuse radius as the light drone's lethal radius.
- `src/systems/RearmSystem.js` — continuous ground turnaround: a stopped,
  serviceable F-16 on pavement rearms over 5 s; moving, off-pavement,
  gear-collapsed or hull-failed states block or cancel the request.
- `src/systems/RWRSystem.js` — search / lock / launch stages derived from
  emitter position and velocity plus inbound hostile missiles.
- `src/weapons/MissileCombatView.js` — scene mirror for bandits, released
  missiles, soft smoke trails, damage smoke and explosion handoff.
- `src/weapons/CannonCombatView.js` — tracers and muzzle flash; the gun's
  physics stays in `VulcanCannon`.
- `src/aircraft/F16.js` — six rail meshes; `setMissileLoadout()` hides fired
  stations.
- `src/ui/HudView.js` — seeker field-of-view circle, TD box / lock diamond,
  `SHOOT` cue, range and closure, off-screen locator, gun cross, LCOS pipper
  and funnel, gun ammunition, weapon inventory and RWR azimuth display.
- `src/audio/FlightAudio.js` — synthesized launch whoosh, gun burst loop, lock
  tone and the three RWR beep cadences.

The system advances on its own fixed 120 Hz accumulator inside the render
frame, so missile motion, projectiles, damage and the proximity fuse do not
depend on frame rate. Physics is not tunnelled through targets when the
renderer stalls.

## Guns, damage and turnaround

The pipper is the future target position raised by the projectile's ballistic
drop, so putting the cross on a bandit accounts for lead and gravity. Hits add
0.2 damage each; a drone is destroyed at cumulative 1.0 and trails dark smoke
once damaged. A gun kill emits the same detonation/kill contract as a missile,
so explosions and splash counting stay single-sourced.

After landing, the turnaround requires ground stop below 5 kt on pavement with
gear down and no failed hull part. It takes 5 s and then reloads all six rails
and the 510-round magazine; a preset restart also reloads everything.

## Director camera

Camera mode `9` (CINEMATIC DIRECTOR) cuts on an actual rail release instead of
waiting for a telemetry trend. The sequence is:

1. **Launch** — a wing-mounted action cam holds the F-16 in frame while the
   round separates and its smoke crosses the nose.
2. **Follow** — a rigid chase cam rides 16 m behind the missile, so a 700 m/s
   body stays locked in frame and the smoke trail streams past.
3. **Bandit shot** — once the missile is within 1.6 km of its target, the eye
   moves behind and beside the bandit on the side opposite the inbound bearing.
   The airframe fills the foreground while the round closes past it, so the
   detonation reads as a fireball around the target rather than a distant dot.
   The shot lingers 1.4 s through the burst before routine shots resume.

If the round is still far after 9 s of follow, routine shots run until the POV
entry range, and the sequence aborts cleanly if the missile expires or misses.

Recorded sessions use the same sequence and open in DIRECTOR by default, so a
combat replay shows the bandit airframe and the kill without hunting through the
camera menu. Staged detonations also play a distance-scaled burst from the replay
camera. `CombatReplayPlayback` exposes its interpolated missile and bandit state
to the director, deriving each missile's velocity from sample deltas and marking
the reused missile object dead when playback crosses its detonation. Shot pacing follows the replay clock, so pause
freezes the current beat and every replay speed (0.3x–3x) stays in sync with
the missile.
Seeking resets the director; a seek that lands mid-flight does not replay the
launch beat because the missile's recorded age is already past 2 s. Tracks
recorded before the combat codec (v1–v3) carry no missile poses and stay on
routine shots.
`CameraSystem.setCombatStateProvider()` selects replay combat while a replay is
active and the live arrays otherwise.

## Verification

```sh
node --test tests/airToAirMissile.test.js tests/vulcanCannon.test.js tests/rwrSystem.test.js
npm run check
node scripts/verify-f16-missiles.mjs   # hardware GPU browser evidence
```

The browser check verifies the six-rail loadout, HUD lock, `Enter` launch,
rail separation, smoke trail, proximity kill, LCOS pipper, `Space` gun burst,
tracer/muzzle-flash evidence, gun kill, and rearm completion to 6/6 rails and
510/510 rounds. It requires `/dev/dri/renderD128` access; see
[browser GPU setup](browser-gpu.md).

Unit coverage includes the station release order, lock rise/decay, target
cycling, TPN intercept of a crossing target, powered acceleration versus
coasting drag, ground/empty launch refusal, all three RWR stages, gun rate and
magazine limit, projectile drag/gravity/life, LCOS lead and drop, progressive
gun damage, damage falloff, and every rearm accept/block path.

## F-16-equivalent bandit flight

`BanditFlightModel` uses the same `F16_FALCON` configuration, `Aerodynamics`,
`EngineModel`, fuel/CG/inertia model and airborne integration equations as the
player aircraft. Patrol and canyon guidance command elevator, aileron, rudder
and throttle; positions and velocities are integrated from forces. Rendered bank
and pitch come from the integrated quaternion. `BanditAircraftView` loads the same F-16 exterior asset as the player, with gear
retracted and control surfaces driven by flight state. A procedural proxy covers
asset loading and remains available if loading fails.

The patrol circle is a requested route, not a positional constraint. Guidance
reserves lift margin at 12 degrees AoA, limits commanded normal load to 7G and
pitch demand to 13.5 degrees AoA. These are conservative AI operating limits,
not manufacturer performance claims. Low dynamic pressure widens the turn.
Insufficient thrust or lift can cause speed/altitude loss instead of an enforced
path. Fuel burn, engine spool, induced drag, flow separation and aerodynamic
moments use the shared player models. Damage continuously increases parasite
drag and reduces engine thrust without changing position or velocity directly.

Patrol terrain lookahead commands clearance; an unavoidable impact kills the
target. Canyon targets track their own path progress independently of the player
and use the same airborne plant; they disappear on terrain impact. Neither target
simulates landing gear contacts or takeoff/landing. This is parity with the game's
F-16 model, not validation against a real aircraft's flight-test envelope.

Regression checks: `node --test tests/banditFlightModel.test.js
 tests/f16CanyonChase.test.js tests/airToAirMissile.test.js
 tests/replayCodec.test.js tests/replayCombat.test.js` (one shell command).
The patrol test covers three simulated minutes for each spawn speed, while
separate tests cover damage continuity, low-speed bank limits, unpowered energy
loss, terrain impact and fresh-airframe respawn.
