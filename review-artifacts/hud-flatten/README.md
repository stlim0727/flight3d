# Flatten the HUD instrument readouts into the main strip

Removes the `#open-instruments` trigger (`.hud-details`) and the
`#panel-instruments` drawer. `initFlightPanels()` no longer relocates the last
six `.hud-item` readouts out of `.hud-strip`, and the CSS that hid them there
(`.hud-strip .hud-item:nth-child(n+5)`, plus the landscape-phone hide of items
5/7/8/9/10) is gone. The instrument components themselves — markup, labels,
values, typography — are untouched, as required.

Space that only existed for the trigger was released: the strip's
`max-width: calc(100% - 140px)` reservation became `calc(100% - 24px)`, and
`.compact-ui .hud-strip` no longer reserves `+80px` on the right.
`.hud-strip #hud-cam { pointer-events: auto }` keeps the camera readout
clickable for the photo-cockpit toggle, which previously worked because the cell
lived inside the pointer-enabled drawer.

## Gate

`npm run check` passes (156 files). `npm test` passes (390 tests, 45 suites).
`npm run build` succeeds with the pre-existing chunk-size warning only.

## Browser evidence

Vite on `127.0.0.1:5192`, headless Chrome 154 with CDP on `:9492`
(`--use-gl=angle --use-angle=vulkan`), then
`ARTIFACT_DIR=review-artifacts/hud-flatten node scripts/verify-responsive-ui.mjs`.

The harness does not pass. It aborts in the layout sweep at `desktop-small`
(1025x700) with `hud-strip overlaps ap-bar`, so the later interaction,
compact-input and safe-area blocks never run. Nothing below is claimed for those.

`strip-measurements.json` records per-viewport strip geometry and the width of
each cell against the width its own text needs (`over` is the excess in px).

| Viewport | Strip height | Result |
| --- | --- | --- |
| 1440x900 | 72px | Readable, but `VERT SPEED`, `ENG 1 N1`, `G-FORCE` and `COCKPIT (CAPTAIN)` wrap to two lines |
| 1025x700 | 72px | Same wrapping; the taller strip now reaches y=86 while `.ap-bar` starts at y=64 and the two boxes overlap |
| 800x700 | 44px | Compact row fits except `CAMERA` text (115px) in a 70px cell |
| 568x320 | 48px | `CAMERA` overflows its 47px cell by 69px |
| 390x844 | 48px | Cells are 29px wide; `CAMERA` overflows by 86px, `G-FORCE` by 14px, three labels wrap |
| 320x568 | 48px | Unreadable — see `portrait-small.png`; labels and values run into each other |

Screenshots: `desktop.png` (acceptable), `desktop-small.png` (AP bar sits on the
strip), `portrait-small.png` (phone row collides), `landscape-small.png`.

## Why it breaks

The drawer existed because ten readouts do not fit one row. With the components
pinned, the row is still `flex-wrap: nowrap`, so squeezing shows up as label
wrapping (which grows the strip into the AP bar) and value overflow (which bleeds
across neighbouring cells on phones). The worst single cell is `#hud-cam`, whose
`CameraSystem.getViewName()` strings such as `AUTO · CINEMATIC FLYBY` are 20+
characters.

## Options not taken

Any of these resolves the overflow but changes an instrument component, which is
out of scope for this branch: shortening the camera strings in the strip, adding
`white-space: nowrap` to `.hud-label`, dropping values to units-only, wrapping
the strip to two rows on narrow widths, or letting the strip scroll
horizontally.
