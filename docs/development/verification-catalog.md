# Per-feature browser verification catalog

This catalog holds bounded browser verification recipes for individual subsystems.
For the default CI gate, hardware GPU flags, and the autonomous demo sweep, see [ci.md](ci.md).
New verification scripts should prefer `withBrowserSession` from `scripts/lib/browserHarness.mjs` so Vite and Chrome start on OS-assigned free ports automatically.

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

For rendering/input evidence, start the Vite server and launch Chromium with CDP on port 9447, then run `node scripts/verify-control-surfaces.mjs`. Output goes to `.cache/control-surfaces/` (override with `ARTIFACT_DIR`).

### Landing gear geometry acceptance

`node scripts/test-gear-retraction.mjs --gpu` renders the loaded airframe and
procedural fallback from above, directly below, the side, and close-up at five gear states.
It checks full cycles, reversal, and main-strut coaxiality through compression
and release, and writes captures/results to `.tmp/gear-retraction`. Add `--animation` with an installed FFmpeg (or `FFMPEG_PATH`) for synchronized above/below full-cycle WebM evidence.

### Water and ground materials (issue #66)

See [material surface acceptance](material-surfaces.md) for controlled water,
terrain high/low, sunset and night captures with shader/error checks.

### Cockpit stutter mitigation (issue #101)

```sh
APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
EXPERIMENT=direct APP_URL=http://127.0.0.1:5173/ chrome-session --project flight3d node scripts/verify-cockpit-light-performance.mjs
```

`node scripts/verify-cockpit-stutter.mjs` checks the loaded model's batch count,
control reset/yoke visibility, alternating display redraws, dirty MCP/CDU updates,
and forced refresh during deterministic stepping (`CDP_PORT=9451`, `FALLBACK=1` for Draco).

### Reused sun shadow map

```sh
ARTIFACT_DIR=.tmp/cockpit-shadow-scope MEASURE_SECONDS=3 \
  APP_URL=http://127.0.0.1:5173/ \
  chrome-session --project flight3d node scripts/verify-cockpit-shadow-scope.mjs
```

`VIEWS` (hours) and `POSES` (forward/right/rear/overhead) narrow the sweep.

### Cockpit interior sunlight (issue #90)

`CDP_PORT=9471 node scripts/verify-cockpit-shadows.mjs` stages ten deterministic
cockpit frames across time of day, heading, bank, cloud cover and a sun astern.
See [mechanism, evidence and limits](cockpit-sunlight.md).

### Cockpit interior startup sequencing

`npm run test:cockpit` (`scripts/verify-cockpit-startup.js`, which starts its own
Vite server and Chrome) samples the camera mode and interior load state on every
animation frame from page load. `PORT`, `CDP_PORT`, `ARTIFACT_DIR` and `FORCE_GPU=0` override defaults.

### Mouse look and tower zoom (issue #180)

`npm run test:camera-look` (`scripts/verify-camera-look.mjs`) starts its own Vite
server and Chrome on OS-assigned ports, freezes physics at a known pose, and drives
real DOM mouse events over the canvas.

### Exterior aircraft close-up (issue #325)

`node scripts/verify-exterior-closeup.mjs` starts Vite and an isolated hardware
Chrome session. On Windows it uses D3D11 and installed Chrome; on Linux expose
the hardware Vulkan device (see [GPU setup](browser-gpu.md)). `CHROME_PATH`,
`GPU_ANGLE` and `ARTIFACT_DIR` override browser/backend/output.
The script checks a WebGL2 shader draw and readback before inspecting B738,
C172 and F16 in chase and drone views. Native wheel and two-finger gestures
verify 0.5–6x bounds, fixed distance/height and double-click reset to 1x.
Screenshots and JSON default to `review-artifacts/issue-325/`.
This freezes physics to inspect framing; it does not establish moving-flight
or physical-device touch acceptance.

### Airport rendering quality (issue #97)

`node scripts/verify-render-quality.mjs` checks quality selection, saved preferences,
three rabbit cycles without program growth, and mobile layout (`APP_URL`, `CDP_PORT`, `ARTIFACT_DIR`).

### Aircraft self-shadowing (issue #143)

See [aircraft shadow acceptance](aircraft-shadows.md) for quality-tier GPU
allocation, body/wing/tail/gear self-shadows and exterior/cockpit ground shadows.

### Effect flipbooks (issue #15)

See [effect flipbooks](effect-flipbooks.md) for atlas provenance, resource budgets,
Node lifecycle tests and the browser comparison harness.

### Aircraft-specific cinematic demos

See [aircraft demos](aircraft-demos.md) for the C172 city/canyon and steep-turn /
wingover routes (`scripts/verify-cessna-demos.mjs`).

### Scenic camera selection

With Vite on port 5193, run `chrome-session --project flight3d node scripts/verify-scenic-cameras.mjs`.

### Startup loading screen & deferred scenery

Start Vite on port 5273, then run `chrome-session --project flight3d node scripts/verify-startup.mjs`.
For production startup timing and deferred scenery (`CHECK_SCENERY=1`), build and preview on port 5291, then run `chrome-session --project flight3d node scripts/verify-startup-performance.mjs`.

### C172 and F-16 tire contact

With Vite on port 5281, run `chrome-session --project flight3d node scripts/verify-gear-ground-contact.mjs`.

### Touch stick precision

See [touch controls](touch-controls.md) for the response curve, release timing,
sequence tests and portrait/landscape acceptance command.

### Pending selection, pause rig and start-through-loading (issue #322)

`FORCE_GPU=1 LOBBY_PORT=5179 node scripts/verify-lobby-flow.js` drives the whole
contract in one session: a menu pick leaves the live scene, the persisted selection
and the held sortie untouched; `Fly` raises the loading card, rebuilds, then hands
over; the toggle and ESC pause into the drone rig with the bus ducked and restore the
pilot's exact view on resume; the menu holds the sortie (frozen, drone-framed, silent)
with no cinematic. It also checks the demo scenario and the 390px bottom sheet.

`node scripts/verify-saved-flight-selection.mjs` reloads three times and asserts that
only a flight actually flown is restored. Both need hardware GPU per
[browser GPU setup](browser-gpu.md); the lobby harness budgets minutes under SwiftShader.
