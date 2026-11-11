# Water and ground surfaces (issue #66)

The 36km ocean mesh has a 200m vertex spacing. Rendering 12–48m waves at those
vertices aliases their shape and interpolated normals into broad glossy patches.
The ocean now displaces only 900m/1600m swell. Shorter waves contribute analytic
fragment normals: 16cm–1.1m wind ripples over gentle 2.4m/5.6m waves. The shader
measures phase derivatives per pixel, including perspective and phase modulation.
Waves blend out between approximately 12 and 3 pixels per cycle; unresolved slope
variance contributes to reflection roughness instead of visible distant patterns. Ship buoyancy samples the
same broad swell. Water uses dielectric Fresnel (F0 0.02), one roughness-aware sun
lobe, and the renderer's tone mapping and output colour conversion. The sun lobe
fades below the horizon. Reflections remain an approximate sky gradient, rather
than reflections of aircraft, terrain or ships; coastal depth/shore foam is not
implemented.

The ocean receives the sun's shadow map on every tier that has one (#648), so an
aircraft skimming the sea casts the same shadow it casts on land: the glint goes
and the lit surface dims to 55%. Fragments outside the sun's shadow box skip the
lookup. ultraLow has no shadow map; its contact-shadow cue lies on the water
surface rather than on the seabed the terrain reports below it.

Terrain uses independently hashed periodic lattice noise instead of correlated
permutation rows. High quality blends offset texture samples using varying tile
weights and explicit gradients; low quality keeps single-sample mapping. Both
use broad world-space colour variation and nonmetallic ground materials. Height,
collision, placement and terrain geometry are unchanged.

## Repeatable browser check

Start Vite on port 5186 and a dedicated browser:

```sh
npm run dev -- --host 127.0.0.1 --port 5186
google-chrome --headless --no-sandbox --use-gl=angle --use-angle=vulkan \
  --remote-debugging-port=9466 --user-data-dir=/tmp/flight3d-material-review about:blank
node scripts/verify-material-surfaces.mjs
```

Override `SIM_URL`, `CDP_URL`, or `ARTIFACT_DIR` when ports/paths are occupied.
The check replaces the page with controlled 1200×800 scenes using production
materials: ocean at 3m, 35m, 250m and 1000m with the same downward viewing angle,
terrain in both quality modes, sunset, and night.
It records shader diagnostics and browser errors, and saves PNGs for inspection.
It fails on browser errors or nonrunnable shader programs. A GPU diagnostic pass
samples the production normal calculation and requires visible horizontal normal
energy at 1000m to be below 20% of the 3m view, while retaining close-up detail. This is bounded material
acceptance, not a full flight, shoreline, mobile device, or frame-rate benchmark.
The rough sky background makes the horizon boundary visible in these test scenes.

To compare a base revision, export its `WaterOcean.js`, `Terrain.js` and
`TerrainTextures.js` into `.cache/material-baseline/`, then run:

```sh
BASELINE_PREFIX=/.cache/material-baseline node scripts/verify-material-surfaces.mjs
```

See [recorded comparisons](../../review-artifacts/material-surfaces/README.md).

[Perspective refinement comparisons](../../review-artifacts/material-surfaces/water-scale/README.md) supersede the original ocean captures.
