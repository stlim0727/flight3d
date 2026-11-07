# Code audit #531

Reviewed against `origin/main` at `41343fc`.

- Removed the unreferenced EventBus module, slalom leg calculator, departure
  caption formatter, sensor version constant, unused imports, and the four
  reported unused CSS classes. Updated the task map's diagnostics entry.
- Kept the listed internally used functions/constants, but removed their unused
  exports. They still implement their existing runtime behavior.
- Shared the five Mulberry32 implementations through `src/core/random.js`.
  Stream compatibility tests compare against the original scenery generator
  across unsigned wraparound, including negative and maximum uint32 seeds.
- Retained local clamp helpers. The cockpit helper sanitizes non-finite inputs
  and has a fallback argument; it is not interchangeable with a simple clamp.
  Pilot examples execute as self-contained guest source. Small pure physics
  helpers do not need a Three.js dependency merely for clamping.
- Retained local degree/radian constants: replacing them throughout physics and
  guest examples adds dependencies and churn without removing an unused API.
- Retained the portrait FOV formulas in the render and resize paths. Both are
  live behavior; extracting them is a separate camera refactor requiring browser
  framing verification, rather than a dead-code fix.
- Retained `scripts/verify-physics-core.cjs`: it is explicitly documented in
  `physics-core-verification.md` as a historical #185 baseline comparison. Its
  historical commit is intentional; absence from CI is not proof it is obsolete.

This cleanup changes no intended flight, rendering, input, or audio behavior.
Node checks and production bundling do not constitute browser acceptance evidence.
