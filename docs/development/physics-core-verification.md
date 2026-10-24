# Task 1-1 verification (2026-10-24)

Baseline: `37f76adf644c6120ddbbd6e127ab7f56cc4c8b44`.
The work preserves the current main's existing integrator scratch buffers,
engine-out torque, fuel burn, continuous stall model and ground-contact logic.

## Automated gate

Node 22.23.2: check passed (184 JavaScript files at that run, 11 pinned action
references), 467 tests passed, production build passed. Build still reports
the large-bundle advisory. No aerodynamic coefficients or integration formulas
were changed.

## Browser comparison

Windows Chrome headless, 1280 x 720. The browser harness serves the three
modified pre-existing modules from the baseline commit for the reference run;
all other assets and modules come from the same checkout. The updated run
uses the normal Vite modules. Automatic RAF is disabled during deterministic
stepping; real WebGL rendering is tested separately.

The seeded runs initialize Math.random identically in both contexts and warm up
10 simulated seconds before heap sampling. It then runs runway, cruise,
approach, runway-reset (12 seconds each), plus a forced runway touchdown
(8 seconds). All 56 once-per-second snapshots match exactly, covering 6,720
physics steps. This compares sampled states, not a recording of every tick.
The touchdown is on-ground at all eight sampled times. Quaternion norms and
finite state checks pass; reset clears the accumulator. Neither context
reports a page exception or WebGL error.

The render check resumes cruise, selects chase view and drives 120 real
browser animation callbacks through animate(); frame statistics exclude the
first 61 callbacks. Captured images were inspected separately.

| First seeded run | Baseline | Updated |
| --- | ---: | ---: |
| p95 one-second simulation batch (120 steps plus displays), ms | 61.5 | 40.3 |
| p99 simulation batch, ms | 79.8 | 44.3 |
| CDP sampled allocation bytes, all sampled stacks | 476,119,284 | 334,747,444 |
| p95 displayed frame interval, ms | 69.6 | 39.9 |
| p99 displayed frame interval, ms | 78.7 | 52.4 |

Repeating the committed verifier also passed all state comparisons and browser
checks, but produced the following timings and allocation samples:

| Seeded repeat | Baseline | Updated |
| --- | ---: | ---: |
| p95 simulation batch, ms | 83.5 | 89.1 |
| p99 simulation batch, ms | 94.7 | 104.4 |
| CDP sampled allocation bytes | 508,660,584 | 499,235,204 |
| p95 displayed frame interval, ms | 98.8 | 89.4 |
| p99 displayed frame interval, ms | 158.5 | 99.4 |

These are diagnostic samples, not a performance guarantee. Two earlier
unseeded short runs showed mixed results, including higher allocations and
worse frame tails for the updated run. Scene randomization, compilation,
profiling overhead, run order and background work affect these measurements.
The seeded runs are also baseline-first, not a randomized repeated benchmark.
They cannot establish that these percentage changes were caused by this patch.
The directly established allocation reduction is two vectors and one output
object per live aerodynamic call. GC pause durations/frequency, mobile,
Lukla full circuits and the complete demo/crash acceptance suites were not
measured here. Full-loop zero allocation and universal FPS improvement are
not claimed.

## Reproduce

Run Vite on port 5185 from the repository root. Provide Playwright separately
(the verifier does not add it to runtime dependencies), either resolvable as
`playwright` or through `PLAYWRIGHT_MODULE`, an absolute module path.
Then run:

```sh
node scripts/verify-physics-core.cjs
```

Chrome's installed channel is used by default; `CHROME_PATH` can specify an
executable. `SIM_URL` and `ARTIFACT_DIR` override the server and output paths.
The baseline commit must be available locally. Output defaults to
`.tmp/issue185`: sampled state/metric JSON, heap samples and both screenshots.
Keep the same browser, viewport and environment for comparisons.
