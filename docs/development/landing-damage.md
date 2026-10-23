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

Body scraping continues through the existing rigid-body integrator. First-contact
normal speed above 12.5 m/s or exhausted accumulated structural health still
triggers the existing fatal crash path. Ordinary scraping produces an incident
notification and can continue to rest. The HUD and individual EICAS gear boxes
show `DMG`/`FAIL`; failed gear geometry folds independently. Incident-induced loss
of ground support must not produce an automatic takeoff camera announcement.
Presets and restart repair damage and clear contact/incident history.

`CollisionDetector.checkCollision` accepts the integrated ground-contact result
as its final argument. Runtime runway landings use that result. Detection-only
callers without a contact solver retain geometric body-strike detection; those
tests do not validate the new load model.

## Verification

- `tests/gearDamage.test.js`: load/impact thresholds, time-step consistency,
  bottom-out, combined and lateral loads, nose/one-sided impacts, terrain-normal
  and angular contact speed, partial extension, bounce history, reset, body forces,
  and preservation of fatal obstacle/off-runway collisions.
- `tests/boeing737Pbr.test.js`: per-leg indication/articulation, frame-to-frame
  stability and repair.
- `npm run test:landing`: deterministic browser scenarios for normal, severe,
  asymmetric, unlocked, controlled belly and catastrophic body landings, plus
  reset. Writes sample histories to `scenarios.json`; `--screenshots` captures
  final rendered states. A nonempty scenario result and all assertions are required.

Example (start Vite on the same port separately):

```sh
PORT=5186 CDP_PORT=9468 ARTIFACT_DIR=/tmp/landing-damage npm run test:landing -- --screenshots
```

Set `FORCE_GPU=1` for ANGLE/Vulkan where supported; otherwise SwiftShader is used.
The script owns a temporary browser profile and stops the browser after the run.

## Follow-up scope

Tire burst, wheel lock/anti-skid failures, steering jams, soft soil, ditch/curb
geometry, aerodynamic overspeed damage, dedicated sparks/scrape audio, and
persistent fuselage mesh deformation are not implemented by this change.
Structural abrasion is a simple distance-based approximation. Body collision
uses discrete support points, not a deformable mesh or continuous swept-volume
solver. Parameters need further tuning across aircraft masses and landing attitudes.
