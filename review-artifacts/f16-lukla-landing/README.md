# F-16 low pass, return and landing at Lukla

Tested 2026-10-29, Node 22.23.2, bundled loaded Lukla DEM, shared Flight3d
headless Chrome. Final code is based on main `fe0fc71`, preserving the latest
startup, build-age, demo-guide and fullscreen changes.

The existing `low-pass` profile now continues through RETURN, FINAL and ROLLOUT
to an actual runway stop instead of ending airborne. Its menu name is **F-16 ·
Lukla low pass and landing** / **F-16 · 루클라 로우패스와 착륙**. Canyon chase is
unchanged.

## Measured outcome

| Observation | Result |
| --- | --- |
| Flight completion | 357.92 s simulated flight |
| Main-wheel touchdown | approximately 130.58 KIAS, 6.7 m past Runway 06 threshold |
| Touchdown cross-track | -4.27 m |
| Main impacts, normal to runway | 2.601 / 2.580 m/s (model limit 3.8) |
| Nose impact, normal to runway | 2.527 m/s (model limit 2.8) |
| Gear damage / landing incidents / crashes | 0 / 0 / 0 |
| Stop along runway from midpoint | +221.87 m; 41.63 m runway remaining |
| Stop cross-track | +0.015 m |
| Ten-second parking hold | 0 m displacement, 0 m/s, all legs supported, brakes 1 |
| Minimum clearance before FINAL | 151.52 m (measured by scenario every physics tick) |

Ground-relative impact is the relevant landing measurement: the runway rises
11.76%, so the aircraft is climbing in world coordinates at wheel contact.
`parking.json` contains raw wheel impact and parking-hold observations;
`flight-summary.json` keeps first samples of each stage and the final result.
The first ROLLOUT sample is rounded to the harness's one-second sampling interval;
wheel impacts are collected from every gear update, not those snapshots.

## Guidance and physical scope

The existing low pass and ridge escape remain. The return lowers gear, selects
configured 20° flaps and uses speed brakes before a left valley turnaround. A
southeast offset approach avoids the high ridge on an extended runway centerline.
The lateral cosine curve joins the runway heading before the last 3.5 km. Final
commands 132 KIAS, a 900 m curved uphill flare, and an 18° pitch-command ceiling
to keep the aft engine support point clear. Controls still slew through the
normal pilot-input path; the ceiling never writes aircraft attitude.

Braking starts at 60% with half spoilers on the mains, then becomes full braking
and full spoilers with the nose supported. Completion requires recorded main
contact, all three healthy legs, zero accumulated damage, no incident, safe
runway position, and speed under 0.5 m/s for two uninterrupted seconds. It retains
parking brakes and releases the virtual pilot inputs.

No physics, aircraft parameters/loading, gear friction/damage limits, terrain,
engine ratings or collision probes were changed. There are no pose/velocity
corrections after the initial airborne spawn, no reverse-thrust command and no
crash exemptions for this route. This validates the existing game model, not
real-world F16 operation at Lukla.

## Verification

- Repository check, **885/885 Node tests**, and production build passed after
  rebasing onto current main. Focused tests cover escape-to-return transition,
  continuous final-path heading, parked handoff without pose changes, interrupted
  parking holds, damaged/off-runway rejection and phase-specific clearance rules.
- Three consecutive sweep flights completed without FAIL or KNOWN findings.
  Baseline collection compared to the previous **42-second airborne** route, so
  its advisory reports are expected. The new baseline uses the worst measured
  healthy peaks from those runs plus the earlier cold-page successful flight.
- Strict production sweep report is committed separately: **0 FAIL / 0 REPORT /
  0 KNOWN**. The new gate requires every landing stage, real touchdown, full
  rollout spoiler use and a parked handoff. Original pass clearance remains
  protected at 50 m and RETURN at 150 m; FINAL is still checked for airborne
  stalls, negative clearance, contacts, impact and damage.
- Existing F16 browser harness passed on current main: complete flight,
  three raw wheel impacts, healthy gear, runway stop, ten-second parking hold,
  restart/cancel and compiled shaders. `approach.png`, `rollout.png` and
  `parked.png` are its stage captures. Rollout uses CHASE because the generic
  belly gear camera is inside the F16 fuselage.

The sweep was run through a temporary adapter replacing private Chrome startup
and cleanup with the project's shared CDP browser, using the unchanged real
`stepSimulation` and classifiers. Extra diagnostics only collected gear events;
they did not modify physical state. Final strict acceptance served the built
`dist/` bundle through `vite preview`. No real-time FPS or audio-listening claims
are made from these stepped flights and still captures.

Reproduce the portable gate with Chrome installed:

```sh
npm ci
npm run check
npm test
npm run build
node scripts/demo-sweep.mjs --only f16-lukla-low-pass --strict
```

For stage captures and the ten-second parking hold, run Vite and:

```sh
APP_URL=http://127.0.0.1:5193/ chrome-session --project flight3d node scripts/verify-f16-lukla.mjs
```
