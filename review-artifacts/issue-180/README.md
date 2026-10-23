# Issue #180: mouse look rate, tail-view vertical direction, tower zoom

Verified 2026-10-23 on Linux, Node 22.23.2, headless Chrome with Vulkan ANGLE
(`--use-angle=vulkan`), loaded B737 GLB, coastal airport, 1440x900 viewport.

The reported behaviour, in the reporter's words: the gaze moved further than the
mouse did (cockpit and friends), the tail view answered vertical mouse movement
backwards while horizontal was right, and the tower capped below the wanted 8x.

## Results

- **Tail view direction.** A 120 px downward drag now lifts the chase gaze by
  0.279 in the rendered view direction, the same sign the cockpit produces
  (0.130). Before the change the chase gaze moved the other way by 0.534 on the
  identical gesture, so the two views disagreed. The chase orbit is a camera
  height rather than a head rotation, which is why the pitch sign had to mirror
  the head views instead of matching them literally. Horizontal chase behaviour
  is untouched, as the report said it was already correct.
  `chase-0-neutral.png` and `chase-1-down-drag.png` show the same 120 px drag:
  the camera drops under the airframe and the horizon falls in frame.
- **Look rate.** Cockpit, wing and gear head rotation now cost 0.0011 rad per
  pixel instead of 0.0035. In the browser, 120 px of drag sweeps 7.56° of
  azimuth, about 476 px per 30°; the previous gain swept 24.1° in the same 120 px
  (150 px per 30°) and saturated the ±81° look limit after roughly 400 px of
  travel. The new rate is the window's own pixels-per-radian at 1080p with the
  60° cockpit base field of view, so a grab moves the scenery at about the
  pointer rather than several times faster.
- **Tower magnification.** The wheel climbs to 8.0x in the tower, 14 notches from
  1x, narrowing the 54° base field of view to 7.29° with the eye point fixed in
  the cab (`tower-1x.png`, `tower-8x.png`). The cockpit keeps its 4x ceiling
  (`cockpit-4x.png`), and switching views still drops magnification to 1x, so an
  8x tower framing cannot be carried into the cockpit.
- `npm run check`, `npm test` (443 tests), `npm run build`: passed.
- Node tests pin the rendered gaze direction for both input paths in cockpit and
  chase, the per-view zoom ceilings, and that a window-width drag no longer
  saturates the look limit.

[Measured values](camera-look.json) come from `npm run test:camera-look`, which
starts its own Vite server on a free port, drives real DOM mouse events over the
canvas through CDP, and reads back the camera. Direct state writes would have
skipped the listener layer where the drag/pointer-lock inversion lived.

## Limits of this evidence

- Pointer-lock direction is asserted in Node only. The browser run drives the
  drag path through synthesized mouse events; both paths funnel into
  `applyMouseDelta`, which is where the sign lives.
- The 476 px per 30° figure is one 1440x900 viewport. The gain is a fixed
  radians-per-pixel constant, so smaller windows still turn a little faster than
  the pointer and larger ones a little slower; making it track the viewport is
  not part of this change.
- Touch drag shares the same code path and inherits both fixes, but was not
  re-captured on an emulated device here.
- Look feel is subjective; the numbers above describe the gesture, not a
  certified sensitivity standard.
