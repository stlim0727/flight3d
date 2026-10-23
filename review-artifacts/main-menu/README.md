# Main menu tab acceptance

The menu uses a 360px card with smaller type and two equally prominent 44px
Scenario / Settings tabs. Only the active panel is visible. The header, tabs,
Fly button and hint stay in place while the panel content scrolls. Settings use
44px controls in a two-column grid. Tabs support arrows, Home/End, and roving
keyboard focus; switching tabs preserves scenario and settings state.

## Captures

Current tab layout, Korean, captured with the menu frozen over the cinematic:

| File | Viewport | Panel |
| :--- | :--- | :--- |
| `1440x900-ko-scenario.png` | 1440x900 desktop | Scenario |
| `1440x900-ko-settings.png` | 1440x900 desktop | Settings |
| `390x844-ko-scenario.png` | 390x844 phone portrait | Scenario |
| `390x844-ko-settings.png` | 390x844 phone portrait | Settings |

## Verification

- `npm run check`: 161 JavaScript files and six pinned action references passed.
- `npm test`: 408 tests passed, zero failures.
- `npm run build`: passed (existing chunk size advisory).
- Menu tab review harness: 24 viewport / language / panel combinations passed
  (1440x900, 1024x768, 390x844, 320x568, 568x320, 844x390 in English and
  Korean), covering native tab clicks, ArrowLeft/ArrowRight/Home/End focus
  movement, a fixed Fly button position across tab switches, retained scenario
  selection, reachable settings controls, a live render-quality change, and
  Fly then return to the menu.
- `scripts/verify-responsive-ui.mjs`: 11 viewport/input layouts plus the
  interaction scenarios passed. It was updated for the tab layout to activate
  the Settings tab before hit-testing settings controls and to scroll
  `.lobby-panels`, which is the scroll container now that the card itself no
  longer scrolls.
  - Known unrelated failure: the script later aborts at
    `desktop: stall warning sits below expanded AP modes and remains reachable`
    (HUD stall-warning overlap, not the menu). This reproduces on the
    pre-change commit `6ba4591` with the unmodified script (`top` 328.42 versus
    328.45 on this branch), so it is pre-existing and left untouched here.
