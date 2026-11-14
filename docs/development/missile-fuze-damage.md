# Missile fuze and damage: bounded model

This S3-4 increment separates proximity triggering from damage. Each missile
spec has independent assumed fuze, full-damage and fragment cutoff distances:
14 m, 5 m and 14 m respectively. They are game parameters, not measured AIM-9X
or AIM-120C performance. The existing linear `blastDamage` curve is 1 at or
inside 5 m, decreases linearly to zero at 14 m, and remains zero outside.
It is an arbitrary deterministic damage approximation, not inverse-square
blast physics, a measured warhead lethality radius, or a probability of kill.
Damage accumulates and the existing airframe-zone model drives flight degradation.

The idealized fuze fires at a simultaneous closest approach if the relative
minimum occurs in the current step and lies within the fuze radius. It does not
fire merely on entry while the separation is still decreasing. If a step starts
inside the radius with stationary or separating relative motion, it fires at the
start; an approaching contact waits for its minimum. Equal-time minima at the
end of a step are included. Among candidate targets the earliest trigger time
wins; ties use target list order. Geometry uses linear interpolation over the
step, independently of seeker acquisition. An untracked ballistic near pass can
therefore cause damage. The missile and every target use the same trigger time
for explosion position, separation and body-frame offset. Target orientation and
velocity use end-of-step state; the interpolation is not a continuous rotational
sweep. The missile terminates and emits one detonation; each live target is damaged
at most once by that explosion. Damage and kill events retain their existing roles.

No arming delay, safe separation, direct-impact geometry, fuze sensing delay,
terrain-intersection time ordering, player-target damage, faction/IFF protection,
fragment trajectories, shielded zones or multiple warhead types are modeled.
Ground impact keeps the existing surface explosion path. This is not a complete
S3-4 or battlefield damage implementation. The policy is an idealized algorithm,
not a claim about any actual fuze. Research provenance and known errors are in
[the realism review](missile-realism.md) and [research archive](missile-research/README.md).

`tests/missileFuze.test.js` covers entry versus CPA, stationary and separating
starts, endpoints, invalid inputs, distance falloff, earliest target, shared-time
multi-target damage and single detonation. Other focused missile, seeker, flight,
Bandit and countermeasure tests cover integration. The previous sensor-denial
case now records a survivable proximity burst rather than assuming all fuze-range
bursts kill. Full human-flown scene, player damage and realistic lethality remain
unverified.

Verification on 2026-11-14: focused Node tests, `npm run check` and `npm run
build` passed. Hardware Chrome 156 / Intel ADL-N Vulkan passed WebGL2 shader
pixel `[255, 0, 0, 255]` with GL error 0, existing terrain/IR seeker scenarios
and missile mesh drawing. A browser probe checked one explosion and simultaneous
multi-target positions and damage; it did not validate the complete game scene
or explosion effects. Logs and the probe are in the task worktree `.cache/fuze/`.
