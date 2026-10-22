# Settings moved into the main menu

Branch `ui/settings-in-menu`. The in-flight toolbar's Settings (environment)
panel is gone: quality, sound, touch controls, gyro, camera centering, yoke
overlay, physics diagnostics and the flight guide now live in a `Settings`
group inside the main menu card (`#lobby-settings`), reached from the top-left
🏠 toggle. The toolbar keeps Aircraft, Camera and one-tap mute.

The menu already offered English/한국어 buttons, so the duplicate language
`<select>` was removed with it; `initLocalization()` no longer builds that
control.

## Checks performed

`npm run check`, `npm test` (390 pass), and the browser harness
`scripts/verify-responsive-ui.mjs`, retargeted at the menu:

```sh
npm run dev -- --host 127.0.0.1 --port 5193
google-chrome --headless=new --no-sandbox --user-data-dir="$HOME/.cache/flight3d-settings-menu-verification" \
  --remote-debugging-port=9493 --use-gl=angle --use-angle=vulkan --disable-dev-shm-usage about:blank
CDP_URL=http://127.0.0.1:9493 SIM_URL=http://127.0.0.1:5193/ \
  ARTIFACT_DIR=review-artifacts/settings-in-menu node scripts/verify-responsive-ui.mjs
```

All 11 viewport/input layouts passed. Per layout the harness opens the menu,
scrolls the card, and hit-tests every visible settings control at its left,
centre and right edge (24 points at most viewports) — none were covered by the
touch stick or the menu backdrop. It also re-verified the in-flight toolbar: no
overlap with the HUD strip, throttle, stick, rudder or brake, a reachable 44px
mute target, camera cycling from the toolbar, and safe-area insets.

`scripts/verify-lobby-flow.js` passed end to end (`FORCE_GPU=1`, its own
ports): direct-HUD boot, menu toggle holding and resuming the same aircraft,
abandon-on-airport-switch, ESC pause, the demo scenario, and the mobile lobby
card with the settings group below the time-of-day select. Run it without
`FORCE_GPU=1` only with a generous budget — under swiftshader the Lukla backdrop
wait alone can take eight minutes.

Screenshots: `<layout>.png` is the flight HUD, `<layout>-settings.png` the menu
with the settings group. `layout-results.json` holds the measured bounds and
hit targets, `interaction-results.json` the language/rotation scenarios.

## Limitations

- Real-device FPS, audio output and gyroscope permissions are not measured here;
  the Vulkan-accelerated headless Chrome renders the same scene a desktop GPU
  would, at faster than real time.
- The keyboard-only paths (H, \` , O, J) were checked by the existing key tests,
  not by a browser run of every shortcut.
- Settings are reachable only while the menu is open, which freezes the held
  flight. In flight the toolbar keeps the one-tap mute, but that button is a
  touch-mode affordance: desktop still mutes with the M key.
