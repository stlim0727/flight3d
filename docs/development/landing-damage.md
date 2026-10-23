# Landing damage and runway scraping

The runtime now keeps landing incidents in the 120 Hz contact solver instead of
sending every runway body contact directly to the explosion path. Obstacle,
water and off-runway terrain collisions retain their existing fatal behavior.

## Failure conditions

Each nose/left-main/right-main leg retains independent numeric damage and a
`normal`, `damaged` or `collapsed` state. The limits in
`src/physics/gearDamage.js` are tunable simulator settings, **not aircraft
certification data**. Supported conditions are:

- Initial contact speed along the terrain normal, including body angular velocity.
- Sustained combined vertical, lateral-slip and longitudinal braking loads.
  The loads are the Coulomb-limited tire forces the contact solver delivers in
  the wheel tangent frame, including nosewheel steering, not a speed proxy.
- Continued descent beyond suspension travel.
- Loading an incompletely extended leg or commanding retraction under load.
- Asymmetric contact and successive impacts after a bounce. Damage never decreases
  during flight, loss of contact or a gear extension/retraction cycle.

A single ordinary load spike does not collapse a leg: continuous overload is
integrated over time. Severe initial contact may cause immediate collapse.
A damaged leg has reduced support and loses nosewheel steering; a collapsed leg
supplies no suspension, braking, or steering forces. Other legs remain independent.

## Body contact and incident lifecycle

`src/physics/groundContacts.js` defines lower-surface support points for both
nacelles, the belly, forward fuselage, tail and wingtips. These are active even
with gear down, so one failed leg can lead to an engine/wing contact. Support,
damping, friction and moments use local terrain normals. The old fixed gear-down
height floor no longer holds failed aircraft above the runway.

Support patches follow the loaded GLB's lower envelope (including the long
belly, nacelle front/rear and wing sweep); the procedural fallback has a separate
profile. Each part shares its stiffness/damping across its patches. After
integration, a unilateral position/normal-velocity constraint limits support-point
penetration to **4 cm**, including after a fatal crash. It uses body inertia and
surface normals, never animates pitch/roll, and cancels only closing velocity.
Collision classification uses the incoming pose so this correction cannot lift an
aircraft out of a water, mountain or obstacle collision. Crash visuals no longer
rotate the airframe independently of its physical contacts.

The penetration budget is a **vertical** distance. On a planar slope, moving a
distance `d` along the normalized terrain normal changes vertical clearance by
`d / normal.y`, because the sampled terrain height changes with X/Z too. The
normal correction is therefore `excessPenetration * normal.y`. Tests require
the minimum clearance to reach -4 cm, not just remain above that lower bound.
Curved terrain is sampled again during the existing four correction passes;
the bundled Lukla boundary/DEM fixtures allow a 2 mm residual because their
normals use 2 m finite differences. This is not an exactness guarantee for every
nonlinear surface.

`bodyDamage.js` separates first-contact impact energy (squared normal speed,
including angular contact velocity) from friction work (`friction force * slip
speed * dt`). The strongest new patch impact per part is counted once per step;
friction work is summed. Damage never heals in the air or on gear cycling.
Unloaded contact and stable rest do not add abrasion. Imminent impact is sampled
before penetration correction can remove its incoming velocity.

| Part | Impact onset / exhaustion (m/s) | Abrasion work for full damage (MJ) |
| --- | --- | --- |
| Each engine | 2 / 10 | 45 |
| Belly | 3 / 12.5 | 300 |
| Nose | 3 / 10 | 180 |
| Tail / each wing | 2 / 8 | 100 |

These are simulator tuning parameters, not aircraft certification data. Numeric
damage drives engine integrity continuously: target spool, thrust, core speed,
fuel flow and temperature approach the windmilling/offline state as integrity
reaches zero. Existing engine-out yaw uses the resulting differential thrust.
Engine restart commands cannot repair ground damage. Exhausted nose/belly/wing/
tail integrity, or an initial body impact above 12.5 m/s, triggers the existing
fatal path. Engine abrasion alone can end in a controlled stop without hull loss.

Part-specific contact and `damaged` (0.3) / `failed` (1.0) transition notices are
emitted once; telemetry retains all seven numeric part values. Ground speed below
0.5 m/s and angular speed below 0.02 rad/s must persist for one second before the
stopped notice. Movement clears that notice state. Presets/restart repair gear,
body and engine damage and clear incident/contact history.

| Scenario | Physical progression |
| --- | --- |
| Left/right main collapse | Low-side nacelle/wing contact, asymmetric drag and engine degradation |
| Both main legs collapse | Nacelle/belly support, abrasion and deceleration |
| Nose collapse | Nose-down rotation and forward body/engine contact; nose steering unavailable |
| Severe wing/tail strike | Part impact damage and possible structural failure |
| Controlled belly landing | Continued abrasion while sliding, then stable damaged rest |
| Bounce/recontact | Existing damage retained; a new impact can add damage |

`CollisionDetector.checkCollision` accepts the integrated ground-contact result
as its final argument. Runtime runway landings use that result. Detection-only
callers without a contact solver retain geometric body-strike detection; those
tests do not validate the new load model.

## Verification

- `tests/gearDamage.test.js`: load/impact thresholds, time-step consistency,
  bottom-out, combined and lateral loads, nose/one-sided impacts, terrain-normal
  and angular contact speed, partial extension, bounce history, reset, body forces,
  and preservation of fatal obstacle/off-runway collisions.
- `tests/bodyContact.test.js`: work/impact accumulation, 60/120/240 Hz abrasion,
  no damage at rest, reimpact, wing/tail failure, engine integrity and restart,
  incoming impact preservation, flat/sloped penetration and constraint energy.
- `tests/boeing737Pbr.test.js`: per-leg indication/articulation, frame-to-frame
  stability and repair.
- `npm run test:landing`: deterministic browser scenarios for normal, severe,
  asymmetric, unlocked, left/right/both main and nose collapse, controlled belly
  and catastrophic body landings, plus reset. All controlled incidents must stop
  and hold ten seconds without significant further abrasion (tolerance 1e-4).
  Every sampled support point must stay within 4 cm of terrain; the final loaded
  airframe mesh vertices must remain within 10 cm. Tests require the real GLB to
  finish loading. Writes histories/hold states/mesh clearances to `scenarios.json`;
  `--screenshots` captures exterior views and a 412x915 mobile viewport. A nonempty scenario result and all assertions are required.

Example (start Vite on the same port separately):

```sh
PORT=5186 CDP_PORT=9468 ARTIFACT_DIR=/tmp/landing-damage npm run test:landing -- --screenshots
```

Set `CHROME_BIN` to the Chrome executable on Windows. `test:crash` also accepts
`CHROME_BIN`, `PORT` and `CDP_PORT`. Set `FORCE_GPU=1` for ANGLE/Vulkan where supported; otherwise SwiftShader is used.
The script owns a temporary browser profile and stops the browser after the run.

## Follow-up scope

Tire burst, wheel lock/anti-skid failures, steering jams, soft soil, ditch/curb
geometry, aerodynamic overspeed damage, dedicated sparks/scrape audio, and
persistent fuselage mesh deformation are not implemented by this change.
Structural abrasion is a friction-work approximation, with fixed part budgets. Body collision
uses discrete support points, not a deformable mesh or continuous swept-volume
solver. Parameters need further tuning across aircraft masses and landing attitudes.

## Issue #167 evidence

See [review evidence](../../review-artifacts/issue-167/README.md) for measured
clearances, scenario summaries and desktop/mobile images. The mobile run checks
responsive rendering in Chrome emulation; it is not a Samsung Browser device test.
Loaded coastal scenarios and analytical slopes are covered; a full loaded-DEM
Lukla incident campaign and arbitrary inverted attitudes remain outside this run.
