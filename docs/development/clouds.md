# Cumulus cloud rendering (#12)

`CloudLayer` draws a bounded population of 3D density volumes. Cloud
shape is fixed in world space: flying above, banking, or entering a cloud does
not turn its silhouette toward the camera. Unequal lobes, density erosion,
random yaw, and varying width/depth/height replace repeated flat oval outlines.
Sun-direction self-shadowing gives brighter upper surfaces and darker interiors.
The existing sunlight, ambient light, exposure, and time-of-day controls remain
in charge of cloud lighting. Clouds use an altitude-adjusted haze sightline so
high cloud decks do not become opaque blue cutouts in the ground-level fog.
Terrain and water materials, including issue #66, are outside this change.

## Assets and rendering budget

`createCloudDensity` is original Flight3d source, generating four 48³ R8 density
variants at construction. Each variant combines five unequal ellipsoidal lobes
with deterministic, trilinearly interpolated value noise at two frequencies.
Empty boundary voxels and two additional empty Z slices per variant prevent
rectangular silhouettes and cross-variant filtering. The shared Data3DTexture
is 48×48×200, exactly 460,800 bytes (450 KiB), without mipmaps. There are no
third-party assets, purchases, downloads, or image-loading failure paths.

Up to 64 cloud bounds are placed over the existing 32km region, excluding the
immediate departure corridor by center position. The deterministic population
contains 63 clouds. Center altitude remains 2,800–3,600m with the existing 3,400m
Lukla offset. Density volumes extend above and below their center according to
cloud thickness. Airport/preset changes reuse the existing texture and geometry.
`dispose()` releases the shared texture, geometry, and variant materials.

Each visible cloud uses one draw call and 12 bounding-box triangles. Clouds share
geometry and are frustum culled individually. The shader intersects
each viewing ray with a box and integrates at most 24 density samples, stopping
when transmittance falls below 1.5%. Two additional density samples estimate
sunlight attenuation at occupied samples. Density shape and noise are baked
on the CPU, avoiding their repeated evaluation in every fragment. Empty samples
skip lighting work. Shared texture/material resources keep memory bounded.

Three.js sorts each cloud by its center depth alongside transparent effects.
Each cloud keeps its assigned density variant across camera cuts.
Rendering uses box back faces, so rays also work from inside a volume. Ray/slab
intersection guards parallel directions against division by zero.

This is a small-volume cumulus layer, not a weather simulation. Five-lobe shape
families remain stylized, ray jitter may be visible at close range, and overlapping
volumes use approximate center sorting. Depth testing occurs at the bounding-box
back face, so this approach is intended for cloud decks clear of opaque terrain;
it does not integrate scene-depth intersections inside a cloud. It costs more
fragment work than the flat-card baseline; triangle counts alone do not measure
that cost. Mobile performance has not been established.

## Reproduce visual and GPU evidence

Use Node 22.23.2. Start Vite, then a dedicated Chrome:

```sh
npm run dev -- --host 127.0.0.1 --port 5182 --strictPort
```

```sh
google-chrome-stable --headless=new \
  --user-data-dir=/tmp/flight3d-cloud-review \
  --remote-debugging-port=9458 --window-size=1280,720 \
  --use-gl=angle --use-angle=vulkan --no-first-run \
  http://127.0.0.1:5182/
```

Then run:

```sh
node scripts/verify-clouds.mjs
```

`CDP_PORT` selects the debug port. `BASELINE_REF` defaults to `a1cc4b8`, the
flat-card implementation. The verifier temporarily writes both that revision's
cloud layer and atmosphere module, then removes them at process exit. It refuses
to overwrite existing temporary baseline files. `CLOUD_VIEWS=overview,near,above`
can select a smaller inspection run; omit it for acceptance.

The script pauses the simulator's animation loop during isolated comparisons,
sets an actual 1280×720 viewport through CDP, and uses the same renderer, camera,
and solar hour for both versions. Eight conditions cover overview, near, banking,
a cloud directly overhead, above the layer, inside a cloud, sunset, and night.
Cloud positions differ between algorithms; overhead/inside camera coordinates
are selected from the candidate's first volume, then reused for both scenes.
The main loop resumes for simulator cockpit, wing, and chase screenshots.

After five warm-up renders, it records ten CPU submission times and five GPU
samples per view using `EXT_disjoint_timer_query_webgl2`. It waits for query
completion and rejects disjoint results. Unsupported timers are explicitly null;
CPU submission times must never be interpreted as GPU completion or FPS. The
metadata records the actual GPU, browser, viewport, cloud count, and texture bytes.
Texture counters are cumulative across comparison scenes and are not per-layer
memory measurements. Empty/incomplete comparisons, missing screenshots, lost
contexts, exceptions, and console errors cannot produce a successful result.

Screenshots and raw timing samples are in `review-artifacts/clouds/`. This
machine uses Intel Graphics ADL-N through ANGLE Vulkan. The final per-view GPU
results are recorded in `metrics.json`; these are isolated sky-plus-cloud costs,
not full-simulator or mobile frame-rate claims.

| Fixed view | Flat baseline GPU median | Density-volume GPU median |
| --- | ---: | ---: |
| Overview | 4.48ms | 9.69ms |
| Near | 4.20ms | 11.48ms |
| Above | 2.90ms | 7.91ms |
| Directly overhead | 6.10ms | 12.97ms |
| Inside | 3.84ms | 10.49ms |

This adds roughly 5–7ms of GPU work in these views. This is a visual-quality
tradeoff, not a performance improvement over the flat baseline.

Node tests cover deterministic density and variant differences, empty volume
boundaries/gutters, texture budget, departure corridor, identity across camera
sorting, repeated airport changes, resource disposal, and daylight/sunset/night
lighting. Required checks are `npm run check`, `npm test`, and `npm run build`.
