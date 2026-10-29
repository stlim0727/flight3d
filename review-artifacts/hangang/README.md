# Hangang browser evidence

Captured with `scripts/verify-hangang.mjs`, Windows Chrome headless, ANGLE D3D11,
Node 22.23.2. Desktop 1440×1000; mobile viewport 412×915. Serve Vite separately
on port 5197 (or set SIM_URL). See `docs/development/hangang.md` for assumptions.

- `approach.jpg`: trimmed C172 start and mission HUD.
- `finish.jpg`: completion after three openings and final recovery.
- `cockpit-entry.jpg`: first opening from the cockpit.
- `failure.jpg`: actual water impact following nose-down control input.
- `mobile.jpg`: retry, healthy aircraft and narrow-viewport layout.
- `region-menu.jpg`: independent Han River region, its only scenario and locked conditions.
- `results.json`: initial flight state, completion, clearances, lifecycle checks,
  failure contact, retry state and collected browser exceptions.

The test pilot uses ordinary controls; it is not an in-game assist. These images
show procedural preview scenery, not surveyed bridges or final #267 assets.
