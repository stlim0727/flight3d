# Environment panel: time of day removed

The Environment panel held eight rows, two of which the main menu already offers:
language and time of day. Time of day is now menu-only for the starting value and
keyboard-only in flight, so the panel drops to seven rows and one duplicated
concept.

Removed: `#btn-time`, its Environment-panel row, the `ui.time` label refresh in
`updateControlState`, the click wiring in `main.js`, and the `time`,
`change.time.of.day` and `ui.time` catalog entries.

Still reachable:

| Action | Path |
| --- | --- |
| Starting time of day | 🏠 main menu → 시간대 select (7 options) |
| Change while flying | <kbd>[</kbd> / <kbd>]</kbd> (±1.5 h, toast confirms; listed in the flight guide and README) |
| Demo scenarios | `DemoFlightDirector.setTimeOfDay` during the scripted sequence |

## Verification

- `npm run check`: 150 files, zero failures.
- `npm test`: 352 passed, zero failures (includes the i18n key-parity and
  key-reference coverage tests that catch orphaned catalog keys).
- `npm run build`: passed.
- Live check (`environment-panel.png`, `time-trim-results.json`) against a Vite
  dev server in headless Chrome with Vulkan: `#btn-time` absent from the document,
  Environment panel opens with language, render quality, sound, touch controls,
  gyro, physics and flight guide, `[` moved 16.80 → 15.30 and `]` `]` moved it to
  18.30, main-menu selector intact with 7 options, zero uncaught page exceptions.
- `node scripts/verify-responsive-ui.mjs` is not a usable signal on current main:
  it fails at `portrait-small: settings obscured` before reaching the time paths.

Software-rendered viewport and emulated input only; no physical-device claims.
