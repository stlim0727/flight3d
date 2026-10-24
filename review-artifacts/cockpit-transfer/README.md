# Cockpit offline transfer acceptance (#163)

Run with Node 22.23.2, Vite on localhost:5393 and the Codex in-app Chromium
browser on Windows. The medium and lite bakes use 256 deterministic rays per
receiver and 26 sun directions. The generated manifests contain input/data
hashes and radiosity residuals. Their source-hash regressions pass on the
current checkout.

## Checks

- `npm run check`: 191 JavaScript files; 11 immutable action references.
- `npm test`: 499 passed, zero failures/skips after integrating main `cfc5348`.
- `npm run build`: passed. Vite retains its large-bundle warning.
- Both variants pass the 12-case GPU harness, including actual night/overcast
  inputs, fixed ±35° poses and yoke hold/reverse/release. No WebGL or console
  errors were observed. These are bounded rendering checks, not full-flight,
  mobile-performance or deployment acceptance.

The harness is `/scripts/verify-cockpit-transfer.html`. Choose **Asset**, wait
for loading, then click **Run acceptance**. Case indices 0–5 are the six shadow
demo directions; 6 is overcast, 7 night, 8/9 look up at the ceiling with frontal
sun at 20°/75°, and 10/11 bank the aircraft ±35° beneath a fixed world sun.
Physics is frozen for these comparisons.

The `before` ablation restores the previous shader, 3.2 beam gain, 1% cookie
spill, 0.25 environment scale and original three-flood dimmer on the same scene.
The `baked` render uses the offline transport. The screenshots preserve the
actual loaded geometry and do not add replacement panels or shadow geometry.

## Evidence

- [Medium measurements](medium-report.json)
- [Lite measurements](lite-report.json)
- [High sun, deck before](medium-case-4-before.png) / [baked](medium-case-4-baked.png)
- [Overhead, 20° before](medium-case-8-before.png) / [baked](medium-case-8-baked.png)
- [Overhead, 75° before](medium-case-9-before.png) / [baked](medium-case-9-baked.png)
- [Night, baked](medium-case-7-baked.png)
- [Lite overhead, 75° baked](lite-overhead-75-baked.png)

The reports measure display-space mean luma and saturated pixels over a fixed
screen region (x=15–90%, y=45–100%). This includes whatever surfaces/outside view
the chosen camera sees; it is not a surface-isolated overhead-panel photometric
measurement. Changes in exposure and material response prevent interpreting
these values as physical irradiance. Coverage is 99.96% for medium and 99.98%
for lite. Texture-update timings are CPU-only microbenchmarks, not frame rates.

## Remaining approximations

The bake uses fitted virtual apertures, scalar diffuse albedo, clustered vertex
receivers and neutral controls. Large ceiling triangles can show coarse,
patchy interpolation; these captures deliberately retain that visible limit.
The environment-reflection accessibility factor is hemispherical and cannot
replace directional glossy transport. Controls retain live direct shadows but
do not dynamically rebake diffuse occlusion. See
[implementation and regeneration](../../docs/development/cockpit-light-transfer.md)
for the units, source model, failure fallback and full limitations.
