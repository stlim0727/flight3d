# Flight performance telemetry

`flight_performance` summarizes foreground, unpaused flight windows. Startup timing
remains in `startup_trace`; its `readyMs` can include lobby idle, so use
`lobbyReadyMs`, `firstFrameMs`, and `boot.operationsMs` when diagnosing loading.

Windows flush every 30 seconds (or 8192 sampled frames), at aircraft/airport/scenario,
camera, quality, resolution or multiplayer changes, and when flight is held or the
browser loses activity. Short windows without a complete frame interval emit nothing.
The first interval after a hold, context change or flush is excluded. Developer
render experiments, scenario runner activity, flight loading and telemetry opt-out
are excluded. This is a window-weighted sample of active flying, not a per-user KPI.

Fields:

- `frameMs`: raw animation callback intervals in milliseconds, unaffected by physics
  timestep clamps; sample count, mean, p50/p95/p99, maximum.
- `fps`: 1000 / mean raw frame interval; `framesOver50Ms` and `framesOver100Ms`
  count stalls. Flight start/end context also gets a populated instantaneous `fps`
  from the raw animation delta; use the window event for sustained performance.
- `updateMs`: CPU time from callback start to rendering; `renderSubmitMs`: CPU time
  submitting scene and photo cockpit rendering, not GPU execution or presentation.
- `gpuMs`: asynchronous WebGL2 timer query samples, attempted once every 60 frames.
  At most four queries are pending; no driver wait/finish/readback is introduced.
  `gpuTimerSupported` indicates extension availability. Unsupported, disjoint and stale-window samples are omitted. Zero samples and null
  statistics mean unavailable, never zero GPU cost. GPU time excludes browser composition.
- `drawCalls`, `triangles`: all renderer passes in the measured render scope,
  including shadows and photo overlay; normal renderer auto-reset behavior is restored.
- `longTasks`: existing observer's bounded long-task summary for window boundaries.
- `aircraft`, `airport`, `scenario`, `camera`, `renderQuality`, `pixelRatio`, drawing
  buffer `width`/`height`, `isMultiplayer`, `device`, coarse `gpu` class. PostHog adds
  browser/OS/session and registered build tags. No raw GPU renderer string is added.

Compare frame p95 against update/render-submit/GPU times to identify likely CPU,
GPU or scheduling pressure. Asynchronous GPU samples and long-task observer coverage
are partial; these summaries do not identify JavaScript function stacks. Use a
browser performance trace for function-level attribution after narrowing the case.

Validation: `node --test tests/flightPerformanceMonitor.test.js tests/analytics.test.js`.
For real flight integration run `GPU_ANGLE=vulkan
CHROME_PATH=/home/stlim/.local/bin/chrome-headless node
scripts/verify-flight-performance.mjs` with hardware device access. This runs the
required GPU shader/readPixels preflight and keeps test reports in memory instead
of sending them to PostHog. Results are saved in `.cache/flight-performance/`.
