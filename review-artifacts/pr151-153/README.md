# HUD and settings review regressions (#151–#153)

The flattened telemetry row now retains each readout's intrinsic text width and
scrolls horizontally instead of compressing ten cells into the viewport. Labels
stay on one line so the desktop strip clears the autopilot bar at both 1025px
and 1440px. The focused strip supports Left/Right, Home and End without passing
those key presses through to flight controls. Instrument labels, values and
existing font sizes are preserved.

The Physics inspector is a body-level panel above the menu overlay (z-index 90
versus 85). Opening, scrolling, tuning and closing it leave the menu open and
preserve the held-flight flow.

## Verification

Node 22.23.2: `npm run check`, `npm test` (391 passing), `npm run build`.
The build retains the existing large-chunk warning.

Start an isolated Vite server and hardware-accelerated Chrome, then run:

```sh
npm run dev -- --host 127.0.0.1 --port 5271 --strictPort
# In another terminal, with an isolated writable profile:
google-chrome --headless=new --no-sandbox --use-gl=angle --use-angle=vulkan \
  --remote-debugging-port=9496 --user-data-dir="$PWD/.cache/review-chrome" about:blank
# In another terminal:
CDP_URL=http://127.0.0.1:9496 SIM_URL=http://127.0.0.1:5271 \
  ARTIFACT_DIR=review-artifacts/pr151-153 node scripts/verify-responsive-ui.mjs
```

`layout-results.json` covers all 11 viewport/input layouts, from 320×400 to
1440×900, with no primary-control overlaps or telemetry text extending outside
its cell. Each layout uses native input to open and close Physics above the menu.
The existing interaction, compact-control and simulated safe-area checks also pass.

`review-regressions.json` records native telemetry swipes in both phone
orientations, unchanged camera orientation during those swipes, keyboard access
to the final camera readout, and native tuning-slider changes from 1.0 to 1.4
at 320, 568, 1025 and 1440px. Tuning is restored after each check. The inspector
can be scrolled back to its header and closed while the menu remains open.

Selected screenshots show the readable phone row, the desktop clearance, and the
inspector's tuning section above the menu. Other JSON files retain the existing
interaction and safe-area measurements. Browser acceptance uses Chrome device
emulation; physical-device browser chrome and audio listening are not covered.

Initial attempts using temporary Chrome profiles were interrupted by a storage
quota/cache failure. Those attempts are not acceptance evidence; the final run
uses a writable profile outside the temporary filesystem.
