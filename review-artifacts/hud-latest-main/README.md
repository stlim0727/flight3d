# Compact flight strip with an anchored AP dropdown

Baseline: main `f94296b394819460f9371e7c0871991713d6c9e5` (merged #153 and #154).

One horizontal strip contains camera, sound | gear, flaps decrement/increment,
spoilers and reverse. Short localized labels retain visible state; accessible
names and tooltips retain full descriptions. Sound is available on desktop and
touch layouts. The Aircraft drawer and separate Aircraft row are removed.

Telemetry and the control strip occupy 44px bands with a 4px vertical gap. Home
and AP sit 4px below the control strip, aligned with its ends, with 44px touch
targets. In the menu, Home moves to the upper corner to leave settings reachable.

The AP trigger keeps its position, label and master-state tint when expanded.
A right-aligned panel opens 4px below it. Its three-column layout exposes phase,
master, HDG, ALT, SPD, APP and live mode annunciation without moving the trigger.
It fits within the viewport and scrolls if height is limited. Clicking the trigger,
pressing Escape or tapping outside closes it. Escape closes AP without pausing
flight; outside input still reaches its intended control.

The relocated demo guide and reopen pill sit below the flight toolbar. The stall
alert sits below both the toolbar and AP dropdown; on very short screens it uses
the open warning area below the toolbar.

On short landscape touch screens, the AP dropdown narrows against the right safe
edge and scrolls within the space above the yoke. This leaves the brake and the
touch stick, rudder and throttle hit points clear while AP stays expanded.

## Verification

- `npm run check`: 156 JavaScript files and pinned workflow actions pass.
- `npm test`: 400 tests across 49 suites pass.
- `npm run build`: pass; existing large-chunk warning remains.
- `scripts/verify-responsive-ui.mjs`: all 11 viewport/input layouts pass bounds,
  non-overlap, telemetry fit, strip order and row count, direct hit targets,
  4px gaps, aligned Home/AP edges and stationary AP trigger when expanded.
- Each layout verifies panel alignment, viewport fit and all five mode-button
  hit targets; it now also checks every flight-toolbar button remains reachable
  with AP expanded. Native master and HDG input keep the panel open and update
  state. Native collapse and Escape dismissal pass, including no accidental pause.
- The desktop regression scenario checks that the minimized demo pill reopens
  its guide below the toolbar, then engages AP modes and checks the stall alert
  remains below the full dropdown and its live mode annunciation.
- The 568×320 landscape scenario hit-tests the brake, stick, rudder and throttle
  both before and after engaging AP, and scroll-tests the dropdown's mode buttons.
- Existing interaction, compact input, safe-area, telemetry swipe/keyboard and
  inspector tuning checks pass. A native camera tap closes AP from outside
  and the camera remains usable.

Start Vite on 5272 and isolated hardware-accelerated Chrome with
`--use-gl=angle --use-angle=vulkan`, CDP 9498 and a writable profile, then run:

```sh
CDP_URL=http://127.0.0.1:9498 SIM_URL=http://127.0.0.1:5272 \
  ARTIFACT_DIR=review-artifacts/hud-latest-main node scripts/verify-responsive-ui.mjs
```

`layout-results.json` records bounds, gaps, trigger/panel positions and mode hit
targets. Other JSON covers interactions and safe areas. Selected screenshots show
collapsed and expanded AP on phone portrait, landscape and desktop. Expanded
captures show master and HDG engaged. `ap-state-results.json` additionally
records that collapsing on portrait, landscape and desktop preserves master
engagement, green tint and exact trigger coordinates. Selected captures wait
2.8 seconds for transient mode notices to disappear, then restore AP off.
Evidence uses Chrome device emulation, not physical phone browser chrome or audio
listening.
