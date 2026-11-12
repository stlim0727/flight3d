# F-16 air-to-air combat (Sprints 1-2)

Discussion #612 splits the air-combat work into three sprints. Sprint 1 covers
Milestones 1 and 2: six rail missiles, 3D true proportional navigation (TPN),
HUD lock symbology and the three-stage radar warning receiver. Sprint 2 adds
Milestones 3 and 4: the M61A1 Vulcan cannon with an LCOS pipper, progressive
combat damage, and the landed rearm turnaround. IFF, SAM sites and autonomous
bandit airfields remain Sprint 3 work.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Fire the next loaded missile | `Enter` | `FIRE MSL` |
| Fire the cannon | `Space` while airborne (hold) | `GUN` (hold) |
| Cycle the selected bandit | `N` | `TGT` |

`Space` remains the wheel-brake key on the ground; the combat system consumes
it as a trigger only while airborne. Missile firing is refused on the ground
and when all six rails are empty. Firing before lock is a Maddog launch: the missile flies
ballistically until its seeker picks up a bandit inside the 65° gimbal. The launcher releases rails in the order
`STA 1 → 9 → 2 → 8 → 3 → 7` (4× AIM-9X then 2× AIM-120C). A preset restart
reloads every rail.

## Implementation

- `src/weapons/missileSpecs.js` — missile data and F-16 station coordinates in
  the aircraft frame (+X starboard, +Y up, -Z nose).
- `src/weapons/missileGeometry.js` — procedural AIM-9X / AIM-120C and bandit
  meshes. No new binary assets.
- `src/weapons/AirToAirMissileSystem.js` — pure combat state: seeker lock
  integration, 120 Hz rocket mass/thrust, atmospheric drag, gravity, seeker
  gimbal limit, TPN guidance and closest-approach proximity fuse. It owns the
  cannon step and the shared damage/respawn path. Bandit targets patrol
  circular orbits and respawn 8 s after a kill.
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
3. **Bandit POV** — once the missile is within 1.6 km of its target, the eye
   moves above and beside the bandit's canopy, looking back down the bearing.
   A proximity-driven telephoto widens the round from a speck into the frame;
   the shot lingers 1.4 s through detonation before routine shots resume.

If the round is still far after 9 s of follow, routine shots run until the POV
entry range, and the sequence aborts cleanly if the missile expires or misses.
Replays keep their own director timeline and never trigger this sequence.
`CameraSystem.setCombatStateProvider()` supplies the live missile/target arrays.

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
