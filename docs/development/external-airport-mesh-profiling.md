# External airport mesh profiling (issue #944, item 4)

Item 4 of #944 is conditional: move the streamed-airport mesh build to a worker
only when profiling shows a frame drop. This document records the bounded,
repeatable measurement used to make that decision, so the choice can be revisited
without rediscovering the setup.

## What is measured

`scripts/profile-external-airport-mesh.mjs` boots the simulator in hardware
Vulkan Chrome with `?telemetry=0`, starts an Incheon flight destined for RKSS,
waits for the first streamed region and a settled `flight` state, then injects a
timed copy of the streamer's own builder at runtime:

- `sim.airportStreamer._buildRegion` is replaced by a function that calls the
  real `createExternalAirportRegion()` from
  `src/geospatial/externalAirportSurface.js` after its module has been
  preloaded. Only that synchronous call is timed (`syncMs`); fetch, index
  parsing and the cached dynamic import stay outside the measured slice.
- Each region build records start/end timestamps, runway count, mesh children,
  geometry count and position-vertex count, so the measured workload is known.
- A `PerformanceObserver({ type: 'longtask', buffered: true })` records long
  tasks with their `startTime`/`duration`; overlap with each window and with
  the build is computed in the report.
- `sim.flightPerformance.emit` is replaced by an in-memory sink with a long
  flush interval, and each window is flushed explicitly. No probe report is
  sent to PostHog; `telemetry=0` is kept for the whole run.
- Raw `requestAnimationFrame` intervals are collected with their absolute
  timestamps, allowing the frame containing the build to be identified. p50,
  p95, p99, max and `framesOver50`/`framesOver100` are computed from the raw
  intervals; the in-memory `FlightPerformanceMonitor` report adds `updateMs`,
  `renderSubmitMs`, `gpuMs`, draw calls, triangles and its own stall counts.

## Ordering and controls

After a 2 s warmup, four 5 s windows run in A/B/B/A order:

| Window | Setup | Expected build count |
| --- | --- | --- |
| `A1` | `setDestination(null)` + `releaseGroundHold()` unmount the region out of band, then `ensure('RKSS')` at window start | 1 |
| `B1` | RKSS region remains mounted; no `ensure()` call | 0 |
| `B2` | same as `B1` | 0 |
| `A2` | same reset and trigger as `A1` | 1 |

The reset and trigger happen in one JS task so the frame-loop `streamer.update()`
cannot start a load between them. Unmount and warmup cost stay outside each
window. A/B/B/A controls warm-up and thermal drift: `A1`/`A2` bracket the two
controls, and the controls are adjacent. The script fails if a build window has
no build, a control window has a build, or too few frames were collected.

## Required hardware evidence and reproducibility

The launcher itself rejects anything but `GPU_ANGLE=vulkan`. With the browser
already started, the script runs `scripts/verify-browser-gpu.mjs` against the
same CDP endpoint: this checks a readable/writable render node, compiles a
WebGL2 shader pair, draws a red triangle over blue, and requires the centre
pixel to be exactly `[255, 0, 0, 255]` with GL error 0. Hardware renderer
strings are additionally required in the simulator's own WebGL2 context.
Software rendering never counts as evidence.

Run from the repository root on a host with a usable `/dev/dri/renderD128`:

```sh
GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless \
  node scripts/profile-external-airport-mesh.mjs
```

`PROFILE_WINDOW_MS` overrides the per-window duration and `ARTIFACT_DIR`
overrides the output directory. Artifacts stay in
`.cache/external-airport-mesh-profile/`: `gpu.json` (preflight evidence) and
`report.json` (browser/renderer evidence, raw frame intervals, per-window
summaries, build records, long tasks and counters). No other repository files
are required to run the profile.

## Measured result (2026-11-22)

Two independent passes were run from the worktree root with:

```sh
GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless \
  node scripts/profile-external-airport-mesh.mjs
ARTIFACT_DIR=.cache/external-airport-mesh-profile/run2 \
  GPU_ANGLE=vulkan CHROME_PATH=/home/stlim/.local/bin/chrome-headless \
  node scripts/profile-external-airport-mesh.mjs
```

Hardware evidence in both passes: Chrome/156.0.8078.73, ANGLE Vulkan 1.4.335,
`Intel(R) Graphics (ADL-N)` with the Mesa driver, accessible
`/dev/dri/renderD128`, WebGL2 shader/readPixels centre pixel exactly
`[255, 0, 0, 255]`, GL error 0. The preflight also reported
`WebGL 2.0 (OpenGL ES 3.0 Chromium)`. No software renderer was involved.

Raw rAF intervals (ms) from the two passes; `>50/frames` is `framesOver50`
over the raw sample count, `>100` is `framesOver100`, `update p95` is the
in-memory monitor's `updateMs.p95`, `LT` is the long-task count with the
maximum duration, and `sync` is the injected synchronous
`createExternalAirportRegion()` duration:

| Pass / window | Build | p50 | p95 | p99 | max | >50/frames | >100 | update p95 | LT | draw calls / triangles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 · A1 (build) | 2.5 ms | 66.6 | 816.7 | 883.3 | 883.3 | 19/35 | 8 | 31.0 ms | 11 / 882 ms | 124 / 53037 |
| 1 · B1 (control) | none | 50.0 | 66.7 | 666.6 | 666.6 | 17/93 | 3 | 19.9 ms | 3 / 691 ms | 124 / 53037 |
| 1 · B2 (control) | none | 50.0 | 66.7 | 66.8 | 83.3 | 24/100 | 0 | 17.3 ms | 0 | 124 / 53037 |
| 1 · A2 (build) | 0.5 ms | 50.0 | 66.8 | 100.1 | 100.1 | 39/92 | 1 | 17.2 ms | 0 | 124 / 53037 |
| 2 · A1 (build) | 0.3 ms | 50.0 | 666.7 | 983.3 | 983.3 | 15/52 | 8 | 21.2 ms | 9 / 968 ms | 124 / 53037 |
| 2 · B1 (control) | none | 33.4 | 83.3 | 850.0 | 850.0 | 20/92 | 3 | 21.1 ms | 5 / 841 ms | 124 / 53037 |
| 2 · B2 (control) | none | 49.9 | 50.1 | 66.7 | 66.7 | 15/117 | 0 | 18.6 ms | 0 | 124 / 53037 |
| 2 · A2 (build) | 0.4 ms | 50.0 | 66.7 | 100.0 | 100.0 | 27/97 | 0 | 18.0 ms | 0 | 124 / 53037 |

Artifacts: `.cache/external-airport-mesh-profile/report.json` and
`.cache/external-airport-mesh-profile/run2/report.json`, each with a sibling
`gpu.json` preflight record. Both artifacts contain the raw frame arrays,
per-window in-memory monitor reports, build records, long-task entries and
counters. Browser exceptions were empty in both passes.

### Attribution

- The generated workload is exactly the one described in #922: each measured
  build produced **2 runways, 2 mesh children, 2 geometries and 8 position
  vertices** (two four-vertex ribbons), with 124 draw calls and 53,037
  triangles unchanged in every window and 86 shader programs throughout.
- The synchronous build took **0.3–2.5 ms**, far below one 16.7 ms frame
  budget. No build exceeded 50 ms or the frame budget.
- A1 has large frame gaps and long tasks in both passes, but they are not
  attributable to the mesh: the first long task began 76 ms (pass 1) and
  16 ms (pass 2) after the build finished, and the longest began 2,734 ms
  (pass 1) / 2,532 ms (pass 2) after it. `updateMs.p95` stayed at 21–31 ms in
  A1, so the gaps are not inside the animate callback. The no-build B1
  controls show the same class of stall (691 ms and 841 ms long tasks,
  p99 666.6 ms and 850 ms) with no build at all.
- A2, the second build window in each pass, is clean: p95 66.8/66.7 ms,
  max 100.1/100 ms, zero long tasks, and `updateMs.p95` 17.2/18.0 ms —
  comparable to the adjacent no-build B2 controls. The single ~100 ms frame
  in A2 began 3,264 ms (pass 1) / 2,574 ms (pass 2) after the build, with no
  long task, so it is not build-related.
- `framesOver50` is nonzero in every window because this host renders the
  scene at roughly 20 fps; the relevant comparison is the frame-interval
  distribution and matching build/long-task attribution, not an absolute
  zero. GPU timer samples were sparse (0–1 per window), so GPU time is not
  used to decide this item.

### Decision: no worker migration; item 4 closed with evidence

There is no reproducible ≥50 ms stall or frame-budget-exceeding build time
attributable to synchronous external-airport mesh generation, so the
conditional migration in #944 item 4 is not warranted. No source file was
changed. This follows the #922 decision comment:
"현재 생성물은 활주로 2개 리본 수준이라 메인 스레드에서 만들고 있습니다.
프로파일링에서 프레임 드랍이 확인되면 메시 생성을 워커로 옮기겠습니다."
("The current output is only two runway ribbons, so it is built on the main
thread; move mesh creation to a worker only if profiling confirms frame
drops.") The measured two-ribbon workload and the clean A2 repeats satisfy
that condition for leaving it on the main thread. If the workload later grows
(more runways, threshold bars or terrain geometry in the same synchronous
slice), rerun this profile before revisiting the decision.
