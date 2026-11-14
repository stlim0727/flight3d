# Bandit infrared flare: bounded model

This S4-1 increment adds Bandit flares against player-fired IR missiles. A
Bandit releases one flare and one chaff cloud for each confirmed optical plume
warning, without knowing the missile seeker type. Both dispensers have separate
assumed eight-charge inventories and separate threat histories. A respawn resets
those inventories and histories; combat reset or deactivation removes active
flares. Flares persist independently of their source aircraft until expiry.
This is a simplified pilot response, not a modeled F-16 warning/dispenser system.

A flare inherits position and velocity, then moves under gravity and linear drag
through still air. The assumed drag time constant is 2 s. Relative omnidirectional
IR emission follows `6 * (1 - exp(-age / 0.15)) * exp(-age / 2)`, expires at
6 s, and uses the same inverse-square received-signal normalization as aircraft.
All values are model assumptions; no spectral radiance, ejection impulse, wind,
terrain deposition, individual pyrotechnics or real flare performance is claimed.
The [US Air Force environmental memorandum](https://www.holloman.af.mil/Portals/101/Environmental%20documents/Technical%20Memorandum%20Safety%202017-2b.pdf?ver=2017-07-25-151217-720)
describes flares as hot sources that mislead heat-sensitive seekers, but does not
validate any of these coefficients or the simulated result.

IR seekers compare the target and eligible flare signal using a Gaussian angular
weight with assumed 0.05 rad scale. Unlike the radar channel, IR competition does
not use range resolution; range still affects signal intensity and existing seeker
range/LOS gates. A stronger return must satisfy the existing acquisition delay;
finite memory and reacquisition are unchanged. Radar ignores flares, IR ignores
chaff, and the explicit signal callback overrides channel modeling and decoy
competition. There is no random success or guaranteed lock break. Spectral
filtering, background, real seeker discrimination and beam shape remain unmodeled.

`tests/flare.test.js` covers dispenser exhaustion, growth/decay, inverse-square
signal, invalid values, motion, geometry/terrain, IR diversion/reacquisition, radar
isolation, multiple warning IDs and reset. Existing focused sensor and combat
regressions also run. The existing maneuver-only comparison explicitly disables
countermeasures; the default comparison includes them. In the current 18-case
matrix, the three launched defensive cases expire and twelve cases never obtain a
launch lock; the three non-evasive launched cases hit. This tiny, assumed-parameter
sample is not a real-world success rate and should not be read as proof of immunity.

Player controls, HUD, flare/chaff effects, resupply, hostile missiles targeting the
player, replay/networking and complete game-scene/human-flown validation remain
open. This slice does not complete S4-1.

Verification on 2026-11-14: focused Node sensor/combat tests, `npm run check`
and `npm run build` passed. Hardware Chrome 156 / Intel ADL-N Vulkan passed
WebGL2 shader draw with pixel `[255, 0, 0, 255]`, GL error 0, the existing
terrain/IR seeker scenarios and missile mesh drawing. A bounded browser probe
confirmed flare diversion, radar isolation and IR reacquisition; it does not
render a flare or exercise a human-flown scene. Logs and probe are retained in
`.cache/flare/` in the task worktree.
