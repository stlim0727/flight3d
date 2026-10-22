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

`npm run check`, `npm test` (391 pass after merging main) and `npm run build`.

`scripts/verify-responsive-ui.mjs`, retargeted at the menu — per layout it opens
the menu, scrolls the card, and hit-tests every visible settings control at its
left, centre and right edge (24 points at most viewports), then re-checks the
in-flight toolbar against the HUD strip, throttle, stick, rudder, brake and
safe-area insets.

Before merging main it passed all 11 viewport/input layouts plus the interaction,
compact-input and safe-area scenarios. After merging #150–#152 the run stops at
the seventh layout on a failure this branch does not cause — see below. The
screenshots here are from the merged run: six portrait/landscape layouts and the
desktop pair, all showing the settings group inside the menu card and the
three-button toolbar in flight.

```sh
npm run dev -- --host 127.0.0.1 --port 5193
google-chrome --headless=new --no-sandbox --user-data-dir="$HOME/.cache/flight3d-settings-menu-verification" \
  --remote-debugging-port=9493 --use-gl=angle --use-angle=vulkan --disable-dev-shm-usage about:blank
CDP_URL=http://127.0.0.1:9493 SIM_URL=http://127.0.0.1:5193/ \
  ARTIFACT_DIR=review-artifacts/settings-in-menu node scripts/verify-responsive-ui.mjs
```

`scripts/verify-lobby-flow.js` passed end to end (`FORCE_GPU=1`, its own ports):
direct-HUD boot, menu toggle holding and resuming the same aircraft,
abandon-on-airport-switch, ESC pause, the demo scenario, and the mobile lobby
card with the settings group below the time-of-day select. Run it without
`FORCE_GPU=1` only with a generous budget — under swiftshader the Lukla backdrop
wait alone can take eight minutes.

## Pre-existing main failure this branch surfaced

`desktop: hud-strip overlaps ap-bar` at 1440 × 900: the centred `.hud-strip`
starts at x=360 (width 720) while `.ap-bar` reaches x=369, a 9 px × 22 px
overlap. It reproduces identically on `origin/main` (`01240bd`) with main's own
copy of the harness, so it came in with #151 (the autopilot collapse toggle
widening `.ap-bar`) and/or #152 (`.hud-strip` max-width relaxed to
`calc(100% - 24px)` and the secondary readouts unhidden). Neither element is
touched by this branch, and at 1440 px the compact toolbar rules this branch
edits do not even apply. It is not caught by CI because the browser harnesses
are not part of the default gate.

## Limitations

- Real-device FPS, audio output and gyroscope permissions are not measured here;
  the Vulkan-accelerated headless Chrome renders the same scene a desktop GPU
  would, at faster than real time.
- The keyboard-only paths (H, \` , O, J) were checked by the existing key tests,
  not by a browser run of every shortcut.
- Settings are reachable only while the menu is open, which freezes the held
  flight. In flight the toolbar keeps the one-tap mute, but that button is a
  touch-mode affordance: desktop still mutes with the M key.
- The post-merge harness run does not reach the interaction, compact-input and
  safe-area scenarios, so those are unverified on the merged tree (they passed
  pre-merge and none of #150–#152 changes the settings layout).
