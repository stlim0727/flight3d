# F-16 air-to-air missiles (Sprint 1)

Sprint 1 of discussion #612 covers Milestones 1 and 2: six rail missiles on the
F-16, 3D true proportional navigation (TPN), HUD lock symbology and the
three-stage radar warning receiver. Guns, IFF, SAM sites, taxi rearming and the
damage model remain Sprint 2/3 work.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Fire the next loaded missile | `Enter` | `FIRE MSL` |
| Cycle the selected bandit | `N` | `TGT` |

`Space` stays the wheel-brake key. Firing is refused on the ground and when all
six rails are empty. Firing before lock is a Maddog launch: the missile flies
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
  gimbal limit, TPN guidance and closest-approach proximity fuse. Bandit
  targets patrol circular orbits and respawn 8 s after a kill.
- `src/systems/RWRSystem.js` — search / lock / launch stages derived from
  emitter position and velocity plus inbound hostile missiles.
- `src/weapons/MissileCombatView.js` — scene mirror for bandits, released
  missiles, soft smoke trails and explosion handoff.
- `src/aircraft/F16.js` — six rail meshes; `setMissileLoadout()` hides fired
  stations.
- `src/ui/HudView.js` — seeker field-of-view circle, TD box / lock diamond,
  `SHOOT` cue, range and closure, off-screen locator, weapon inventory and RWR
  azimuth display.
- `src/audio/FlightAudio.js` — synthesized launch whoosh, lock tone and the
  three RWR beep cadences.

The system advances on its own fixed 120 Hz accumulator inside the render
frame, so missile motion and the proximity fuse do not depend on frame rate.
Physics is not tunnelled through targets when the renderer stalls.

## Verification

```sh
node --test tests/airToAirMissile.test.js tests/rwrSystem.test.js
npm run check
node scripts/verify-f16-missiles.mjs   # hardware GPU browser evidence
```

The browser check verifies the six-rail loadout, HUD lock, `Enter` launch,
rail separation, smoke trail, proximity kill and RWR track stage. It requires
`/dev/dri/renderD128` access; see [browser GPU setup](browser-gpu.md).

Unit coverage includes the station release order, lock rise/decay, target
cycling, TPN intercept of a crossing target, powered acceleration versus
coasting drag, ground/empty launch refusal, and all three RWR stages.
