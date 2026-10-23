# Airport pavement (issue #8)

The existing implementation (main `184ec96`, pavement introduced in `141937e`)
already supplied six 1K Poly Haven maps, three-metre UVs, rubber and repair
overlays. This follow-up adds the missing sealed-crack decals and lowers the
Lukla apron foundation top by 10cm: its original top was exactly coplanar with
the concrete. Runway geometry, collision, numbers, markings and lights retain
their existing transforms. No flight or terrain heights change.

The two crack overlays per runway use one shared 512×512 RGBA Canvas texture,
original artwork in `Pavement.js`, with transparent margins, filtered mipmaps,
4x anisotropy, roughness 1, metalness 0, negative polygon offset and disabled
depth writes. They stay inside the runway and inherit its slope and heading.
Asset URLs, author, CC0 terms and exact source hashes remain in
[the texture manifest](../../public/textures/pavement/sources.json) and
[texture notes](../../public/textures/pavement/README.md).

## Repeatable comparison

Use Node 22.23.2, `npm ci`, then start Vite on port 5188. Create the empty
same-origin `.cache/pavement-review.html` page (a minimal HTML title suffices).
Start a dedicated Chrome with `--headless=new --remote-debugging-port=9488`
and an isolated `--user-data-dir`. On Windows use `Start-Process -WindowStyle
Hidden`; GPU selection is platform dependent. See [CI notes](ci.md) for Linux
GPU flags. Run:

```sh
node scripts/verify-pavement.mjs
```

`SIM_URL`, `CDP_URL`, and `ARTIFACT_DIR` override those defaults. For before/after,
export the base revision's `Pavement.js`, `Airport.js`, and `LuklaAirport.js` into
`.cache/pavement-baseline/`. In the copied `Airport.js` only, point the
`AirportBuildings.js` import to `/src/environment/AirportBuildings.js`; the
review subclass prevents asynchronous building replacement for both versions.
Set `BASELINE_PREFIX=/.cache/pavement-baseline` and rerun. This produces 16 PNGs
and JSON measurements, with identical camera, light, animation time and 1200×800
resolution in each pair. Actual production airport classes/materials are used.
The coastal views include production terrain; Lukla views isolate the sloped
airport and do not load its DEM.

The script verifies all six map files against recorded SHA-256/size, waits for
the actual maps, checks all shaders and browser errors, and exercises PAPI
below/on/above/below glide slope plus active approach strobes. Node regression
tests check metre UVs, overlay bounds/shared texture/depth settings, runway
dimensions and foundation clearance. Run `node --test tests/pavement.test.js`.

Measurements use 20 warm-up draws then 45 samples with `gl.finish()`, reporting
median/p95 render wall time, draw calls and RGBA8+mipmap texture-memory estimates.
This is a small isolated scene benchmark, including forced GPU synchronization,
not requestAnimationFrame timing or a full-flight FPS claim. Driver allocation,
compression and non-airport texture memory are not inferred from this estimate.

See [recorded images and results](../../review-artifacts/pavement/README.md).

## Runway marking depth

Both airports use `RunwayMarkings.js` for painted stripes and canvas decals.
The beauty shader biases perspective logarithmic depth by 5 cm toward the
camera. This gives paint an explicit separation from the pavement when native
polygon offset does not provide enough depth margin. Geometry, terrain/contact
heights, material lighting and shadow lookup positions stay unchanged. Ordinary
projection and orthographic rendering keep their existing native polygon offset.
Depth testing remains enabled; depth writes remain disabled for the paint.

The 5 cm displacement is in camera space, rather than a constant normalized
depth subtraction that would grow to metres at long viewing distances.

With Vite running on 5261 and an existing GPU Chrome on CDP 9222, run:

```sh
chrome-session node scripts/verify-runway-markings.mjs
```

`SIM_URL`, `CDP_URL`, and `ARTIFACT_DIR` override those defaults. The script opens
and closes its own blank tab and uses the production airport meshes/materials.
It compares the former shader with the explicit bias over eight small camera
movements for each airport, both at normal separation and in a deliberately
coplanar stress case with native polygon offset disabled. A pavement-free
reference masks interior paint coverage; a foreground block checks occlusion.
It also checks nonempty, identical ordinary-perspective and orthographic renders.
Browser/shader errors, empty masks, missing cases and a baseline that does not
fail the stress case cannot pass. See [captures and limitations](../../review-artifacts/runway-markings/README.md).
