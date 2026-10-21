# Airport rendering performance (issue #97)

Base: `283a36b` (main including cockpit batching from #102). This comparison
isolates #97 from that previous improvement.

## Changes and quality tradeoffs

The rabbit uses one white PointLight, moved from station 15 to station 1 at
1.6 cycles/second. Its intensity (8), range (45 m), height (2.6 m above the
runway), and station spacing (50 m) are unchanged. Four PAPI lights, their
thresholds/colors, obstruction beacon, and steady runway/crossbar lamps remain.
The loaded airport contributes six PointLights instead of twenty. Moving a
light preserves the shader light count throughout each sequence.

The Graphics selector (Korean: 화질) offers:

| Preset | Coastal terrain shader | Maximum device pixel ratio |
| --- | --- | --- |
| High | Existing high, five layers, triplanar and micro detail | 2 |
| Balanced (default) | Existing low, grass/rock/plateau, planar sampling | 1.5 |
| Performance | Same low shader | 1 |

Ratios are capped by the device's DPR: a DPR 1 device remains at 1 in all presets.
The setting persists as `flight3d.renderQuality`. Invalid/unavailable storage
uses Balanced. High restores the previous terrain and resolution quality.
Balanced/Performance reduce terrain biome variety (including sand/snow),
cliff projection detail and anti-tiling; close-up terrain can repeat more.
Lower DPR softens the 3D scene and cockpit instruments; HTML controls remain
at native CSS resolution. Lukla's DEM shader is separate and unchanged; the
resolution cap applies there too. Geometry, collision heights and physics are
unchanged. Switching between high/low can compile a shader once; the rabbit
itself never changes shader variants.

## Reproducing

Serve this branch on 5197 and the unchanged base on 5198. Start a dedicated
Chrome with `--headless --no-sandbox --use-gl=angle --use-angle=vulkan`,
`--remote-debugging-port=9497` and a dedicated profile. Then run:

```sh
EXCLUSIVE_GPU=1 node scripts/verify-airport-performance.mjs
```

On Linux, `EXCLUSIVE_GPU=1` waits for other Vulkan Chrome GPU processes to
exit and discards a timed sample if another process starts during it. Use a
quiet GPU for reproducible comparisons.

Override `APP_URL`, `BASELINE_URL`, `CDP_PORT`, and `ARTIFACT_DIR` as needed.
The harness refuses missing models, unexpected light counts and failed shader
programs. It loads the actual aircraft, medium cockpit and airport kit before
sampling. It uses seeded placement (12345), a 780×437 CSS viewport, noon/night,
runway cockpit preset, and device DPR 1/2. For every
condition it warms 12 frames, then samples 36 native requestAnimationFrame
intervals while invoking the actual `animate()` loop. There are two passes with
reversed variant order. `performance.json` retains raw intervals, buffer size,
light/program counts, draw calls, triangles, GPU name and summary statistics.
PNG names encode variant, view and hour; fixed-pose captures use device DPR 2
at noon/night for runway, approach and coastal cruise. These captures are separate
from the timed runway loop, so slow conditions do not advance the aircraft farther
before visual comparison.

Absolute FPS is specific to this device and resolution. These are actual frame
loop intervals, not isolated GPU timer queries or predictions for user hardware.
This is a bounded preset comparison, not a complete demo flight or mobile-device
benchmark. Wall-clock lighting means individual flash phases may differ between
screenshots; the unit test covers every station and wrap deterministically.

## Behavior checks

- `npm run check`: JavaScript syntax and pinned Actions passed.
- `npm test`: 291 passed, zero failed.
- `npm run build`: passed (existing bundle-size advisory remains).
- `node scripts/verify-render-quality.mjs`: High → Balanced → Performance →
  High uses high/low/low/high terrain, updates saved settings, and Performance
  remains selected with DPR 1 after reload. The mobile menu exposes the selector
  at 390×844 CSS pixels (see `mobile-quality.png`).
- The same browser check renders all 15 rabbit positions over three full cycles:
  program count stays 33 throughout all 45 updates, with zero WebGL errors and
  zero failed shader programs (see `quality-controls.json`). This checks absence
  of per-station shader compilation, not absence of every possible frame spike.
- Node lighting regression checks all stations over three wraps, one active
  rabbit light plus four PAPI units, the exact light intensity/range/height,
  and on-/above-/below-glideslope PAPI colors.

Preliminary timing runs were discarded after other GPU browser tasks started.
The reported final run uses the exclusive GPU guard; preliminary contended
samples are not included in `performance.json`.
