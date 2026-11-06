# Render quality budgets

Quality selection and framebuffer sizing live in `src/config/renderQuality.js`.
A valid saved quality always wins. With no valid saved value, a coarse primary
pointer or a positive reported device memory of at most 4 GiB selects
`performance`; other devices start at `balanced`. These are conservative hints,
not GPU benchmarks. The settings selector remains the manual override.

| Preset | Maximum DPR | Maximum physical pixels |
| --- | --- | --- |
| high | 2 | 3840 × 2160 |
| balanced | 1.5 | 2560 × 1440 |
| performance | 1 | 1920 × 1080 |
| ultraLow | 0.75 | 1280 × 720 |

The drawing ratio is the minimum of device DPR, the preset DPR cap, and
`sqrt(maxPixels / (CSS width * CSS height))`. Startup, manual quality changes,
and viewport resizing use the same calculation. CSS canvas size and DOM HUD
resolution are unchanged. Large screens can render below DPR 1 to stay within
the preset's budget. A smaller viewport restores the allowed detail.

For example, balanced quality on a 3840 × 2160 CSS viewport at DPR 2 previously
allocated a 5760 × 3240 framebuffer. It now uses 2560 × 1440: about 80% fewer
pixels. A touch-first 390 × 844 viewport at DPR 3 starts at DPR 1 rather than
1.5: about 56% fewer pixels. These are framebuffer work reductions, not measured
FPS gains; CPU-bound scenes may not speed up.

Run `node --test tests/renderQualityBudget.test.js` for budget boundaries,
capability defaults, saved choices, and resize transitions. Browser acceptance
must verify actual drawing dimensions, saved selection after reload, and DOM
size through hardware Chrome after the GPU preflight.

Runtime adaptation, GPU calibration, geometry LOD changes, and compressed texture
variants are separate work. Do not infer GPU capacity from these startup hints
or lower quality in response to isolated loading/compilation stalls.
