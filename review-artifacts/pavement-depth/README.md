# Coastal pavement terrain overlap

Galaxy S24+, Android Brave: user reports checkerboard flicker survives #175 in
Performance mode and is reduced at higher quality. The live bundle includes #175.

Intel GPU / ANGLE Vulkan, low and high terrain quality, 48 total renders:
- Ordinary precision: zero exposed-terrain samples before and after.
- Explicit 12-bit depth stress: 9,050 before, zero after, per quality path,
  across 264,147 interior-runway samples (four camera positions).
- Ordinary-precision positive control (terrain depth testing disabled):
  264,127 before, zero after, per quality. All measured cases color terrain magenta
  independently of quantization; every exclusion case asserts zero exposure.
- Zero browser/shader errors. See `report.json`.

The magenta terrain in every isolated-scene capture is a diagnostic override. Quantized depth and forced terrain draw order deliberately
stress depth competition; they do not simulate a Galaxy GPU. `low-normal-after.png`
is an ordinary-precision diagnostic view. `low-control-before.png` and
`low-control-after.png` show the detector positive control. Paint artifacts under the stress injection are
outside this terrain-coverage assertion.

Reproduction and limits: `docs/development/pavement.md`. Actual S24+ confirmation
is still outstanding; these captures do not prove the native symptom is fixed.

Full application at 412×850 CSS pixels, DPR 2: switched through Performance,
Balanced and High, explicitly rendered each frame before capture, verified all
eight pavement bounds and zero reported shader/browser errors. The Performance
canvas is saved as `application-performance.png`; `application-report.json`
records the quality transitions. This desktop mobile viewport check is not an
Android driver or touch-interaction test.

Validation: syntax/action checks, all 447 Node tests and production build passed.

Review correction: the first report colored terrain only in stress mode, so its
ordinary-precision zero counts were unsupported. This regenerated report uses
magenta in all modes and adds explicit ordinary-precision positive controls.
