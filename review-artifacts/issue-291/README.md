# Startup preparation (#291)

Measured 2026-10-29 on Node 22.23.2, production Vite preview, 1280×800,
ANGLE/Vulkan Intel ADL-N. Base: `62fd357` (current main at task start).
Both timed runs disabled HTTP cache and cleared saved preferences, using the
same reusable project Chrome with no concurrent builds/tests. These are local
single-run measurements, not a statistical or network benchmark.

| Metric | main | Change |
| --- | ---: | ---: |
| Overlay removed | 17,131.8 ms | 8,962.9 ms |
| Long-task total before ready | 15,291 ms | 7,559 ms |
| Maximum long task | 7,528 ms | 2,841 ms |
| Prepared aircraft at ready | B738, C172, F16 | B738 |
| Baked lighting / vertex coverage | ready / 100% | ready / 100% |

The overlay is 47.7% faster in this pair and reaches the issue's <10 s local
startup target. The <1 s maximum-long-task target is **not met**. Geometry
assembly, scenery construction, GPU upload and shader work still block frames;
this patch does not claim to remove all startup stalls. The issue's original
31.8 s sample used a different revision and should not be used as the denominator.

The generated UV packs are 834,740 bytes (medium) and 958,689 bytes (Draco).
Their decompressed attributes are ~38.5 / 45.5 MB, replacing the arrays that the
old runtime created from receiver-key lookup. They include procedural framing,
control splitting and static batching, so attributes in the source GLB alone
would not cover the rendered geometry. The transport coefficient binaries and
geometry remain unchanged; only Cockpit.js's async-loading source hash is
refreshed in the existing transport manifests. Tests compare every generated UV
against the original lookup and check source hashes and checksums for both assets.

`npm run check`, `npm test` (829/829), `npm run build` pass. Browser checks:

- Medium production startup: bake ready, 100% coverage, no runtime exceptions.
- Draco fallback with medium GLB blocked: bake ready, 100% coverage, only B738 at
  ready. Its timing in `draco.json` was collected alongside Node tests and is
  correctness evidence, not a fair speed comparison.
- SwiftShader production startup: overlay removed at 39,467 ms, maximum long
  task 13,805 ms, bake ready / 100% coverage and no runtime exceptions
  (`software.json`). The actual renderer identifies SwiftShader; GPU Chrome was
  restored afterward. There is no equivalent baseline software run in this task.
- Saved C172 startup: only C172 at ready (`c172.json`, also alongside Node tests).
- `npm run test:cockpit` through the reusable project Chrome: 190 per-frame
  samples, interior at 8,258 ms, exterior first, no blind cockpit frames, then
  cockpit demo entry. Blocking both interior GLBs redirects to exterior with an
  explanatory toast (`failed-interior.json`). The captured cockpit image was
  inspected for complete geometry and live displays.

Reproduce with the production timing and cockpit commands in
[CI and verification](../../docs/development/ci.md). Reports retain relevant
model/lighting/terrain resource timings. Full local traces remain in `.cache`.

Further work under #291: split the remaining synchronous geometry work, reduce
shader/upload cost on low-end renderers, defer nonselected airport/decor assets,
and evaluate exterior compression. The 83 MB source cockpit is already absent
from tracked main and production output. This PR leaves #291 open.
