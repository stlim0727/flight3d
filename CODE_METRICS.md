# Code Metrics & Conventions

Module routing and active file boundaries live in [the agent task map](docs/development/agent-task-map.md).
Coordinate conventions, 120 Hz fixed-step physics invariants, and render pose interpolation are documented in [ARCHITECTURE.md](ARCHITECTURE.md) and [physics modeling principles](docs/development/physics-modeling-principles.md).

## Core Invariants

1. **Deterministic 120 Hz Physics (`dt = 1 / 120` s)**:
   - Never integrate position, velocity, or orientation directly with variable `requestAnimationFrame` deltas.
   - Pure physics modules (`src/physics/*`, `src/core/physicsTiming.js`) must remain testable in Node.js without DOM or WebGL globals.
2. **Continuous State Modeling**:
   - Derive visible motion, warnings, and audio from continuous physical state (`Aerodynamics`, `LandingGear`, `MassProperties`, `EngineModel`) rather than discrete mode switches.
3. **Agent Token & Search Hygiene**:
   - Keep modules cohesive and scoped; update [docs/development/agent-task-map.md](docs/development/agent-task-map.md) when splitting or adding entry points.
   - Store transient verification captures in ignored directories (`.tmp/`, `.cache/`, `review-artifacts/`) rather than committing binary screenshots to git.
