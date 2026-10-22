# Direct Aircraft controls and top-right AP button

Baseline: latest fetched main `f94296b394819460f9371e7c0871991713d6c9e5`
(includes merged #153 and #154). This is a fresh worktree based directly on main,
not the earlier PR #153 screenshot branch.

Aircraft's gear, flap decrement/increment, spoilers and reverser buttons now
render directly on the HUD. The Aircraft trigger, drawer and drawer state are
removed. The controls use three columns on narrow phones and five columns on
wider screens; all five remain visible with 44px minimum height.

Autopilot starts collapsed as a labeled AP button, docked at the right edge just
below the telemetry strip. The compact camera/mute row reserves space for it.
Native taps still expand the existing AP controls and collapse them back into
the top-right button.

## Verification

- `npm run check`: 156 JavaScript files and pinned workflow actions pass.
- `npm test`: 400 tests across 49 suites pass.
- `npm run build`: pass; existing large-chunk warning remains.
- Updated `scripts/verify-responsive-ui.mjs`: all 11 viewport/input layouts pass
  bounds, non-overlap, text-fit, five direct reachable Aircraft targets, top-right
  AP placement, native AP expand/collapse, and the existing settings/inspector checks.
- Existing interaction, compact touch-control, safe-area, telemetry swipe/keyboard
  and inspector tuning checks pass. Repeated flap changes now use native taps
  directly on the HUD; rotation retains all five controls without a drawer.

Reproduction: start Vite on 5272 and isolated hardware-accelerated Chrome with
`--use-gl=angle --use-angle=vulkan`, CDP on 9498, and a writable profile. Then:

```sh
CDP_URL=http://127.0.0.1:9498 SIM_URL=http://127.0.0.1:5272 \
  ARTIFACT_DIR=review-artifacts/hud-latest-main node scripts/verify-responsive-ui.mjs
```

`layout-results.json` records measured controls and direct-control/AP assertions;
other JSON files record interaction and safe-area results. Selected screenshots
show phone portrait, phone landscape and desktop. Evidence uses Chrome device
emulation, not physical phone browser chrome or audio listening.
