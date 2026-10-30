# Aircraft demos

Select an aircraft, **Demo flight**, then a **Demo route** in the main menu.
The launch button changes to **Watch demo flight**. P restarts the selected
route; Esc releases the demo controls. A selected camera or mouse-look keeps
priority over automatic camera cuts.

- Boeing 737: existing airport cinematic demos, including takeoff and landing.
- Cessna 172, coastal: airborne city corridor pass followed by climb-out.
- Cessna 172, Lukla: airborne valley pass followed by a climbing turnaround.
- Cessna 172, either airport: extra-altitude left/right steep turns, a climbing
  wingover and wings-level recovery. No loop, roll or inverted flight is offered.

The Cessna scenarios use one initial airborne spawn. Subsequent movement uses
virtual elevator/aileron/rudder/throttle inputs through the normal 120 Hz physics
and collision pipeline. Mass, fuel, engine count and fixed gear remain C172
configuration. Completion retains power for manual flight; cancellation clears
virtual inputs. These tours do not include takeoff or landing.

Every aircraft/airport/route combination above is also a row in
`scripts/lib/demoSweepSpec.mjs`, which the demo sweep fast-plays and judges in CI
(see [ci.md](ci.md#autonomous-demo-acceptance)). The row owns its sampling ceiling,
its clearance and roll intent, the warnings its choreography is allowed to sound, and
any known issue it is carrying, so a new demo route is a table edit rather than
another single-purpose browser script.

City corridors are selected against the current generated building footprints,
including buildings tall enough to intersect the flight altitude. The proximity
montage's skyscraper scene resolves its spawn, heading and altitude from the
same corridor selection at scene entry, and its ledge camera sits on a real
flanking tower, so random building placement cannot put the flight path inside
a high-rise. Terrain is sampled across the entire corridor. Building placement is randomized, so the
chosen corridor and flight altitude can differ across page loads. Climb guidance
also scans terrain ahead. The canyon flight waits for loaded DEM data.

`CessnaDemoScenario` controls measured angle of attack to supply the required
lift in a bank. The coordinated-turn pitch-rate term keeps a sustained steep
turn from lowering the nose. It does not change aerodynamic forces, inertia or
collision policy. Camera cuts use the existing cockpit, chase, flyby and drone
views; resetting a view now retains the active aircraft's chase distance/height and
default cockpit look angle. The C172 eye is above the instrument panel at 0.72 m
so the forward scene remains visible.

## Browser verification

Start Vite on port 5186 (or set APP_URL) and reuse the project Chrome daemon:

```sh
npm run dev -- --host 127.0.0.1 --port 5186
chrome-headless --project flight3d start
chrome-session --project flight3d node scripts/verify-cessna-demos.mjs
```

The harness owns one tab, freezes wall-clock physics, and steps real physics for
all five airport/route combinations. It checks completion, aircraft identity,
finite positions, no sampled stalls/crashes, terrain clearance, multiple camera
views, demonstrated bank angles and powered handoff. It captures menu layouts at
1440×900 and 390×844 plus flight frames and writes samples to
`.cache/cessna-demos` (`ARTIFACT_DIR` overrides). Inspect screenshots in addition
to the assertions. ONLY=coastal-scenic (or the other airport/profile pair) runs
one route for diagnosis. This harness does not verify audio or a complete
manual-input flight after handoff.

## Incheon C172 circuit

Select **Incheon → Cessna 172 → Demo flight**. The Incheon close-up circuit
starts on 15R, flies the mapped concourse, T1 / transport centre and international
business district, then circles back to 15R for a physical landing and braked stop.
This route is C172-only; Incheon still has no Boeing demo. P restarts it and Esc
hands control back. The airport's lobby background remains stationary.

`IncheonCessnaScenario` resets the runway preset only once. Waypoint guidance,
rotation, descent, flare and rollout use normal virtual pilot inputs, with terrain
and building collision enabled. Close-pass altitudes are measured in world metres
against the current modeled scenery, not surveyed obstacle clearance. The scene
covers the currently mapped airport patch rather than all Yeongjong landmarks.
A landing completes only after wheel contact and a runway stop, retaining the
parking brake. Crashes and guidance timeouts do not count as completion.

```sh
npm run dev -- --host 127.0.0.1 --port 5189
APP_URL=http://127.0.0.1:5189/ ARTIFACT_DIR=.cache/incheon-demo \
  chrome-session --project flight3d node scripts/verify-incheon-demo.mjs
```

[Browser acceptance evidence](../../review-artifacts/incheon-cessna-demo/README.md)
records two complete 476.63-second circuits, intact gear and the runway stop,
plus mobile menu, restart, camera override and cancellation checks.

## F-16 Lukla low pass and landing

The additional **F-16 · Extreme canyon slalom** (`canyon-slalom`) is separate
from the low-pass-and-landing and canyon-chase profiles. Inspired by the supplied
Maverick reference, it alternates steep banks along the measured Dudh Kosi
corridor, follows terrain without scripted barrel rolls, then climbs out into
manual flight. Production-physics regression measures about 62 seconds,
23 m minimum clearance, 78° peak bank and 7.5 G peak load, without collision,
stall or gear damage. At least five seconds must be below 100 m AGL, and both
left and right banks must exceed 60°. Aircraft pose and velocity remain physical
after the initial spawn; the actual velocity corridor receives terrain lookahead.

The F16 canopy uses a weaker interior tint/reflection than the exterior and
no inverse-opacity specular amplification. The procedural aft exhaust plume
responds to engine N1 and actual thrust, fading at shutdown and hiding on crash.
Shader rendering still needs browser evidence; Node material/state tests alone
do not establish visual appearance.

Landing results reported in [PR #304](https://github.com/stlim0727/flight3d/pull/304)
are evidence within the game model, not validation of real F16 landing feasibility;
see [fidelity limits and validation work](f16-lukla-realism.md).

Select **Lukla → F-16 → Demo flight → F-16 · Lukla low pass and landing**
(the existing `low-pass` profile). After the 280-KIAS airborne pass, the fighter
climbs/turns clear of the opposing ridge as before, then stays under pilot control
through a decelerated valley turnaround, a curved approach to Runway 06, touchdown,
braking and a parked handoff. Esc cancels; P restarts. The canyon-chase choice is
unchanged and still hands back airborne.

The pass now starts over the upper runway at 45 m clearance, with a flyby shot
unless the pilot has selected a camera. It crosses the pavement at roughly
45–100 m clearance instead of starting beyond its downhill end. The escape
starts at 750 m along the pass, targets 260 KIAS and up to 35 m/s climb, and
blends heading 238° to 195° with a 45° bank-command limit. Return keeps the
gear retracted, selects the configured 20° landing flaps, uses speed brakes,
and turns at 8 km down-valley after slowing below 205 KIAS. It approaches from
the southeast side of the extended centerline to avoid the measured ridge that
blocks a long, straight descent. A cosine lateral path joins from the actual
final-entry position and finishes its turn 2.5 km before runway midpoint;
terrain lookahead protects the return and outer approach. Gear extends on
entry to final, with physical transit and approach deceleration left intact.

The Node physics regression (`tests/f16LuklaFlight.test.js`) uses the production
120 Hz integrator, controls, trim, gear, measured DEM and airport collisions.
Its baseline comparison completed in 357.9 s; the shortened route completes in
226.9 s, touches down at 130.3 KIAS and holds parking for ten seconds with zero
gear damage. Gear extension moves from 300 s before touchdown to about 75 s.
This establishes model behavior, not browser rendering or camera appearance.

Final targets 132 KIAS. The 900 m curved flare turns descent into a 9% uphill
flight path before meeting the 11.76% runway. Pitch command is capped at 18° to
keep the configured aft engine support point clear; actual attitude still follows
normal elevator dynamics. Landing lift guidance permits up to 20° commanded AoA
within this F16 model's 28° clean-stall setting. Main-wheel braking and partial
spoilers transition to full braking/spoilers once the nose gear supports the
aircraft. No reverse thrust, mass reduction, force/coefficient changes, or pose/
velocity corrections are used after the initial spawn.

Completion requires a recorded main-wheel runway touchdown, all three legs
supported with zero damage, no landing incident, position inside the runway's
safe envelope, and 3D speed under 0.5 m/s for two uninterrupted seconds. The
parking brake is retained; completion never resets position, attitude or velocity.
`result.minPassClearanceM` measures clearance before final, while
`result.minClearanceM` now naturally includes landing wheel height.

The sweep now requires the RETURN, FINAL and ROLLOUT stages plus a parked
handoff and actual spoiler deployment. Stage-specific clearance checks preserve
50 m for the original pass and 150 m on return; final may descend to wheel height
without exempting it from airborne stall, impact or damage checks.

With Vite running, use:

```sh
APP_URL=http://127.0.0.1:5193/ chrome-session --project flight3d node scripts/verify-f16-lukla.mjs
```

The harness checks completed landing, all wheel impact limits, intact gear,
runway stop, ten-second parking hold, restart/cancel and shader validity, and
captures stage views. [Landing evidence](../../review-artifacts/f16-lukla-landing/README.md)
records browser results. The [earlier escape-only comparison](../../review-artifacts/f16-lukla-guidance/README.md)
remains historical evidence for the preceding version of this route.

## F-16 canyon aerobatics

The **Dudh Kosi canyon chase** choice adds terrain-following ingress (100 m
commanded margin), turns with up to 78° commanded bank, a climbing 360° barrel
roll, an inverted shoulder crossing and an upright pull-up targeting 8G. The
roll corridor smoothly increases commanded clearance to 650 m to accommodate
vertical excursions. The target load is a pilot command; actual load depends on
speed, angle of attack and available elevator authority. Aircraft forces and
collision policy remain active throughout. Completion requires wings-level,
low-pitch recovery and preserves physical attitude and velocity for handoff.

Guidance advances along the spline from measured horizontal position, rather
than chasing a clock. Terrain queries use the loaded DEM with forward and
lateral samples. Those samples are guidance margins, not swept collision proof.
The original straight low-pass choice remains available.

`node scripts/verify-f16-canyon-physics.mjs` runs a bounded 120 Hz airborne
integration with the shipped DEM, real aerodynamic/engine models and virtual
stick attenuation/slew. It completes in 37.66 simulated seconds, with minimum
center-point clearance 101.68 m, maximum body-normal load 8.02G, and 3.63 seconds
inverted. This check omits fuel/CG evolution, contact solver and rendering.
Node sequence tests also cover stationary progress, recovery gating and unsafe
clearance cleanup.

For full browser acceptance, run the existing harness with
`PROFILE=canyon-chase APP_URL=http://127.0.0.1:5188/ chrome-session --project
flight3d node scripts/verify-f16-lukla.mjs`. It additionally requires measured
high G, sustained inverted flight and accumulated roll. The actual simulator
completed in 37.67 seconds, with 100.70 m minimum clearance, 8.00G maximum cabin
load and 3.63 seconds inverted, without sampled crashes/stalls or runtime errors.
Roll and breakout retain the chase camera to keep the airframe visible.
[Browser samples and screenshots](../../review-artifacts/f16-canyon/README.md).
