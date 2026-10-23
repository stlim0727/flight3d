# Revised cockpit sunlight acceptance

Captured 2026-10-23 from the PR #171 revision that separates beam intensity from
admitted area. Node 22.23.2, balanced quality, 1280×720, Intel ADL-N through ANGLE
Vulkan. The ten-view harness and interactive six-direction demo both passed.
Representative PNGs are retained here; the JSON reports include every staged view.

## Model being verified

- A surviving sun ray keeps the outdoor sun intensity times the existing 3.2 gain.
  Projecting the aperture onto the cookie reduces its footprint once, not twice.
- Projected aperture area controls flood dimming separately. It is an artistic
  aggregate proxy, not diffuse transport or an exposure model.
- Back-facing panes create no cookie openings. Spill scales with admitted area;
  the astern cookie is completely black (maximum channel value 0), daylight is 0,
  and floods return to their base values even though the light object retains its
  nominal beam intensity.

## Measurements

`deck-sun-report.json` records the sun, cookie, flood levels and body-fixed receiver
masks. Masks sample y=0.35 m on a 48×120 grid over x=-1.2..1.2, z=-14..-7 m.
A comparison needs two nonempty masks and a changed/union ratio greater than 10%:

| Pair | Changed samples / union | Share |
| --- | ---: | ---: |
| Left / right sun | 278 / 311 | 89.4% |
| Left / right bank | 410 / 417 | 98.3% |
| Morning / golden hour | 1120 / 1301 | 86.1% |

The reference plane checks geometric beam movement. It is not a substitute for
rendered shadow acceptance. The rendered ablations independently show:

- Removing the deck sun changes 4.37% of frame pixels above the six-luma threshold;
  the outside-windshield region has maximum delta 0.
- Removing native window-frame casting changes 31,972 deck pixels above the
  three-channel threshold, with peak delta 102.33. Exterior and instrument-display
  deltas remain 0.
- Disabling AO changes 284,219 deck pixels; exterior and display deltas remain 0.
- Repeated static renders have zero measured noise in the sampled deck region.
- Frozen/forced shadow-map costs were 135.31/201.24 ms per frame. These are
  contended headless measurements, not gameplay frame-rate claims.

`demo/report.json` confirms scenario entry, all six bearings, stationary aircraft,
pause/next/previous/resume, portrait bounds and restored environment on exit.
`demo/sun-5.png` shows the high-sun step; `demo/portrait.png` records mobile layout.
The noon, golden-hour and side-sun screenshots were visually inspected.

## Reproduce

Start Vite from this revision on port 5296, and start a GPU Chrome daemon on 9222.
Run each command under `chrome-session`, or directly while holding its persistent
lease:

```sh
APP_URL=http://127.0.0.1:5296 CDP_PORT=9222 ARTIFACT_DIR=review-artifacts/cockpit-aperture/revised chrome-session node scripts/verify-cockpit-shadows.mjs
APP_URL=http://127.0.0.1:5296 CDP_PORT=9222 ARTIFACT_DIR=review-artifacts/cockpit-aperture/revised/demo chrome-session node scripts/verify-shadow-demo.mjs
```

The ten-view harness pins balanced rendering quality and closes its own tab in
success and failure paths. The only resource error was a missing favicon; neither
run reported a JavaScript exception.

## Remaining limits

The four-pane profile is authored and lacks the aft side windows. Diffuse sky
transport remains a fixed fill, the cookie includes deliberate soft spill, and
instrument floods still follow direct admitted light. This change corrects beam
attenuation and verification; it does not claim calibrated 737 illumination.
