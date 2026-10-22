# Remove the dead touch quick-pill bar

`FlightPanels.initFlightPanels()` removes `.touch-left-actions` and
`.touch-right-actions` from the touch overlay right after building the toolbar
panels, so the seven quick pills inside them (VOL, REV, GEAR, SP OIL, CAM,
FLAP −, FLAP +) never reached the screen while `TouchFlightControls` kept
building them, binding click handlers to them and refreshing their labels from
telemetry every frame. The same actions are already on the toolbar Aircraft and
Environment panels, which is where touch users reach them today.

Removed: the pill markup and its handlers, the `gearBtn` / `spoilersBtn` /
`reverserBtn` / `soundBtn` references, the `updateAudioUI()` delegate (its only
job was the VOL pill), the telemetry-driven label sync in `updateUI()` — which
left the throttle readout, so `updateUI()` no longer takes telemetry — the
`.touch-left-actions` / `.touch-right-actions` rules plus the unused
`.btn-touch-pill` amber/cyan/muted variants, and the seven i18n entries only the
pills referenced.

Kept: `#touch-btn-gyro`, which was relocated into the Environment panel and is
the one pill that actually rendered; it now sits directly in the right quadrant
before relocation, and `FlightPanels` no longer needs the two container
selectors.

`scripts/test-mobile-touch.js` step 6 clicked `#touch-btn-cam` behind a null
guard, so it had been a silent no-op; it now drives the toolbar camera button
and the Aircraft panel gear row. That exposed the next step's `cam.setMode(0)`
being refused after a genuine user camera selection (`setMode` ignores
non-user changes once a view is selected), so those scripted view changes pass
the user flag, matching the existing step 9 call.

## Verification

- `npm run check`: 150 files, zero failures.
- `npm test`: 358 passed, zero failures. `tests/touchControlState.test.js` lost
  its two pill-state cases and keeps the gyro stick-sizing case.
- `npm run build`: passed.
- `npm run test:mobile` on this branch: full pass, including the rewritten
  step 6 (camera 1 → 2 from the toolbar button, gear toggle from the Aircraft
  row) and every later drag-look, chase-orbit and override-protection step.
  Baseline note: the same script passes on `82aba04` only because its step 6
  clicked a pill that no longer exists.
- Focused live check (`touch-pills-results.json`, `desktop-panels.png`,
  `environment-gyro.png`, `phone-touch.png`, `mobile-landscape.png`) in headless
  Chrome with Vulkan: no pill ids and no legacy action surfaces in the document;
  toolbar and Aircraft/Environment rows unchanged; gear, flaps, spoilers and
  reverse all actuate from the Aircraft panel; camera cycles from the button and
  `C`; the sound row and `M` toggle mute with the quick-mute glyph following; the
  relocated gyro pill still flips `gyroActive` and its `active` class; at
  390 × 844 the overlay keeps stick, throttle, rudder and brake with only the
  gyro pill elsewhere, the toolbar fits, and the throttle readout tracks
  `controls.throttle` at 80%; no uncaught page exceptions.

Simulated viewports and emulated input only; no physical-device claims. No
`deviceorientation` samples were delivered, so gyro steering angles are covered
by the Node test, not by the browser run.
