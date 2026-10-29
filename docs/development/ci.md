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

`npm test` uses `scripts/lib/compactReporter.mjs` to emit a single-line summary when all suites pass and full stack traces on failure. Run `npm run test:bake` (or `CI=true npm test`) to force the full Draco WASM vertex-by-vertex cockpit bake verification even when SHA-256 source/asset checksums are unchanged.

Actions use full commit SHAs, the token has read-only contents permission, and
checkout does not retain credentials. New runs cancel superseded runs for the
same ref. The optional [PR self-feedback workflow](pr-feedback.md) uses an
OpenAI API key and separate, narrowly scoped comment permissions.

## One-shot agent workflow commands

Use these scripts to avoid multi-turn git/GitHub shell polling:

- `npm run wt:new -- <branch> [path]`: fetches `origin` and creates a fresh worktree from `origin/main`.
- `npm run pr:arc -- [pr]` / `npm run pr:arc -- --resolve <threadId>`: prints PR check status, review decision, and unresolved review threads in one command, or resolves a thread.
- `npm run pr:mac -- [pr]`: verifies CI/merge gates, merges the PR, removes the completed worktree and branch, and fast-forwards the clean shared checkout.

## Browser acceptance

### Hardware GPU acceleration & performance

Hardware GPU acceleration is enabled for user accounts in the `render` (991) and `video` (44) groups with read/write access to `/dev/dri/renderD128`:

- **Headless Chrome GPU Flag**: On headless Linux (Ozone/no X11/no Wayland), use ANGLE with the Vulkan backend:
  ```sh
  --use-gl=angle --use-angle=vulkan
  ```
- **Flight test execution speed**:
  - `npm run test:flight`: Runs all 5 flight scenarios at **~8.25x real-time** (~12–13s real duration for 101s of 120Hz physics).
  - Routine screenshots are opt-in: `npm run test:flight:visual` or `npm run test:flight -- --screenshots`.
  - Failure/anomaly fallback automatically captures a screenshot regardless of flags.
- **Shared browser harness (`scripts/lib/browserHarness.mjs`)**:
  New verification scripts should use `withBrowserSession(options, async ({ evaluate, screenshot, send }) => ...)` which claims free OS ports, starts/stops Vite and headless Chrome (auto-selecting Vulkan vs SwiftShader), and cleans up temporary profiles automatically.

## Autonomous demo acceptance

`npm run test:demo-sweep` claims its own free ports, starts `vite preview` on `dist/` and a private headless Chrome, then drives every route through deterministic 120 Hz physics with `sim.stepSimulation(0.25)` while the wall-clock loop is frozen with `gameFlow.pause()`.

| Command | Runs |
| --- | --- |
| `npm run test:demo-sweep` | the four `core` routes (the PR gate in `demo-sweep.yml`) |
| `npm run test:demo-sweep:full` | every declared route, the nightly and dispatched run |
| `node scripts/demo-sweep.mjs --tier all --only c172-lukla-scenic --shots` | one route with evidence images |
| `node scripts/demo-sweep.mjs --update-baseline --retries 2` | rewrite `scripts/demo-sweep-baseline.json` from the worst of two flights |

Environment knobs: `TIER ONLY SHOTS STRICT RETRIES APP_URL PORT CDP_PORT CHROME_BIN ARTIFACT_DIR DEV_SERVER FORCE_GPU SLICE KEEP_SAMPLES TMPDIR`. Point `TMPDIR` to a short, roomy path (e.g. `TMPDIR=$HOME/.tmp`) if `/tmp` is full or the worktree path exceeds the 107-char Unix socket limit. Rules live in `scripts/lib/abnormalityChecks.mjs` (`tests/demoSweepChecks.test.js`), and routes are derived from `src/director/demoProfiles.js` via `scripts/lib/demoSweepSpec.mjs`.

A green sweep establishes behavior within the implemented model and thresholds, not real-aircraft performance accuracy. In particular, see the [F16 Lukla landing fidelity limits](f16-lukla-realism.md) before interpreting an experimental landing as evidence of real-world feasibility.

## Subsystem & per-issue verification

- Landing damage acceptance (`npm run test:landing`): see [landing-damage.md](landing-damage.md).
- Developer mode (`node scripts/verify-developer-mode.mjs`): see [developer-mode.md](developer-mode.md).
- Lukla DEM contact and circuits (`npm run test:lukla`): see [lukla-physics.md](lukla-physics.md).
- HUD camera (`node scripts/verify-hud-camera.mjs`): see [hud-camera.md](hud-camera.md).
- Individual feature & regression verification commands (`test:cockpit`, `test:camera-look`, shadows, startup, gear contact, etc.): see [verification-catalog.md](verification-catalog.md).
