# Korean Air 737 ground service acceptance

2026-10-28 production browser captures:

- `korean-air-port.png`: classic blue-top scheme, titles and tail emblem.
- `tug-coupled.png`: low-profile tractor, 5.1 m rigid towbar, nose pin and belly clearance.
- `bridge-layout.png`: right-angle fixed access corridor and telescopic apron arm.
- `tug-disconnected.png`: released tractor drives clear with its towbar on the dolly.

Gate layout and livery are authored interpretations, not a surveyed stand or a
particular registered aircraft. The bridge's terminal end meets the mapped
terminal footprint. Tractor geometry is procedural; no replacement aircraft GLB
or third-party vehicle model is bundled.

Validation:

- Complete regression suite: 780 passed. After final paint/gear refinements,
  28 gear/PBR/control-surface/bridge tests passed; 7 tow/radio tests passed after
  correcting wheel rolling direction.
- Syntax/action-pin checks and production build passed.
- Gate browser checks passed: docking, retraction, mobile selection, tractor
  departure, wheel animation, pin release and cleanup. Screenshots were inspected.
- Complete 385.375 s simulated departure passed all eight stages and manual
  airborne handoff; no crash or gear damage. See `flight-summary.json`.
- `tug-clearance.json`: 2,838 body/cab box checks against actual loaded aircraft
  triangles. Boxes include 16 cm margin; zero surface intersections.
- `pavement-audit.json`: 134,861 grounded wheel contacts checked at physics
  timesteps; zero exits from source-mapped pavement.
- `audio-results.json`: all eight new Gemini clips decode/render without silence
  or clipping. Native click starts live playback; pause/resume, mute/unmute,
  speech-end gating and cancellation passed with zero application exceptions.

Browser harnesses foreground their own tab and record isolated-world and explicit
Chrome-extension-origin exceptions separately. MetaMask connection failures were
observed in the shared browser; application-context failures remain fatal.
These checks validate scripted ground handling, not a full rigid-body vehicle
collision system or airport-certified clearances.
