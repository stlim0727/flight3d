# Cockpit and tower optical zoom acceptance

Baseline: `d04937d` (2026-10-23) for the shipped gestures, re-measured on
`fix/cockpit-zoom-lean` for the eye point and the gaze. Node 22.23.2; Linux
7.0.0-38-generic, Intel N95, 15,996,096,512 bytes RAM; headless Chrome
154.0.8037.57 with `--use-gl=angle --use-angle=vulkan`, reporting
`ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (ADL-N) (0x000046D2)), Intel open-source Mesa driver)`
— the host's hardware GPU, not SwiftShader.

Gestures are dispatched through Chrome DevTools Protocol, not set from the page:
`Input.dispatchMouseEvent` with `type: mouseWheel` at canvas point (640, 360) for
desktop, `Input.dispatchTouchEvent` start/move/end sequences for the two-finger
pinch, and `Input.dispatchMouseEvent` press/move/release for the manual aim. Each
row is read back from `window.simulator` after the frame loop has applied the field
of view, so the numbers are the rendered values. `eye` is the camera position
transformed into aircraft-local metres, `gaze` is the elevation of the rendered view
axis above the aircraft's laterally-level horizon.

## Why the cockpit eye point does not move

The first iteration of this feature leaned the pilot forward and up while magnifying
(`cockpitZoomLean` 0.45 m and `cockpitZoomLeanRise` 0.35 per unit of magnification, so
1.35 m forward and 0.47 m up at 4×). Measuring the flight deck against the captain's
eye (-0.390, 0.850, -12.350) shows there is nowhere for it to go:

| Interior surface | Clearance from the seated eye |
| --- | ---: |
| `GLTF_Glass_1L` windscreen, first surface ahead | 0.411 m (spans y 0.584…1.076) |
| `GLTF_Roof_Fairing` underside above the eye | 0.320 m (spans z -12.793…-12.247) |
| Glareshield batch top edge | 0.025 m *below* the eye |

So the lean drove the camera through the glass and the roof structure — which is what
it looked like on screen — without magnifying anything, because a dolly only enlarges
nearby geometry. Zoom is now purely optical, and the magnified cone *rotates* up off
the glareshield instead: `cockpitZoomGazeLift` 0.12 rad per unit of magnification above
1×, which moves the view axis from its resting -14.3° to +6.3° at 4×. The lift fades to
nothing as the pilot takes over the aim (`zoomGazeBlend()`, linear across the same
0.38 rad yaw / 0.42 rad pitch window that `isLookingAwayFromCenter()` uses), and it
never applies in the photo (2D) cockpit submode, whose panel is an overlay and whose
view axis already rests at -5.2°.

## The look-away boundary fades, it does not switch

Gating the lift on `isLookingAwayFromCenter()` was the first version of the rule, and a
review caught the consequence: at 4× a horizontal drag of one pixel — 0.0035 rad of yaw
with no vertical input at all — would have dropped the frame by the whole 20.6° lift as
soon as it crossed 0.38 rad, more than the 16.43° vertical field of view. Sweeping a
real CDP drag rightward in 4 px steps while held at 4× shows the rendered elevation
falling continuously instead:

| Yaw (rad) | 0 | 0.14 | 0.28 | 0.35 | 0.364 | 0.378 | 0.392 | 0.406 | 0.476 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Gaze elevation (deg) | +6.30 | -1.30 | -8.90 | -12.70 | -13.46 | -14.22 | -14.32 | -14.32 | -14.32 |

Largest single step in the sweep: **0.76°**. Crossing the boundary itself (0.378 →
0.392) moves the frame **0.11°**, and past the window the gaze simply sits where the
pilot put it: [just inside](cockpit-lift-fade-just-inside.png) and
[just outside](cockpit-lift-fade-just-outside.png) are the same frame.

## Desktop wheel, 1280×720, `runway` preset, aircraft held on the brakes

| Wheel state | Zoom | Cockpit FOV | Cockpit eye (local) | Cockpit gaze | Tower FOV | Tower eye (world) |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Open view | 1.00 | 60.00° | -0.390, 0.850, -12.350 | -14.32° | 54.00° | 120, 78, 280 |
| 5 notches up | 2.12 | 30.51° | -0.390, 0.850, -12.350 | -6.64° | — | — |
| 38 notches up (clamped) | 4.00 | 16.43° | -0.390, 0.850, -12.350 | +6.30° | 14.52° | 120, 78, 280 |
| 40 notches down from the clamp | 1.00 | 60.00° | -0.390, 0.850, -12.350 | -14.32° | 54.00° | 120, 78, 280 |
| 4× plus a 150 px drag up | 4.00 | 16.43° | -0.390, 0.850, -12.350 | +15.76° | — | — |

The eye is identical to four decimals at every magnification, so the zoom is not a
dolly. The last row shows the manual-aim rule: dragging past the centre window moves
the gaze to +15.8° and the automatic lift adds nothing on top of it (otherwise the
frame would sit at +36°, on the headliner).

Camera control text follows the gesture: `Camera: Cockpit` → `Camera: Cockpit · 2.1×`
→ `Camera: Cockpit · 4.0×` → `Camera: Cockpit`, and the collapsed strip label goes
`CAM` → `CAM2.1×` → `CAM4.0×` → `CAM`. While zoomed, `setMode(CHASE)` without a user
action returned `false`, so automatic camera cuts cannot steal the framing back.

| Images (3D cockpit, desktop wheel) | | | |
| --- | --- | --- | --- |
| [1×](cockpit-wheel-1x.png) | [2.1×](cockpit-wheel-2x.png) | [4×](cockpit-wheel-4x.png) | [back at 1×](cockpit-wheel-restored.png) |
| seated, resting aim | runway threshold enlarged, glareshield still in frame | glareshield out of frame, aim through the windscreen | seated and unzoomed again |

| Other fixed eye-point views | 1× | 4× |
| --- | --- | --- |
| Tower, aircraft on the runway | [tower-wheel-1x.png](tower-wheel-1x.png) | [tower-wheel-4x.png](tower-wheel-4x.png) |
| Photo (2D) cockpit submode | [cockpit-photo-wheel-1x.png](cockpit-photo-wheel-1x.png) | [cockpit-photo-wheel-4x.png](cockpit-photo-wheel-4x.png) |
| 4× after a manual aim up (lift suppressed) | [cockpit-wheel-4x-manualaim.png](cockpit-wheel-4x-manualaim.png) | — |

In the photo cockpit submode the panel is drawn by the overlay's own orthographic
camera, so only the outside scene magnifies; that composition was captured rather
than inferred.

Airborne check with the `cruise` preset: [1×](cockpit-cruise-wheel-1x.png) then 5
notches up to [2.1× / 30.51°](cockpit-cruise-wheel-2x.png) with the city and coastline
enlarged.

## Portrait pinch, 900×1600, `cruise` preset, touch emulation enabled

| State | Cockpit zoom | Cockpit FOV | Cockpit eye (local) | Cockpit gaze | Tower zoom | Tower FOV | Tower eye (world) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| Before spreading | 1.00 | 100.00° | -0.340, 0.881, -12.350 | -14.32° | 1.00 | 96.01° | 120, 78, 280 |
| Fingers 220 px → 620 px apart | 4.00 | 33.18° | -0.340, 0.881, -12.350 | +6.30° | 4.00 | 31.04° | 120, 78, 280 |
| Fingers 620 px → 220 px apart | 1.00 | 100.00° | -0.340, 0.879, -12.350 | -14.32° | — | — | — |

The portrait eye sits 5 cm outboard and 3 cm higher than the landscape one: that is
the pre-existing aspect-ratio adaptation, not the zoom. Portrait bases are the widened
fields of view the aspect logic already selects, so the same magnification composes on
top of them.

| Images (before → after → restored) | | |
| --- | --- | --- |
| Cockpit | [1×](cockpit-portrait-pinch-1x.png) | [4×](cockpit-portrait-pinch-4x.png) → [1×](cockpit-portrait-pinch-restored.png) |
| Tower | [1×](tower-portrait-pinch-1x.png) | [4×](tower-portrait-pinch-4x.png) |

## Limitations

- The simulation keeps running between the paired captures, so before/after frames
  are not pixel-aligned; they show the same scene and gesture, not a still diff.
- In portrait the cockpit frame is narrow enough horizontally (≈19° at 4×) that the
  magnified cone can land on the windscreen pillar. The zoom is doing what it should
  — the 3D cockpit's window posts are simply close — and aiming sideways with a drag
  moves off the post.
- The pinch gestures saturate the 4× clamp, so the browser run proves the clamp and
  the direction of both gestures; symmetric unwinding below the clamp is covered by
  `tests/cameraOpticalZoom.test.js` instead.
- One wheel notch per event, no trackpad inertia or high-frequency small deltas, and
  no physical touch screen; CDP synthesises both gesture classes.
- Chase and drone distance zoom were re-checked only by Node tests
  (`tests/cameraOpticalZoom.test.js`, `tests/cameraMouseLook.test.js`); no exterior
  framing was re-captured because the code path is untouched.
- No keyboard or gamepad zoom binding exists, and none was added.
- Single-run captures on a shared host; no frame-time measurement was taken, so this
  says nothing about the cost of the extra projection-matrix updates.
