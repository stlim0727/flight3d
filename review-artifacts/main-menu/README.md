# Main menu tab acceptance

The menu uses a 360px card with smaller type and two equally prominent 44px
Scenario / Settings tabs. Only the active panel is visible. The header, tabs,
Fly button and hint stay in place while the panel content scrolls. Settings use
44px controls in a two-column grid. Tabs support arrows, Home/End, and roving
keyboard focus; switching tabs preserves scenario and settings state.

## Verification

- `npm run check`: 161 JavaScript files and six pinned action references passed.
- `npm test`: 408 tests passed, zero failures.
- `npm run build`: passed (existing chunk size advisory).

Browser acceptance and updated captures are pending: the shared Chrome session
is occupied by another workflow. The adjacent images show the previous
disclosure layout, not the current tabs.
