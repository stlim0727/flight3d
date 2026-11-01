# Nodeulseom pavilion review (#381)

Captured from the PR branch dev server in headless Chrome at 1440 × 900, using
ANGLE d3d11 on Windows. The C172 flies the Hangang course with the same
test-pilot control loop as `scripts/verify-hangang.mjs`: ordinary control
inputs at 19 m, physics stepped at 0.05 s, with no teleport or force override.
After the last capture the run continued and completed all three bridges with
no contact.

| File | View |
|---|---|
| `01-chase-approach.jpg` | Chase camera, 220 m before the island |
| `02-cockpit-approach.jpg` | Cockpit camera, same moment |
| `03-chase-over-pavilion.jpg` | Chase camera, crossing the pavilion roof at about 19 m |
| `04-pavilion-detail.jpg` | Fixed camera beside the island (camera update disabled), same frame as 03 |

Capture notes: headless Chrome reports no focus, so the simulator treats the
page as backgrounded. The capture enabled CDP focus emulation and a timer
fallback for `requestAnimationFrame`. The simulator code was not changed.
