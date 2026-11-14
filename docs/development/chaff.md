# Chaff: bounded Bandit and missile seeker model

This S4-1 slice models Bandit chaff against the existing player-fired active
radar missile. Bandits dispense one cloud per newly confirmed optical plume
warning, independent of the missile type; this is an assumed pilot response,
not knowledge of a missile's seeker or a claim about an F-16 warning system.
Each Bandit has eight assumed charges and respawn restores them. Clouds persist
independently of the aircraft and clear on combat reset/deactivation.

A cloud inherits the aircraft's release position and velocity. Its velocity
exponentially approaches still air with a 2 s time constant and 4 m/s downward
settling; no wind, ejection impulse, terrain deposition or individual fibers
are modeled. Its effective RCS grows with a 0.5 s time constant, decays with a
4 s time constant, peaks according to an assumed 8 m² scale, and expires at
12 s. These values and the dispenser capacity are illustrative, not measured
or calibrated hardware characteristics.

The radar seeker compares the existing target's signal to visible competing
chaff, weighted by Gaussian angular and range separation (0.05 rad and 300 m
scales). A stronger competing return starts the existing acquisition delay;
tracking during the delay uses finite memory. A tracked cloud can similarly
reacquire an aircraft. LOS, range, gimbal and signal threshold remain active.
IR seekers ignore chaff. This deliberately simple point-cloud approximation
omits Doppler discrimination, beam shape, spread, noise, jamming, aircraft radar
and actual seeker processing. No probability or guaranteed break is used. The
existing test callback replaces signal modeling and disables chaff competition.

The US Air Force [environmental assessment, appendix C](https://www.ellsworth.af.mil/Portals/146/documents/AFD-141124-073.pdf)
describes dispersal and radar reflection qualitatively; it does not validate
these game parameters, the selection heuristic, or effectiveness. See also the
[radar signal model](radar-signal.md).

`tests/chaff.test.js` covers inventory, cloud lifecycle, angular/range separation,
radar diversion and reacquisition, IR isolation, reset and Bandit release.
This is not full S4-1: player-controlled dispensing, keyboard/touch/HOTAS, HUD,
visual effects, player ground resupply, flares, replay/networking and a hostile
missile/player-target path remain unimplemented. There is no full game-scene or
human-flown acceptance evidence for this slice.
