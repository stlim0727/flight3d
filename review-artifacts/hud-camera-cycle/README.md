# Toolbar camera button cycles views instead of opening a panel

The Camera trigger opened a panel holding a mode dropdown plus Reset view and
Show/hide yokes. Cycling views is the action users actually want from the toolbar,
and `C` and the `1`–`8` digits already do it without a menu, so the trigger now
performs that cycle itself and the two remaining controls moved to Environment.

Removed: `#panel-camera`, `#camera-select`, and the `ui.camera` label (the button
keeps the `ui.camera.current` readout, so the active view is still visible).
Moved: `#btn-cam-reset`, `#btn-yokes` → Environment panel (now language, quality,
sound, touch controls, gyro, reset view, yokes, physics, guide).
Added: one-tap `cameraSystem.cycleMode()` through `controls.onCycleCamera`, the same
path the `C` key uses, so demo interruption and the camera toast behave identically.

## Verification

- `npm run check`: 150 files, zero failures.
- `npm test`: 352 passed, zero failures. `tests/controlPanelState.test.js` now
  asserts the toolbar button label instead of the deleted dropdown value.
- `npm run build`: passed.
- Focused live check (`camera-cycle-results.json`, `environment-camera-rows.png`,
  `phone-camera-button.png`) in headless Chrome with Vulkan: toolbar is
  `open-aircraft, open-camera, open-environment, btn-mute, btn-hud-menu`; no
  `#panel-camera` or `#camera-select` in the document; each tap advanced exactly one
  view and eight taps returned to the start with no panel opening at any point;
  Environment holds reset view and yokes, and both keep the panel open; `4` selected
  Tower and the button re-labelled itself; at 390 × 844 touch the button is
  91 × 44 px, hit-testable at its centre, and cycles with one tap; no uncaught
  page exceptions.
- `node scripts/verify-responsive-ui.mjs` on this branch: 11 viewport/input layouts
  passed and the interaction scenarios passed, including the rewritten camera steps.
  The run still stops later at `small stick responds on both axes`, a touch-stick
  drag assertion that does not involve cameras; note main fails this script earlier
  still (`portrait-small: settings obscured`).

Simulated viewport and emulated input only; no physical-device claims.
