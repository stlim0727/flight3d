# Issue #9 cockpit acceptance

Baseline: `caab0a7` (2026-10-23). Node 22.23.2; Windows 11 x64,
Intel Core Ultra 7 256V, 16,687,775,744 bytes RAM; headless Chrome 155.0.0.0,
ANGLE Vulkan **SwiftShader software rendering**, 1440×1000, device scale 1.
The renderer is not the host's hardware GPU.

Run [the verifier](../../scripts/verify-cockpit-assets.mjs) as described in
[cockpit assets](../../docs/development/cockpit-assets.md).
[results.json](results.json) contains the unrounded measurements and GLB hashes.

| Isolated captain view | Before | After | Lite fallback after |
| --- | ---: | ---: | ---: |
| Draw calls | 88 | 90 | 87 |
| Uploaded geometries in view | 84 | 86 | 83 |
| Renderer texture count | 7 | 7 | 7 |
| Six live canvases, estimated RGBA8 + mipmaps | 6.33 MiB | 6.33 MiB | 6.33 MiB |
| Render + canvas update + GPU finish p50 | 2.10 ms | 2.70 ms | 2.50 ms |
| Same work, p95 | 4.10 ms | 4.90 ms | 13.40 ms |
| GLB response body bytes | 3,827,468 | 3,827,468 | 2,617,736 |

Timing uses 30 synchronous samples after five warmup iterations, with unchanged
camera/lighting/input, including Canvas drawing and `gl.finish()`. These are
single-run software-renderer measurements on a shared host, not paced animation
frames or a full-simulator/hardware FPS result. The observed timing regression
is recorded rather than interpreted as a 60 fps guarantee. The scoped resource
budget is unchanged GLB/texture payload and at most two additional draws at the
default captain view; the measured result meets that budget. Texture bytes are
an estimate for the six application canvases, not driver memory or a measurement
of the seventh renderer allocation. HTTP headers/compression and JavaScript
bundle bytes are excluded from the GLB response body figure.

The isolated scene uses fixed daylight direction (-3,5,-14) and equal flood/sky
fill in the compared views. Captain eye (-0.39,0.85,-12.35), 58° vertical FOV,
0.08 m near plane and -0.25 rad resting pitch match `CameraSystem`. Instrument
and pedestal closeups use the same separate poses for before/after. The
sun-disabled capture retains sky fill/background to compare flood lighting; it
does not simulate nighttime terrain. No geometry/camera replacement was made.

| View | Before | After | Actual load fallback |
| --- | --- | --- | --- |
| Captain / window openings | [before](before-forward.png) | [after](after-forward.png) | [lite](lite-forward.png) |
| Instruments, handles hidden | [before](before-instruments.png) | [after](after-instruments.png) | [lite](lite-instruments.png) |
| Pedestal, controls applied | [before](before-pedestal.png) | [after](after-pedestal.png) | [lite](lite-pedestal.png) |
| Sun disabled / floods | [before](before-night.png) | [after](after-night.png) | [lite](lite-night.png) |

Visual inspection: native shell/window openings remain intact; no new surface
obstructs the forward window. Existing yokes can obscure portions of PFD/ND in
the normal captain view; the existing hide-yokes action clears the instrument
closeup. Native fixed labels and CDU keys remain visible around the live screen
overlays. Gear and pedestal handles differ from the fixed baseline while their
quadrant and placards remain fixed. The lite version has coarser geometry and
keeps buried lever bases static; its exposed handles and wheels articulate.

Automated browser assertions passed for all six screen types (PFD, ND, EICAS,
MCP, ISFD, CDU): each original CanvasTexture remains mapped and changes pixels
and texture version after data/page updates. Five added moving parts bind
nonempty native GLB triangles (medium: 1096/608/1276/538/538; lite:
124/70/683/355/347). Holding the same input 100 times produces no drift, trim
reverses, reset restores neutral and the blocked medium request loads lite.
No page exceptions were recorded. Tests also cover the pre-existing yoke,
throttle and pedal sequences, batch exclusion and shadow invalidation.

`npm run check`, all **413 Node tests**, and `npm run build` passed. The build
retains its existing large-chunk warning. No full-flight, mobile, terrain/horizon
scene, audio or hardware-GPU performance acceptance is claimed by this isolated
cockpit run.
