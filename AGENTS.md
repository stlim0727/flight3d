# Flight3d agent orientation

Flight3d is a browser flight simulator built with Three.js and Vite, using npm
and ES modules. Source and executable configuration take precedence over dated
claims in README.md, ARCHITECTURE.md, or CODE_METRICS.md.

## Start here

Workflow rules that apply to every agent:

1. Create a new git worktree for each task; never edit directly in the shared
   checkout. This keeps concurrent work isolated and preserves unrelated
   in-progress changes.
2. Open a pull request when the work is ready: commit to a focused branch,
   push, and open a PR — unless the user explicitly requests local-only work.
3. Multiple agents may work in this repository at the same time. Inspect git
   status before editing, never assume exclusive access, and leave other
   agents' and the user's edits untouched.

- Read the relevant row in [the task map](docs/development/agent-task-map.md).
- Follow [working rules](docs/development/agent-working-rules.md). Load only
  references relevant to the change; exclude node_modules, dist, browser profiles,
  and worktrees from routine searches.
- Keep this file an orientation index; put detailed procedures under docs/development.

## Commands

Use Node 22.23.2 (`.node-version`; Vite 8 requires at least 22.12.0) and npm from the repository root.

```sh
npm ci
npm run check
npm test
npm run build
```

`check` verifies JavaScript syntax and immutable GitHub action references.
GitHub Actions runs the same checks, tests, and production build. Use a focused
`node --test tests/<name>.test.js` during development; run the complete gate when
changing CI or when no remote CI result is available. Avoid repeated full runs
without a new change or unresolved failure.

Browser scenarios (`test:flight`, `test:crash`, `test:mobile`, `test:demo`) require
separate setup and are not part of the default CI gate. See
[CI and verification](docs/development/ci.md) before running them.
Hardware GPU acceleration is available via Vulkan (`--use-gl=angle --use-angle=vulkan`)
for accounts with `/dev/dri/renderD128` access (`render`/`video` groups), yielding
~8.25x real-time simulation and sub-second screenshot capture. Routine screenshots
are opt-in via `--screenshots` (`npm run test:flight:visual`).

## Simulation changes

- Derive visible behavior from continuous physics state, not behavior-switch
  conditionals; see [modeling principles](docs/development/physics-modeling-principles.md).
- Check coordinate frames, units, force/moment signs, and timestep assumptions in
  ARCHITECTURE.md against current source before changing physics or cameras.
- Keep pure physics behavior testable independently of DOM, WebGL, and audio.
- Test stateful behavior across sequences: hold/release, reset, stage transitions,
  touchdown, and recovery, as relevant. A single frame does not prove stability.
- A production build proves bundling; Node tests prove only the logic exercised.
  Rendering, touch, camera framing, and audio changes need browser evidence.
- Record actual checks and limitations. Do not claim screenshots, deployment,
  browser acceptance, or remote CI success from a build alone.
