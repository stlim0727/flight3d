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
| performance | 1 | 1280 × 720 |
| ultraLow | 0.75 | 1280 × 720 |

Tiers also own the world mesh density, so switching to `performance` is not just
a shader change:

| Preset | Terrain segments | Water segments |
| --- | --- | --- |
| high | 256 | 180 |
| balanced | 192 | 144 |
| performance | 128 | 96 |
| ultraLow | 64 | 64 |

A quality change rebuilds the terrain and sea geometry synchronously and lets the
foliage layer rebuild its road meshes against the new grid. The sea keeps a fixed
200 m camera snap step at every tier.

The drawing ratio is the minimum of device DPR, the preset DPR cap, and
`sqrt(maxPixels / (CSS width * CSS height))`. Startup, manual quality changes,
and viewport resizing use the same calculation. CSS canvas size and DOM HUD
resolution are unchanged. Large screens can render below DPR 1 to stay within
the preset's budget. A smaller viewport restores the allowed detail. On a
1440 × 900 desktop, `performance` now draws at 0.84 DPR (1214 × 759) while
`balanced` stays at 1.

The F-16 uses 85% of the usual Balanced drawing ratio. Performance and Ultra
Low also cap its drawing ratio at 85% of device DPR. Balanced and lower tiers
use a simpler tinted canopy in cockpit view. At Coastal, F-16 views using
those tiers above 500 m over the
field omit the local airport lights from lit shaders. They return below 400 m
or when the player switches aircraft or quality. The runway emitters and
instrument indications remain visible.

For example, balanced quality on a 3840 × 2160 CSS viewport at DPR 2 previously
allocated a 5760 × 3240 framebuffer. It now uses 2560 × 1440: about 80% fewer
pixels. A touch-first 390 × 844 viewport at DPR 3 starts at DPR 1 rather than
1.5: about 56% fewer pixels. These are framebuffer work reductions, not measured
FPS gains; CPU-bound scenes may not speed up.

Run `node --test tests/renderQualityBudget.test.js` for budget boundaries,
capability defaults, saved choices, and resize transitions. Browser acceptance
must verify actual drawing dimensions, saved selection after reload, and DOM
size through hardware Chrome after the GPU preflight.

The B738 also streams its [lite cockpit interior](cockpit-assets.md) on first
entry at Performance or Ultra Low. Runtime adaptation, GPU calibration, and
compressed texture variants are separate work. Do not infer GPU capacity from these startup hints
or lower quality in response to isolated loading/compilation stalls.

Ultra Low keeps the current geographic terrain tile and airport-edge cutouts at
full mesh resolution. Other streamed tiles reduce triangles while sharing their
boundary samples, imagery, and full-resolution height queries. At low altitude,
the detailed building tiles beneath the aircraft and camera remain visible,
along with any loaded building tile within 200 m horizontally. Distant buildings
are left to the aerial imagery by day. Night overview lights keep their existing
coverage. The building collision index is independent of render visibility.
Local 3D city buildings apply the same Ultra Low cap: every archetype already
collapses to its plain far box, and instances more than 2,200 m from the camera
are skipped entirely. The collision `buildingData` is unchanged, so an aircraft
can never reach a culled building's envelope without the camera being inside
that radius. Switching back to a higher preset restores every instance.

Performance uses detailed procedural buildings within 1000 m and near tree
geometry within 400 m, with the existing tree hysteresis. Streamed building
tiles beneath the aircraft and camera or within 550 m horizontally keep their
detail. Farther city tiles use the existing silhouettes and night lights.
