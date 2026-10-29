# CI and verification

The GitHub Actions gate runs on main pushes, pull requests, and manual dispatch.
It uses Node 22.23.2 (Vite 8 requires at least 22.12.0), npm's lockfile-based install and cache, syntax/action-pin checks,
Node logic tests, and a Vite production build. Run the same gate locally:

```sh
npm ci
npm run check
npm test
npm run build
```

Actions use full commit SHAs, the token has read-only contents permission, and
checkout does not retain credentials. New runs cancel superseded runs for the
same ref. Update pinned actions deliberately and keep the gate executable locally.
The default CI gate needs no repository secrets, deployment, or external-service
accounts. The optional [PR self-feedback workflow](pr-feedback.md) uses an
OpenAI API key and separate, narrowly scoped comment permissions.

## Browser acceptance

The legacy browser scripts are separate acceptance tools, not portable CI yet.
They expect a Vite server on port 5173, CDP ports, and WebGL support. The
[autonomous demo sweep](#autonomous-demo-acceptance) is the exception: it starts
its own preview server and browser on OS-assigned ports and runs in CI.
`test:flight` and `test:crash` launch `google-chrome-stable` from PATH;
`test:mobile` and `test:demo` launch `/usr/bin/google-chrome`. Provide both
executables (or matching symlinks) before following the commands below. Inspect the chosen script for its exact
ports and paths before running it. Some capture tools have machine-specific
output paths; test-flight-agent.js accepts ARTIFACT_DIR. Use a writable output
directory and preserve evidence relevant to the change.

For loaded-DEM Lukla contact, damage, and full-circuit acceptance, see
[lukla-physics.md](lukla-physics.md). `test:lukla` now fails incomplete flights
and checks three complete circuits plus a 10-second parking hold.

### Hardware GPU acceleration & performance

Hardware GPU acceleration is enabled for user accounts in the `render` (991) and `video` (44) groups with read/write access to `/dev/dri/renderD128`:

- **Headless Chrome GPU Flag**: On headless Linux (Ozone/no X11/no Wayland), desktop flags like `--use-gl=egl` fail. Use ANGLE with the Vulkan backend:
  ```sh
  --use-gl=angle --use-angle=vulkan
  ```
  This binds directly to the onboard Intel GPU (`ANGLE (Intel, Vulkan ... (Intel(R) Graphics (ADL-N)...)`). Avoid `--enable-gpu-rasterization --enable-zero-copy` without a window compositor as they peg CPU cores in 2D UI raster loops.
- **Flight test execution speed**:
  - `npm run test:flight`: Runs all 5 flight scenarios at **~8.25x real-time** (simulates 101s of 120Hz physics in ~12–13 seconds real duration).
  - Routine screenshots are opt-in to eliminate software raster stalls: `npm run test:flight:visual` or `npm run test:flight -- --screenshots`.
  - Failure/anomaly fallback: If any scenario fails or an anomaly occurs (excessive G-load, terrain clipping, NaN coordinates), a screenshot is automatically captured regardless of flags.
- **Screenshot latency benchmark**:
  - Software SwiftShader: ~7,380 ms per screenshot.
  - Hardware Intel GPU (ADL-N Vulkan): ~310–560 ms per screenshot (~13x–24x faster).
- **Performance metrics profile**:
  Each run exports structured benchmarks to `flight-test-performance.json` recording simulated vs real durations, speed multipliers, and substepping latency (typically ~2ms per 250ms slice).

Start `npm run dev -- --host 127.0.0.1` separately, then run the applicable
`npm run test:flight`, `test:crash`, `test:mobile`, or `test:demo` command. Coordinate
ports and browser profiles with other sessions. Inspect assertions, browser
errors, and produced images; a script exit code alone does not establish visual
acceptance. Node tests and a successful build do not verify WebGL rendering.

## Landing damage acceptance

Developer-mode UI and runtime scenarios have separate [acceptance instructions](developer-mode.md).
Start Vite separately and run `node scripts/verify-developer-mode.mjs`.

`npm run test:landing` checks normal landings, independent leg failures, partial
extension, controlled runway scraping through rest, catastrophic body impact and
repair. See [landing damage](landing-damage.md) for conditions, limitations and
port/artifact options. It is separate from the default Node test gate.

## Autonomous demo acceptance

`npm run test:demo-sweep` fast-plays the cinematic demos and judges the *flight*:
it claims its own free ports, starts `vite preview` on `dist/` and a private
headless Chrome, then drives every route through deterministic 120 Hz physics with
`sim.stepSimulation(0.25)` while the wall-clock loop is frozen with the sanctioned
`gameFlow.pause()`. Slice size only changes the sampling resolution, never the
scenario logic, because the demo timers advance in simulated time.

| Command | Runs |
| --- | --- |
| `npm run test:demo-sweep` | the four `core` routes (the PR gate in `demo-sweep.yml`) |
| `npm run test:demo-sweep:full` | every declared route, the nightly and dispatched run |
| `node scripts/demo-sweep.mjs --tier all --only c172-lukla-scenic --shots` | one route with evidence images |
| `node scripts/demo-sweep.mjs --update-baseline --retries 2` | rewrite `scripts/demo-sweep-baseline.json` from the worst of two flights |

Environment knobs: `TIER ONLY SHOTS STRICT RETRIES APP_URL PORT CDP_PORT CHROME_BIN
ARTIFACT_DIR DEV_SERVER FORCE_GPU SLICE KEEP_SAMPLES TMPDIR`. `FORCE_GPU=0` forces
SwiftShader; a writable `/dev/dri/renderD128` selects Vulkan instead. `TMPDIR` is where
Chrome puts its profile and its own scratch. Chrome needs that directory to have free
space and a short path: its `SingletonSocket` must fit the 107-character Unix-socket
limit, so a deep path (a nested worktree under `.cache`, for instance) kills Chrome at
launch, and a full `/tmp` tmpfs does the same. Both surface as the sweep's "headless
Chrome never exposed a debug target", which is a startup failure and not a flight
verdict — point `TMPDIR` somewhere short and roomy (for example `TMPDIR=$HOME/.tmp`)
and retry. Both servers are owned by the process that starts them: a Chrome that never
publishes a debug target shuts down the Vite it had already spawned rather than leaving it
detached on a port (verified by running the sweep with `CHROME_BIN=/bin/false`). The verdict is
always `ARTIFACT_DIR/demo-sweep-report.json` (`SLICE`-by-`SLICE` measurements, stage
trace, warnings, touchdowns, fails, reports), and the exit code is non-zero when any
route has a FAIL, or any REPORT under `STRICT=1`.

Measured cost on the hosted runner (SwiftShader, no GPU): the core tier is 153 s of sweep
wall and the full matrix with screenshots 942 s, against 25 and 45 minute ceilings. On a
Vulkan GPU the same routes take 66 s and 258 s; the simulated durations agree to the
slice, because only the rendering is slower without hardware.

`npm run test:demo` now delegates to `--only b738-coastal-classic`, so the coastal
737 keeps its single-route entry point without the hardcoded 5173/9462/Chrome paths.
The remaining `verify-*` browser harnesses stay: they cover DOM, audio and camera
layout that the sweep does not own.

### What the sweep refuses, and what it only reports

Rules live in `scripts/lib/abnormalityChecks.mjs` (pure, no DOM or CDP, covered by
`tests/demoSweepChecks.test.js`), and the route table in
`scripts/lib/demoSweepSpec.mjs` is derived from `src/director/demoProfiles.js` so a
new demo choice cannot be added without being swept.

- **FAIL** is a physical or contractual fact: crash, non-finite state, aircraft
  substitution, an airborne stall, gear-leg damage or a landing incident, a touchdown
  past `src/physics/gearDamage.js`'s own impact limit, flight below the route's
  declared clearance intent, beyond the Vne/Mach ceiling in
  `src/systems/FlightWarnings.js`, past the route's declared roll promise, a load
  factor no airframe flies (`SOLVER_G_LIMIT`), an out-of-order or unvisited stage, a
  route that never completes inside its ceiling, or a handoff that leaves controls
  disabled, virtual inputs set, a dead stick, or a 737 rollout without spoilers and
  reverse thrust.
- **REPORT** is a measured peak that drifted from `scripts/demo-sweep-baseline.json`:
  bank, airspeed, sink, clearance, rates, warning seconds, elapsed time. Cinematic
  routes are allowed to bank hard and call warnings, so those are trends to review;
  `STRICT=1` promotes them into failures.
- **KNOWN** is a route-table declaration (`knownIssues`) for a fault the app is
  already known to produce. It moves matching FAILs out of the verdict and quotes
  them in the report, so a documented demo regression does not redden every
  unrelated pull request. Each entry names the tokens its fault must contain and a
  note that quotes the measured value; anything the declaration does not name is
  still a FAIL, a route with a known issue is never baselined, and a declaration
  that stops reproducing becomes a REPORT — under `STRICT=1` a failure — so the
  entry is deleted once the demo is fixed.

Scenery uses `Math.random` seeds for foliage and ships, so soft peaks carry margin by
design and every hard FAIL is a monotonic fact. Regenerate the baseline only from a
run with no FAIL: the driver refuses to widen a baseline from a failed flight.

### What the first sweep found broken

The 2026-10-29 full-matrix run was the first time either Lukla demo flew unattended,
and both are broken — they are the sweep's first caught regressions, declared as
`knownIssues` rather than silently accepted:

- `b738-lukla-classic` crashes inside `CANYON_APPROACH` at 126 s: 13 m agl at 111 kt
  with +15° pitch and a *positive* vertical speed, because the valley ahead climbs
  faster than the guidance climbs. Result: terrain collision, belly impact.
- `f16-lukla-low-pass` ends at 28 s. The `CLIMB` stage pulls up at 389 kt into the
  rising ridge; clearance falls to 6.6 m one slice after reading 47.6 m, the nose
  radome contacts the ground and the airframe spins at 36 rad/s. The scenario's own
  `result.minClearanceM` records 7.7 m, so the older
  `scripts/verify-f16-lukla.mjs`, which asserts more than 50 m, fails on this too.

Neither was caught before: `npm run test:lukla` never reaches its circuit, because it
asserts the page auto-starts the Lukla demo while a fresh browser profile loads the
coastal one, so `test-lukla-demo-benchmark.mjs:81` fails first. To be sure the sweep
was not inventing the crashes, both routes were re-flown through the benchmark's own
arming path (`sim.clock.getDelta = () => 0`, `setAirport`, `demoDirector.start`) in
the same page: the trajectories match to the slice, including the impact. They are
demo faults, and fixing the guidance is follow-up work outside this change.

A third finding is intermittent: `c172-coastal-scenic` reached the water on 3 of 37 cold-page
flights (`RECOVER CLEARANCE` down to 3.9 m, then `CRASH WATER` at 86 kt), on the pre-Hangang build
and on `main` alike. During that loss of clearance the vertical speed reads as a *climb* of
865-872 fpm, so the question is what the clearance is being measured against, not why the aircraft
would descend. It is declared `intermittent`, because a fault that appears on some page loads
cannot be proven absent by a single clean flight, and the crashing runs never enter
`demo-sweep-baseline.json` — `--update-baseline` refuses to widen a baseline past a FAIL. All three
are tracked in [issue #292](https://github.com/stlim0727/flight3d/issues/292).


## Selection and provenance

Adapted from the sibling Keepory (historically Stash) repository at commit
ac310ff9751f5c85c99e451d2cf67439f086d950:

| Source | Flight3d adaptation |
| --- | --- |
| AGENTS.md, CLAUDE.md, docs/development/agent-working-rules.md | Short orientation, scoped edits, evidence-based diagnosis and verification |
| docs/development/agent-task-map.md | Task routing rebuilt for Flight3d modules and tests |
| .github/workflows/ci.yml, .circleci/config.yml | Lockfile install, runtime selection, cache, tests and web build |
| scripts/check-workflow-actions.mjs | Copied immutable-action-reference check |

Keepory's Expo/pnpm, Supabase, Play release, account/sync invariants, CI_PROVIDER
switch, and mirrored operational skills are specific to that project and omitted.
The agent-efficiency script hardcodes Keepory directories and historical line
budgets; task routing is useful here without inheriting those arbitrary gates.
CircleCI configuration is omitted because there is no Flight3d integration to
preserve. Browser acceptance was required to be made portable before adding it to
CI; the [autonomous demo sweep](#autonomous-demo-acceptance) closes that gap by
claiming its own ports and browser and running in GitHub Actions.

The original package.json declared Vite 6 while the existing lockfile and local
installation used Vite 8. The declaration now matches the existing lockfile
(^8.3.4), allowing npm ci without replacing the resolved dependency graph.

### Exterior control surfaces (issue #59)

`node --test tests/gltfControlSurfaces.test.js` loads the actual exterior GLB's
geometry without image decoding. It checks triangle-area conservation, neutral
bounds, material/UV retention, left/right deflection signs and hold/reverse/release.
The exterior asset stays unchanged: `GltfControlSurfaces.js` clips its batched
triangles into seven moving surfaces in the `B737` mesh's local coordinates.
Hinge measurements are specific to `public/models/b737-800.glb`; remeasure them
and rerun the geometry and browser checks if that asset changes. Landing gear
and the procedural fallback remain independent. The cockpit shadow proxy retains
the original neutral geometry, so its silhouette does not animate with controls.

For rendering/input evidence, start the Vite server as above and launch Chromium:

```sh
chromium --headless --no-sandbox --use-gl=angle --use-angle=swiftshader \
  --enable-unsafe-swiftshader --remote-debugging-port=9447 \
  --user-data-dir=/tmp/flight3d-controls-chromium http://127.0.0.1:5173/
```

In another shell, run `node scripts/verify-control-surfaces.mjs`. This uses native
CDP D-key input, deterministic physics stepping, and the loaded aircraft's update
method to assert seven nonempty surfaces, held input, reversal and release. It
also renders a clone of the loaded exterior in neutral and deflected poses for
visual inspection. Output goes to `.cache/control-surfaces/` (override with
`ARTIFACT_DIR`); inspect both PNGs and `browser-results.json`. This bounded check
is not a complete flight, gear, spoiler, cockpit-shadow or performance acceptance
suite. Stop only the browser/server you started afterward.
### Landing gear geometry acceptance

`node scripts/test-gear-retraction.mjs --gpu` renders the loaded airframe and
procedural fallback from above, directly below, the side, and close-up at five gear states.
It checks full cycles, reversal, and main-strut coaxiality through compression
and release, and writes captures/results to
`.tmp/gear-retraction`. Add `--animation` with an installed FFmpeg (or
`FFMPEG_PATH`) for synchronized above/below full-cycle WebM evidence.
See [gear fit evidence](../../review-artifacts/gear-fit/README.md).

### Water and ground materials (issue #66)

See [material surface acceptance](material-surfaces.md) for controlled water,
terrain high/low, sunset and night captures with shader/error checks.

### Cockpit stutter mitigation (issue #101)

For the zero-intensity flood and zero-contribution direct-light optimizations,
start Vite and run the paired GPU/pixel checks in the reusable project browser:

```sh
APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
EXPERIMENT=direct APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
```

The default `floods` experiment toggles the baked-out flood nodes; `direct` keeps
those nodes hidden and compares the BRDF guard independently. Both compare day/
night forward/rear pixels and check missing-bake fallback. GPU timing requires
EXT_disjoint_timer_query_webgl2; visual/fallback checks still run without it.
`ARTIFACT_DIR` changes the `.cache/cockpit-light-performance-<experiment>` output.
See [measurements and limits](../../review-artifacts/cockpit-performance/README.md).

`node scripts/verify-cockpit-stutter.mjs` checks the loaded model's batch count,
control reset/yoke visibility, alternating display redraws, dirty MCP/CDU updates,
and forced refresh during deterministic stepping. Start Vite and open it in Chrome
with CDP on port 9451 (`CDP_PORT` overrides). Set `FALLBACK=1` to block the medium
GLB and test Draco. `ARTIFACT_DIR` overrides the capture directory. See
[results and limitations](../../review-artifacts/issue101/README.md).

### Reused sun shadow map

For the on-demand sun shadow pass, start Vite and run the eight-view sweep in the
reusable project browser. It measures the shipped build against
`sun.shadow.autoUpdate = true` in an A/B/A sandwich, counts how often the map is
rebuilt, compares the whole drawing buffer between levels, and repeats the pair while
the airframe is moving.

```sh
ARTIFACT_DIR=review-artifacts/cockpit-shadow-scope MEASURE_SECONDS=3 \
  APP_URL=http://127.0.0.1:5173/ \
  chrome-session --project flight3d node scripts/verify-cockpit-shadow-scope.mjs
```

`VIEWS` (hours) and `POSES` (forward/right/rear/overhead) narrow the sweep. The harness
parks the wall-clock and step-count driven animators (aircraft strobes, airport beacons,
turbine fans, ocean phase) before it compares anything, because two identical settled
renders otherwise differ by ~2% of pixels; the pixel gates are then measured against a
floor taken from three same-level pairs at the same view. `scripts/probe-shadow-pass.mjs`
and `scripts/probe-frame-movers.mjs` hold the attribution that motivated the change. See
[measurements and limits](../../review-artifacts/cockpit-shadow-scope/README.md).

### Cockpit interior sunlight (issue #90)

`CDP_PORT=9471 node scripts/verify-cockpit-shadows.mjs` stages ten deterministic
cockpit frames across time of day, heading, bank, cloud cover and a sun astern, and
reads back the deck-local sun bearing, spot intensity, light-cookie coverage and
centroid, daylight factor and instrument flood levels for each. An ablation pass
diffs the same frame with the deck sun multiplied out to show which pixels the rig
owns. Start Vite on any free port and open it in Chrome with CDP on 9471
(`CDP_PORT`, `ARTIFACT_DIR` override). See
[mechanism, evidence and limits](cockpit-sunlight.md) and the
[captured frames](../../review-artifacts/issue90/README.md).

### Cockpit interior startup sequencing

`npm run test:cockpit` (`scripts/verify-cockpit-startup.js`, which starts its own
Vite server and Chrome) samples the camera mode and interior load state on every
animation frame from page load. It asserts the first frame is exterior, that no
frame sits in cockpit mode before the interior GLB resolves, and that the demo
cuts into the cockpit afterwards. It then fails both interior assets at the
network layer and asserts cockpit mode falls back to chase with a toast, because
the GLTF interior is the only cockpit geometry. `PORT`, `CDP_PORT`, `ARTIFACT_DIR`
and `FORCE_GPU=0` (SwiftShader) override the defaults. See
[evidence](../../review-artifacts/cockpit-startup/README.md).

### Mouse look and tower zoom (issue #180)

`npm run test:camera-look` (`scripts/verify-camera-look.mjs`) starts its own Vite
server and Chrome on ports claimed from the operating system, freezes physics at
a known pose, and drives real DOM mouse events over the canvas instead of writing
camera state. It asserts that a downward drag lifts the gaze in both chase and
cockpit, that 120 px of cockpit drag stays under 20° of sweep, that the tower
wheel reaches 8x with a fixed eye point, and that the cockpit still caps at 4x.
`PORT`, `CDP_PORT`, `ARTIFACT_DIR` and `FORCE_GPU=0` override the defaults. See
[evidence](../../review-artifacts/issue-180/README.md).

### Airport rendering quality (issue #97)

`node scripts/verify-airport-performance.mjs` compares the pre-#105 revision
on 5198 with #105 on 5197 using a dedicated GPU Chrome on CDP 9497. Use the exact
revisions in the evidence below; current main already contains the optimization.
It samples the native animation loop twice in reversed variant order at device
DPR 1/2 on the noon runway, and captures fixed-pose noon/night visual evidence
for runway, approach and cruise.
See [completed measurements and reproduction](../../review-artifacts/issue97/completed/README.md)
and [preset tradeoffs](../../review-artifacts/issue97/README.md).
`APP_URL`, `BASELINE_URL`, `CDP_PORT`, and `ARTIFACT_DIR` override defaults.
`node scripts/verify-render-quality.mjs` uses the same CDP port to check selection,
saved preferences, three rabbit cycles without program growth, and mobile layout.
It also samples a live night runway loop; point `APP_URL` at current main for
this separate check of the current menu and renderer.
Run it separately from timed benchmarks to avoid disturbing the camera or GPU.

### Aircraft self-shadowing (issue #143)

See [aircraft shadow acceptance](aircraft-shadows.md) for quality-tier GPU
allocation, body/wing/tail/gear self-shadows and exterior/cockpit ground shadows.

### Effect flipbooks (issue #15)

See [effect flipbooks](effect-flipbooks.md) for atlas provenance, resource budgets,
Node lifecycle tests and the Windows/Linux browser comparison harness.

### Aircraft-specific cinematic demos

See [aircraft demos](aircraft-demos.md) for the C172 city/canyon and steep-turn /
wingover routes, menu behavior, physical control laws, and the reusable-browser
acceptance command (`scripts/verify-cessna-demos.mjs`).

### Scenic camera selection

With Vite on port 5193, run
`chrome-session --project flight3d node scripts/verify-scenic-cameras.mjs`.
`APP_URL` and `ARTIFACT_DIR` override the URL and `.cache/scenic-cameras` output.
It verifies real C-key quick cycling, specialist/auto selection from the mobile
settings menu, automatic switching, and the HUD's return to manual viewing.
Native mobile touch checks also cover the HUD auto button's start/pause/resume
cycle, sticky explicit pause, hold/release with a four-second automatic resume,
immediate resume, and cancellation on manual view selection. Camera timers are
advanced explicitly while rendering continues. Screenshots cover all five quick
views, the 390px settings layout and paused/looking/playing states. This is a
fixed-pose browser check, not a full flight or landing acceptance run.

### Startup loading screen

Start Vite on port 5273 (`npm run dev -- --host 127.0.0.1 --port 5273`),
then run `chrome-session --project flight3d node scripts/verify-startup.mjs`
against the project Chrome session. Override `SIM_URL` and `ARTIFACT_DIR` as
needed; screenshots and a stage report default to `/tmp/startup-progress`.
The scenario checks that the loading screen covers scene construction, aircraft
preloading, asset processing and shader preparation; it then verifies real mouse
camera input and the retry screen after a forced WebGL initialization failure.
The bar counts preparation stages, not downloaded bytes or estimated time.

### C172 and F-16 tire contact

With Vite on port 5281, run
`chrome-session --project flight3d node scripts/verify-gear-ground-contact.mjs`.
`APP_URL` and `ARTIFACT_DIR` override the server and `.cache/gear-ground-contact`
output. The check loads both exterior GLBs with an already translated/rotated
root, measures all three tires through unequal compression, release and reset,
and verifies neutral tire bottoms within 5 mm of the world ground plane.
It captures ground-level views of both aircraft. This is bounded geometry and
rendering acceptance; it does not exercise a complete taxi, landing or terrain
slope transition.

### Touch stick precision

See [touch controls](touch-controls.md) for the response curve, release timing,
sequence tests and reusable-browser portrait/landscape acceptance command.
