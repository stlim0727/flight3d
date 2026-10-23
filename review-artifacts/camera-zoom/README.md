# Cockpit and tower optical zoom acceptance

Baseline: `d04937d` (2026-10-23). Node 22.23.2; Linux 7.0.0-38-generic,
Intel N95, 15,996,096,512 bytes RAM; headless Chrome 154.0.8037.57 with
`--use-gl=angle --use-angle=vulkan`, reporting
`ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (ADL-N) (0x000046D2)), Intel open-source Mesa driver)`
— the host's hardware GPU, not SwiftShader.

Gestures are dispatched through Chrome DevTools Protocol, not set from the page:
`Input.dispatchMouseEvent` with `type: mouseWheel` at canvas point (640, 360) for
desktop, and `Input.dispatchTouchEvent` start/move/end sequences for the
two-finger pinch. Each row is read back from `window.simulator` after the frame
loop has applied the field of view, so the numbers are the rendered values.

## Desktop wheel, 1280×720, `runway` preset, aircraft held on the brakes

| State | Cockpit zoom | Cockpit FOV | Tower zoom | Tower FOV |
| --- | ---: | ---: | ---: | ---: |
| Open view | 1.00 | 60.00° | 1.00 | 54.00° |
| 8 notches up | 3.32 | 19.73° | 3.32 | 17.45° |
| 38 notches up (saturated) | 4.00 | 16.43° | 4.00 | 14.52° |
| 40 notches down from saturation | 1.00 | 60.00° | 1.00 | 54.00° |

Camera control text follows the gesture: `Camera: Cockpit` → `Camera: Cockpit · 3.3×`
→ `Camera: Cockpit · 4.0×` → `Camera: Cockpit`, and the collapsed strip label goes
`CAM` → `CAM3.3×` → `CAM4.0×` → `CAM`. While zoomed, `setMode(CHASE)` without a user
action returned `false`, so automatic camera cuts cannot steal the framing back.

| Images (before → after → clamped) | | |
| --- | --- | --- |
| Cockpit | [1×](cockpit-wheel-1x.png) | [4×](cockpit-wheel-4x.png) |
| Tower, aircraft on the runway | [1×](tower-wheel-1x.png) | [4×](tower-wheel-4x.png) |
| Photo (2D) cockpit submode | [1×](cockpit-photo-wheel-1x.png) | [4×](cockpit-photo-wheel-4x.png) |

In the 3D cockpit the magnified eye point also leans forward and up
(`cockpitZoomLean` 0.45 m per unit of magnification, `cockpitZoomLeanRise` 0.35),
which is why the glareshield leaves the frame instead of filling it. In the photo
cockpit submode the panel is drawn by the overlay's own orthographic camera, so
only the outside scene magnifies; that composition was captured rather than inferred.

Airborne check with the `cruise` preset, 5 notches up: 2.12× / 30.51° with the city
and coastline enlarged — [cockpit-cruise-wheel-2x.png](cockpit-cruise-wheel-2x.png).

## Portrait pinch, 900×1600, `cruise` preset, touch emulation enabled

| State | Cockpit zoom | Cockpit FOV | Tower zoom | Tower FOV |
| --- | ---: | ---: | ---: | ---: |
| Before spreading | 1.00 | 100.00° | 1.00 | 90.66° |
| Fingers 220 px → 620 px apart | 4.00 | 33.18° | 4.00 | 28.38° |
| Fingers 620 px → 220 px apart | 1.00 | 100.00° | 1.00 | 90.66° |

| Images (before → after) | | |
| --- | --- | --- |
| Cockpit | [1×](cockpit-portrait-pinch-1x.png) | [4×](cockpit-portrait-pinch-4x.png) |
| Tower | [1×](tower-portrait-pinch-1x.png) | [4×](tower-portrait-pinch-4x.png) |

Portrait bases are the widened fields of view that the aspect-ratio logic already
selects, so the same magnification composes on top of them.

## Limitations

- The simulation keeps running between the paired captures, so before/after frames
  are not pixel-aligned; they show the same scene and gesture, not a still diff.
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
