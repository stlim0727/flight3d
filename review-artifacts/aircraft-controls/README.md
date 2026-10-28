# Aircraft touch response audit

Audit of B737-800 and C172 following the common touch-stick change in PR #269.
This branch is based on that PR, not on the old linear touch mapping. It adds
measurement and regression coverage; it does not retune aerodynamic coefficients.

## Conditions and method

| Aircraft | Configuration | IAS | Altitude | Mass |
| --- | --- | ---: | ---: | ---: |
| B738 | approach, flap 30°, gear down | 145 kt | 1000 m | 66000 kg |
| B738 | clean cruise, gear up | 250 kt | 3000 m | 66000 kg |
| C172 | approach, flap 30°, fixed gear | 65 kt | 1000 m | 1050 kg |
| C172 | clean cruise, fixed gear | 110 kt | 1000 m | 1050 kg |

These are representative test conditions, not aircraft operating limits.
The browser uses the current mass/CG model and solves hands-off level trim,
settles engine spool and flaps, disables autopilot and the demo, then freezes
wall-clock physics. Native CDP touch events control the actual mobile panels.
The live `integratePhysics` runs at 120 Hz, including aero, engines, fuel, gravity,
configuration and attitude integration; no substitute flight dynamics are used.

Each axis starts from a fresh fixture. A zero-input 1s control trial verifies the
trim, then another trial holds a 5px gesture for 1s, releases for 0.3s + 2s, holds
a reverse gesture for 1s and releases for 0.3s. All three surface inputs must be
neutral after release; commanded-axis rotation must have the expected sign on
hold and reverse. Every sample must be finite and the aircraft must not crash.
The test does not assume that neutral input levels the wings or stops rotation.

The stick's effective radius is 24px at 390×844: 5px becomes 5.78% pitch/roll
command. The separate rudder slider remains linear: 5px becomes 16.13% rudder
command. Rudder results are therefore not a comparison at equal normalized input.

## Results

Rotation rates at the end of the 1s positive hold (degrees/second):

| Aircraft / configuration | Pitch | Roll | Yaw |
| --- | ---: | ---: | ---: |
| B738 approach | 0.46 | 0.86 | 1.00 |
| B738 cruise | 0.83 | 1.42 | 1.79 |
| C172 approach | 2.33 | 2.86 | 4.29 |
| C172 cruise | 3.12 | 4.80 | 2.08 |

B738 has the slower small-command response at these conditions. C172 remains
more responsive; the touch curve does not make the aircraft behave alike. Both
support fine input, neutral release and reversal in the measured sequences.
The highest commanded-axis rate during a 1s pitch/roll hold is about 5.35°/s
(C172 cruise roll). For those pitch/roll trials, rates after the subsequent 2.3s release are below
0.21°/s in magnitude. These are observations, not certified handling limits.

C172 at 65 kt retains about 2.10°/s yaw after the release interval, with the
rudder input at zero. This is a coupled-airframe response rather than a stuck
rudder command; the measured sequence alone does not establish its realism or
long-term damping. No aircraft-specific yaw gain is inferred from this sample.

The pure-aero audit also checks B738/C172/F16 at approach and cruise for positive
and negative pitch/roll authority, opposing pitch/yaw/roll rate damping, and a
restoring yaw moment after a heading perturbation. No sign reversal was found.
F16 is only a static comparison here; its current model is not a validated FLCS,
and its trim solutions do not satisfy hands-off feasibility in these fixtures.

## Fidelity and verification limits

No measured handling defect in these bounded B738/C172 small-input sequences
justifies an arbitrary per-aircraft touch gain change. The common input slew
rates, speed stiffness schedule and ±20° pitch/roll travel still require
independent aircraft-specific calibration. Passing sign/sequence checks does
not establish real-aircraft fidelity, stall/spin behavior, full-deflection limits,
landing performance or comfort on a physical phone.

FAA's [Airplane Flying Handbook, chapter 3](https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/04_afh_ch3.pdf)
provides the qualitative control/airspeed/trim reference; it is not a source for
the numerical response rates above, which come entirely from this simulator.

Checks: syntax/action pin checks; complete Node suite (789 tests); production
build; all 12 browser axis/configuration sequences; no page exceptions. Four
browser screenshots were inspected. Local complete screenshots and raw telemetry
are in `.cache/aircraft-controls`; the committed results JSON preserves telemetry.
An additional repeat intended to log attitude stalled before startup readiness
and was stopped; it does not replace the earlier completed 12-sequence run.
The harness now fails startup errors immediately and bounds its startup wait.

## Reproduce

```sh
node --test tests/aircraftControlResponse.test.js
npm run dev -- --host 127.0.0.1 --port 5287 --strictPort
# In another shell:
chrome-session --project flight3d node scripts/verify-aircraft-controls.mjs
```

`APP_URL` and `ARTIFACT_DIR` override the URL and output directory. Reuse the
project Chrome session; the harness closes only its own tab.
