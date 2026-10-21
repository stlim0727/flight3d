# Issue #92 responsive controls acceptance

The shared Aircraft / Flight settings / Camera / Environment panels replace the
compact menu containing duplicate desktop and touch actions. The desktop aircraft
bar stays visible; compact screens use the Aircraft button. Panel titles and close
buttons remain outside the scrolling content. Repeated adjustments retain the
panel; airport/scenario selection closes Flight settings. Core telemetry stays
visible, with a separate Instruments disclosure for details. In touch-control
mode the primary toolbar keeps Camera directly accessible and adds a 44px
one-tap mute/unmute button. Sound now has only normal-volume and muted states. Mobile auto-boost,
the 150%/200% modes, and the extra output amplification have been removed.
The toolbar speaker, Settings sound button, and M key all toggle sound.

On small phones the throttle, brake/rudder, and stick share one shallow row.
The 320px portrait control band shrank from 266px to 135px. Throttle presets
and the extra stick telemetry header are hidden on these screens; camera and
mute remain directly accessible, with 44px minimum button/slider targets.

## Verification

- `npm run check`: passed.
- `npm test`: 290 passed, zero failures.
- `npm run build`: passed (Vite reports its large-bundle advisory).
- `node scripts/verify-responsive-ui.mjs`: checks bounds and pairwise overlap of
  telemetry, toolbar, throttle, stick, rudder, and brake; tests repeated volume
  adjustments and accessible close buttons in eleven viewport/input combinations.
  Visible settings controls are hit-tested at their center and both sides. On
  wide screens, native touch and mouse clicks must open Flight guide above the yoke.
- Live interaction assertions cover repeated flaps, direct camera selection,
  keyboard camera changes, preset dismissal, native CDP touch scrolling without
  camera rotation, touch-mode changes, Korean localization, and rotation with an
  open Aircraft panel. Additional assertions verify the secondary Instruments
  panel stays clear of the toolbar on compact and wide screens. Native input
  also verifies direct toolbar camera access, one-tap mute/unmute, synchronized
  Settings state, and normal-volume restoration. Small-screen control bands
  must remain within the bottom 150px. Native drags/holds verify the compact
  throttle, both stick axes, rudder auto-centering, and brake release in portrait
  and landscape; `compact-input-results.json` records the results.

| Capture prefix | Viewport | Input |
| --- | --- | --- |
| portrait-small | 320 × 568 | Touch |
| portrait | 390 × 844 | Touch |
| portrait-short | 320 × 480 | Touch; reduced available height |
| portrait-tiny | 320 × 400 | Touch; very short viewport |
| landscape-small | 568 × 320 | Touch |
| landscape | 844 × 390 | Touch |
| desktop | 1440 × 900 | Mouse / keyboard |
| desktop-narrow | 800 × 700 | Mouse / keyboard |
| desktop-small | 1025 × 700 | Mouse / keyboard |
| tablet-touch | 1280 × 800 | Touch |
| desktop-touch-enabled | 1440 × 900 | Mouse / keyboard; on-screen controls enabled |

Each prefix has a `.png` capture and a `-settings.png` capture with Environment
open. `portrait-small-muted.png` shows the accessible camera and mute controls
on a 320px screen. `portrait-instruments.png` shows the secondary instrument panel.
`portrait-aircraft-ko.png` shows Korean Aircraft controls after rotation.
Machine-readable bounds and interactions are in `layout-results.json` and
`interaction-results.json`. `safe-area-portrait.png` and
`safe-area-results.json` verify reserved left/right/top/bottom space of
18/18/24/32px after rotation. Button geometry changes immediately when these
insets change, without the old positional transition.

Browser evidence uses isolated Linux headless Chrome with Vulkan, a live Vite
server and real WebGL rendering. Device input/viewport emulation and simulated
reserved insets do not establish physical iOS Safari/Android browser behavior,
actual notches, address-bar animation, or hardware gyro permission handling.

## Review regression

The expanded-HUD finding is addressed by the separate Instruments panel (commits
`9f0a954` and `78e735c`), with compact toolbar separation and long-readout checks.

Before the stacking fix, the browser hit tests failed at 1280 × 800: Touch
controls, Gyro, Physics, and Flight guide hit the touch stick instead of their
settings buttons. Raising `#hud-overlay` whenever `touch-mode` is active keeps
panels above the yoke for both coarse-pointer tablets and desktop users who
enable on-screen controls. Updated screenshots and per-control hit results are
included alongside these notes.

## Reproduce

Use separate terminals from the repository root:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5192
```

```sh
google-chrome --headless=new --no-sandbox \
  --user-data-dir="$HOME/.cache/flight3d-responsive-verification" \
  --remote-debugging-port=9492 --use-gl=angle --use-angle=vulkan \
  --disable-dev-shm-usage about:blank
```

```sh
node scripts/verify-responsive-ui.mjs
```

`CDP_URL`, `SIM_URL`, and `ARTIFACT_DIR` override the defaults. The script uses an
existing page in the supplied isolated Chrome instance. It does not launch or
stop other browsers.
