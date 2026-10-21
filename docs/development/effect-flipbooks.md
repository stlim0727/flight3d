# Effect flipbooks (#15)

The four original procedural atlases replace the 64px radial textures for
touchdown smoke, fire, dark smoke and water. Each is RGBA8, 256x256, with 16
64px frames. `EffectFlipbook.js` generates them once per system instance.
Sprites share the texture; a per-material uniform selects the UV tile from
age / lifetime, with 0.85–1.15 playback variation and clamping instead of looping.
Rotation and playback variation use a separate deterministic sequence and do
not consume the physics/emission random stream.

## Asset selection and provenance

Selected source: [EffectFlipbook.js](../../src/effects/EffectFlipbook.js),
[repository source URL](https://github.com/yt7good/flight3d/blob/codex/issue-15-effect-flipbooks/src/effects/EffectFlipbook.js).
Creator: Flight3d contributors, authored for issue #15 with coding assistance.
License: [MIT, scoped to this generator and its output](../../public/licenses/effect-atlas-MIT.txt).
Repository inclusion, modification and web/game redistribution are permitted
with that notice. No externally sourced image, video, VDB or paid download is
included. The issue's ActionVFX and Fab suggestions were not acquired: their
individual product licenses are not assumed to permit source redistribution.
This implementation selects reproducible procedural assets instead.

Construction: animated Gaussian lobes, two scales of smooth deterministic
noise, species-specific color/opacity and extra water breakup. No image input
or conversion step. Transparent gutters, nonblack transparent RGB, linear
filtering, no mipmaps and half-texel UV insets prevent adjacent-tile bleeding.
The initial periodic noise prototype was rejected after browser review showed
a repeating grid, and replaced with irregular smooth noise.

## Behavior and resource limits

Fire retains additive blending; water, tire and dark smoke use normal alpha
blending. Existing motion, buoyancy, wind drift, debris gravity, flash lights,
shockwave geometry and main.js crash/reset/audio wiring are unchanged.
`clear()` disposes particle materials and ring geometries but retains reusable
atlases. `dispose()` also releases the system's textures and scene group.

Hard caps: 60 fireballs, 120 smoke puffs, 70 debris particles, 90 water plumes,
200 tire puffs, 16 spin-up emitters and 4 shockwaves. Thus at most 540 sprites
and 4 rings, even under repeated impacts before reset. Sprite growth, lifetime
and single-crash counts are unchanged; this bounds overlap rather than claiming
to eliminate transparent overdraw. Texture budget: 1.1 MiB including the retained
32px spark texture/mip chain; the four atlases themselves are exactly 1 MiB,
plus 1 MiB of retained CPU pixel arrays. No per-particle texture copies/uploads.

## Reproducing validation

Use Node 22.23.2, `npm ci`, `npm run check`, `npm test`, `npm run build`.
Focused regression: `node --test tests/effectFlipbook.test.js`.
Start Vite on port 5185, then run:

```sh
node scripts/verify-effect-flipbooks.mjs
```

The script defaults to installed Windows Chrome or `google-chrome-stable` on
Linux, and SwiftShader. Override `CHROME_PATH`, `SIM_URL`, `CDP_PORT` and
`ARTIFACT_DIR` as needed. For before/after mode, place the two unchanged effect
modules from base commit `31bede9` in `.tmp/effect-baseline/`, then add
`--baseline`. It captures both versions with seed 12345, the same fixed camera,
1200x800 resolution and day/night background colors at 0.6 seconds (3 seconds
for the isolated dark-smoke case). These are isolated effect scenes, not full
airport/flight captures or a physical day/night lighting simulation.

The script checks JavaScript/shader errors, finite timing, draw/particle/texture
budgets and 20 alternating land/water spawn-render-clear cycles. GPU texture,
geometry and shader-program counts must remain constant after warm-up, and
texture count must reach zero after disposal. This detects retained GPU
resources; it is not a heap-profiler proof of absence of every possible leak.

Measured evidence and images: [review artifacts](../../review-artifacts/effect-flipbooks/README.md).
Rendering times are 30 samples of a static pose with `gl.finish()`, including
browser submission overhead; they do not promise whole-simulator 60 FPS.
