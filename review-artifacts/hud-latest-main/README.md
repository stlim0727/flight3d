# One concise flight-control strip

Baseline: main `f94296b394819460f9371e7c0871991713d6c9e5` (merged #153 and #154).

One horizontal strip now contains camera, sound, gear, flaps decrement/increment,
spoilers and reverse, in that order. A divider separates camera/sound from the
mechanical controls. Short localized labels keep it compact; gear direction,
flap angle, pressed states and mute icon retain visible state. Full localized
state descriptions remain in accessible names and tooltips.

The strip stays on one row, with 44px targets and horizontal scrolling if the
viewport cannot fit them. Sound is directly available on desktop as well as
phones. The Aircraft drawer and separate Aircraft row are gone. The collapsed
AP button stays top-right below telemetry; expanded AP controls render above
the strip so they remain tappable on short screens.

## Verification

- `npm run check`: 156 JavaScript files and pinned workflow actions pass.
- `npm test`: 400 tests across 49 suites pass, including localization parity.
- `npm run build`: pass; existing large-chunk warning remains.
- `scripts/verify-responsive-ui.mjs`: all 11 viewport/input layouts pass bounds,
  non-overlap, telemetry fit, requested seven-button order, single control row,
  direct Aircraft hit targets, AP docking and native AP expand/collapse.
- Existing interaction, compact touch-control, safe-area, telemetry swipe/keyboard
  and inspector tuning checks pass. Repeated flap changes use native taps on the
  strip; rotation retains the controls without a drawer.

Start Vite on 5272 and isolated hardware-accelerated Chrome using
`--use-gl=angle --use-angle=vulkan`, CDP 9498 and a writable profile, then run:

```sh
CDP_URL=http://127.0.0.1:9498 SIM_URL=http://127.0.0.1:5272 \
  ARTIFACT_DIR=review-artifacts/hud-latest-main node scripts/verify-responsive-ui.mjs
```

`layout-results.json` contains measured bounds, strip order, row count and AP
assertions. Other JSON files cover interaction and safe-area results. Selected
screenshots show phone portrait, phone landscape and desktop. Evidence uses
Chrome device emulation, not physical phone browser chrome or audio listening.
