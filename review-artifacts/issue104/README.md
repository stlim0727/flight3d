# PR #104 startup regression

The restored merged code failed in Chromium with:

```
TypeError: Cannot set properties of null (setting 'value')
  at FlightSimulator.initUI (src/main.js:1207:25)
  at new FlightSimulator (src/main.js:233:10)
```

Both `window.simulator` and `#render-quality` were absent. PR #105 added
another `.language-control`; #104 moved just the first matching label before
removing `.presets-bar`. Moving both labels explicitly fixes the integration.

`startup-results.json` and `recovered.png` are from the fixed branch, with
headless Chromium/SwiftShader at 640×400 and DPR 0.5. Startup completed without
uncaught exceptions and rendered frames advanced. Quality changes remained wired,
Environment showed the quality selector, and a second native click closed Instruments.
After proving frame advancement, the focused harness disables further scene renders
for DOM interactions to avoid software-GPU backlog. This is not full rendering or
physical-device acceptance.

The full responsive verifier passed startup and produced the first portrait captures,
but timed out on `Input.dispatchTouchEvent` under software WebGL. The eleven-layout
suite is not claimed as passed. The historical #104 evidence remains under issue92.

Node 22.23.2: syntax/action-pin checks, all 309 Node tests, and production build passed.
Vite reports its existing large-bundle advisory.

To reproduce, start Vite on 5193 and a dedicated headless Chromium with CDP on 9493
using `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
Run `node review-artifacts/issue104/verify-startup.mjs` with Playwright installed in
a separate temporary directory; set `PLAYWRIGHT_MODULE` to its `index.mjs` absolute
path. `SIM_URL`, `CDP_URL`, and `ARTIFACT_DIR` override defaults. The full verifier
is `node scripts/verify-responsive-ui.mjs` (default ports 5192/9492).
