# View dragging — issue #84

UX review selected the issue's mouse/touch drag option: grab the scenery and move
it with the gesture. Mouse and touch reverse the old drag mapping in cockpit,
chase, wing and drone views. Gear view preserves its original horizontal mapping
and reverses only vertical movement because its look target uses a different yaw
convention. Pointer lock keeps directional mouse looking.
Passive cursor tracking and continuous edge panning default to off, so hovering,
holding a stationary finger at an edge, and releasing a drag do not rotate the view.
Shift looking is not added. English and Korean flight-guide text explains dragging,
release, reset and zoom.

## Verification (2026-10-21)

- Node 22.23.2: syntax/action-reference check, all 290 tests, production build passed.
- Isolated headless Chrome with ANGLE Vulkan, local Vite on port 5184, CDP on 9484.
- Native CDP mouse press/move/release from (600, 400) to (680, 450): reversed yaw
  and vertical adjustment asserted in all five manually adjustable modes. Subsequent
  unpressed movement retained the angles. See [numeric results](results.json).
- Native CDP touch at an emulated 900 × 600 viewport: drag from (450, 200) to
  (530, 250), release and touch cancellation passed. No runtime exceptions observed.
- Inspected rendered captures in all five modes and the mobile viewport. Representative
  captures: [cockpit before](cockpit-before.png), [cockpit after](cockpit-after.png),
  [mobile after](mobile-after.png). Aircraft simulation continued during captures;
  these show view interaction, not pixel-identical fixed-pose comparisons.
- Unit coverage exercises mouse UI exclusion, hover, edge hold, release, blur,
  preserved pointer-lock direction, touch/flight-stick independence, pinch and reset.

Browser evidence uses touch emulation, not a physical device. Pointer lock direction
is covered by unit event handling; native pointer-lock acquisition was not exercised.

## Review correction: gear-view direction

The first browser check above asserted angle signs, which missed that gear yaw
moves the look target directly along X. Its horizontal scene movement was wrong.
The corrected conversion preserves gear horizontal input while inverting vertical
input. Four new projection regressions failed before the fix and pass afterward,
covering mouse and touch in both right/down and left/up directions. The full
294-test suite, syntax/action-reference checks and production build passed.

Native Chrome CDP mouse and touch input now also verifies that a fixed point in
the gear scene moves with each gesture in screen space. Physics integration was
held still for this check. See [corrected numeric results](gear-review-results.json),
[gear before](gear-review-before.png) and [gear after](gear-review-after.png).
The original results.json is retained as the earlier angle-only check; the gear
projection results supersede its direction claim.
