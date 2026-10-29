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

## F-16 Lukla low pass

Select **Lukla → F-16 → Demo flight**. The demo waits for the DEM, starts
southwest of runway 24 at 280 KIAS with gear retracted, flies a straight valley
pass, then climbs before the opposing ridge and hands back powered controls.
The escape turn starts 1,600 m along the pass, with the heading command blended
from 238° to 195° over six seconds and bank limited to 45°. The climb targets
300 KIAS and at most 35 m/s vertical speed toward 4,600 m MSL. Fighter-specific
throttle feed-forward avoids the Cessna law's full-thrust acceleration into the
opposing ridge; pitch still comes from the inherited lift/AoA controller.

Control returns only after at least 30 seconds of escape, within 5° of the exit
heading, under 10° bank, climbing, and over 150 m clear of terrain. Completion
preserves velocity, attitude, rates and power instead of resetting them. Initial
spawn remains the only scripted pose. Chase, cockpit and flyby cuts respect a
manually selected camera; P restarts and Esc cancels.

[Guidance comparison](../../review-artifacts/f16-lukla-guidance/README.md) records
the original ridge collision, tuned sweep, per-tick checks and post-handoff flight.

With Vite on 5186, run `chrome-session --project flight3d node
scripts/verify-f16-lukla.mjs`. The harness checks completion, finite F-16 flight,
no sampled crashes/stalls, clearance and control release, and captures flight
frames and a close terrain view in `.cache/f16-lukla`.

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
