# Remove the never-rendered camera and sound action buttons

`FlightPanels.initFlightPanels()` relocates the controls it needs into the toolbar
panels and then removes the legacy `.presets-bar` / `.action-panel` surfaces
(`src/ui/FlightPanels.js:110`). `#btn-cam` and `#btn-sound-action` were never in
a relocation list, so they were deleted from the DOM on boot while `src/main.js`
kept binding click handlers and an `updateAudioUI()` label refresh to them.

Removed: the two dead buttons from `index.html`, their three listeners in
`src/main.js`, and the now-unreferenced `camera.c`, `sound.m` and `volume.m`
catalog entries in English and Korean.

Camera cycling and sound toggling were already reachable through `#open-camera`,
the `C` / `M` keys and the Environment panel's sound row, so no user-facing
control changes.

## Verification

- `npm run check`: 150 files, zero failures.
- `npm test`: 358 passed, zero failures (including i18n key parity after the
  catalog deletions).
- `npm run build`: passed.
- Focused live check (`dead-controls-results.json`, `environment-rows.png`,
  `flight-toolbar.png`, `environment-korean.png`, `phone-touch.png`) in headless
  Chrome with Vulkan: no `#btn-cam`, `#btn-sound-action`, `.action-panel` or
  `.presets-bar` in the document; toolbar still
  `open-aircraft, open-camera, open-environment, btn-mute, btn-hud-menu`;
  Environment still lists language, quality, sound, touch, gyro, reset view,
  yokes, physics and guide; the toolbar camera button and `C` each advanced one
  view; the sound row toggled mute and relabelled itself with `#btn-mute`
  following; `M` restored the previous state; touch mode at 390 × 844 keeps the
  stick, throttle, rudder and brake with the camera button 79 × 44 px, reachable
  and inside the toolbar; switching to Korean re-rendered the surviving labels;
  no uncaught page exceptions.

## Finding, not fixed here

The touch overlay's own quick pills (`#touch-btn-sound`, `-reverser`, `-gear`,
`-spoilers`, `-cam`, `-flaps-dec`, `-flaps-inc`) sit inside the same removed
`.touch-left-actions` / `.touch-right-actions` containers, so they are also
deleted at boot and their handlers in `TouchFlightControls.bindEvents()` are
inert; only `#touch-btn-gyro` was relocated and survives. The same toolbar
panels now provide those actions on touch, so this is dead code rather than a
missing control, but removing it is a larger change than this cleanup and is
left for a follow-up.

Simulated viewport and emulated input only; no physical-device claims.
