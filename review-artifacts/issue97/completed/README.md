# Completed airport performance acceptance — 2026-10-23

PR #105 already implemented the approach-light pool and graphics presets.
This follow-up completes its outstanding repeated frame-loop comparison and
checks the controls against current main. No additional rendering optimization
is included in this follow-up.

## Controlled historical comparison

- Before: `d05ec65f8620ccdba5ef8a13c81e29a3dba733a7`, the parent of #105.
- After: `c6d466965ef411dcce22a1ee41b2f46d73171d26`, the merged #105.
- Both are unmodified Git exports, served by Vite 8.3.4 / Node 22.23.2.
  Comparing adjacent revisions avoids attributing subsequent cockpit, shadow
  and UI changes to #97.
- Windows, Chrome 155.0.8059.85, Intel Arc 140V (8 GB), driver 32.0.101.8626;
  WebGL reports ANGLE Intel Arc 140V / Direct3D11 (no software renderer).
  This is a different device from the original issue's Intel N95/Vulkan system.
- 780×437 CSS pixels, device DPR 1 and 2, noon, coastal runway cockpit,
  global random seed 12345. Aircraft, cockpit and airport kit loaded.
- Actual `animate()`, native requestAnimationFrame, 60 warm-up frames then
  120 intervals per condition; two passes with reversed variant order.
  The browser retains normal frame pacing (approximately 60 Hz).
- No concurrent test/GPU workload was started during the measurement. Normal
  desktop applications remained open; Windows-wide exclusive GPU access is not
  asserted. Order, thermal and scheduling effects remain visible in the runs.

[Raw intervals, station positions and program counts](performance.json) and
[aggregated statistics](summary.json) are retained. FPS below is the arithmetic
mean of the two per-run FPS values; p95 pools the 240 intervals. These are wall
clock frame-loop measurements, not GPU timer queries.

| Device DPR | Variant | Render buffer | FPS, forward / reverse | Mean FPS | p95 / maximum ms |
| --- | --- | --- | --- | ---: | --- |
| 1 | Before | 780×437 | 60.01 / 50.35 | 55.18 | 33.5 / 35.0 |
| 1 | High | 780×437 | 60.00 / 59.99 | 60.00 | 16.9 / 17.1 |
| 1 | Balanced | 780×437 | 60.00 / 60.00 | 60.00 | 17.0 / 17.4 |
| 1 | Performance | 780×437 | 60.00 / 59.52 | 59.76 | 17.0 / 33.6 |
| 2 | Before | 1560×874 | 23.61 / 23.23 | 23.42 | 53.1 / 54.1 |
| 2 | High | 1560×874 | 30.91 / 27.59 | 29.25 | 50.6 / 53.1 |
| 2 | Balanced | 1170×655 | 47.68 / 43.10 | 45.39 | 34.5 / 50.1 |
| 2 | Performance | 780×437 | 57.59 / 60.00 | 58.80 | 17.2 / 34.1 |

At device DPR 2, High improves mean FPS by 24.9% with the high terrain shader
and original resolution retained. Balanced and Performance improve by 93.8%
and 151.1%, trading terrain detail and resolution for speed. DPR 1 mostly reaches
the presentation limit; it cannot quantify the full rendering headroom.
Balanced combines a shader change and a resolution change, so its improvement
must not be attributed to the shader alone.

The loaded airport light count is 20 before and 6 after. Render totals are
553 calls / 3,663,546 triangles before and 554 / 3,663,720 after (including
shadow passes). A shared global seed does not imply identical random placement
after object construction changes. This small scene difference is retained
and reported; the comparison measures the merged PR, rather than a pixel-exact
light-only microbenchmark.

All 16 conditions recorded constant program counts (22) and zero reported
shader/runtime/console errors. For DPR 1 High, frames following a rabbit station
change have p95 17.0 ms versus 16.9 ms while holding a station (96/140 samples).
For DPR 2 Balanced these are 34.5/34.4 ms (124/112 samples). No station-related
shader growth or additional p95 delay is evident here. Occasional slow frames
remain: this does not establish the absence of every flash-related hitch.
The station comparison associates an interval with the preceding rendered
frame, since a rAF timestamp measures time since the previous callback.

## Visual and current-main acceptance

All four variants were inspected at runway, approach and coastal cruise, noon
and midnight. [The 24-view comparison](comparison.png) retains the full set.
[High approach](high-approach-12.png) and
[Performance approach](performance-approach-12.png) retain full-size detail.
High preserves the baseline appearance; the low shader makes the ground smoother
and less varied, and lower DPR softens cockpit lettering and edges. No new
missing geometry or lighting regression was visible in the paired historical
captures. Historical cockpit illumination is preserved here; these images are
not screenshots of today's cockpit lighting.

Current main `2246d7d`, using the updated
`scripts/verify-render-quality.mjs`, also passed:

- High → Balanced → Performance → High: terrain high/low/low/high and DPR
  2/1.5/1/2; preferences saved, Performance restored after reload.
- All 15 rabbit stations across three wraps: 45 updates, constant 28 programs,
  zero WebGL errors and failed shaders.
- A separate live midnight runway loop in Balanced: 60 warm-up + 120 sampled
  frames, 59.50 FPS, p95 17.0 ms, max 33.4 ms, all 15 stations observed and
  constant 30 programs. This is a current-main smoke check, not part of the
  historical before/after performance claim.
- At 390×844 CSS pixels, the current main menu's Settings tab exposes the
  quality selector within the viewport and passes hit testing.
  [Mobile capture](current/mobile-quality.png), [raw checks](current/quality-controls.json).
- Node 22.23.2: syntax/action-pin checks passed; all 446 tests passed; production
  build passed with the existing bundle-size advisory.

The former mobile harness clicked an obsolete selector with optional chaining
and never asserted visibility. It now opens the actual Settings tab, requires
visibility/viewport fit/hit testing, and renders the first frame before checking
the boot overlay. The historical benchmark also tolerates the pre-lobby
baseline's missing game-flow controller, rejects software GPUs and invalid or
incomplete samples, and records per-frame light positions/program counts.

## Reproduce

Export the two exact revisions above to separate directories, make the locked
npm dependencies available, and serve Before on 5198 and After on 5197. Start a
dedicated headless Chrome profile with CDP 9497. On Windows use default ANGLE
(D3D11); on supported Linux use the documented Vulkan flags. Then run:

```sh
node scripts/verify-airport-performance.mjs
```

`APP_URL`, `BASELINE_URL`, `CDP_PORT` and `ARTIFACT_DIR` override defaults.
Use a new output directory for each run. The final JSON is written only after
all 16 conditions pass. On Linux `EXCLUSIVE_GPU=1` adds the existing competing
Vulkan-browser guard; do not use that Linux-only process check on Windows.
Run the controls harness separately against current main using `APP_URL`.

This closes the bounded acceptance gap recorded by #105. It does not measure
the full demo route, mobile hardware, or predict FPS on the original N95.
