# Parked airliners acceptance

Production Incheon scene, 2026-10-28, Intel ADL-N Vulkan Chrome:

- 48 planned 737-800s: 33 terminal and 15 remote positions. Korean Air, Jeju Air,
  Jin Air and flydubai schemes. `terminal-parked.png` shows the actual placement;
  `737-*.png` captures each livery after final window-color preservation.
- All 48 share one exterior geometry. Four body and four decal instance batches,
  plus shared gear and stand markings: 10 scene meshes. No per-plane cockpit or
  physics object. The bundled exterior is loaded once for this fleet.
- High/Balanced/Performance limits of 48/32/16 verified. Static scenery is packed
  into existing instance buffers as the camera/quality changes.
- Frozen-view comparison: 71 → 81 draw calls and 594,652 → 768,076 submitted
  triangles with 48 parked aircraft. This is a render-counter comparison, not
  an FPS benchmark or GPU-memory measurement.
- Complete physical departure: all eight stages, 385.375 simulated seconds,
  airborne manual handoff, no crash and all three gear contacts normal while
  parked-aircraft collision remains active. See `full-results.json`.
- Final paint-only refinement was separately captured with `VISUAL_ONLY=1`;
  `visual-results.json` explicitly records `flight:null`. Geometry/placement/
  collision are unchanged from the complete flight run. Images were inspected.
- No application or shader errors. One external browser-extension exception was
  recorded separately in each pass by the shared project harness.

Syntax/action-pin checks, 794 regression tests and production build passed.
The strengthened parking tests also independently check aircraft bounding-box
corners against source aprons, buildings and runway safety strips; quality,
collision after visual culling and disposal during asynchronous loading pass.

Stand positions and liveries are authored scenery interpretations, not official
texture packs, registrations, published stands or a real-time airport schedule.
Source references and reproducible commands are in
`docs/development/incheon-parked-airliners.md`.
