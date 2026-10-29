# Offline cockpit light transfer (#163)

The flight deck uses precomputed diffuse transport instead of the old two-band
ambient multiplier and aperture-controlled flood dimmer. Direct sun keeps the
existing rasterised cookie/shadow pass at the exterior sun's intensity. The 3.2
gain, 3.5 flood reference and 1% artificial spill have been removed.

## Reproduce

Use Node 22.23.2 and `npm ci`, then run `npm run bake:cockpit` from the repository
root. This CPU-only authoring tool uses the shipped Draco decoder and the
development-only `three-mesh-bvh` accelerator. There is no runtime ray tracing
or BVH dependency in the application bundle. `BAKE_SAMPLES` overrides the default
256 deterministic cosine-weighted rays per receiver (minimum 32).

Outputs are `public/lighting/cockpit-{medium,draco}.{json,bin}` plus
`cockpit-{medium,draco}-binding.{json,uvpack}`. The binding pack contains gzip
compressed Float32 UV attributes for the final assembled/batched geometry; its
custom extension prevents HTTP servers from transparently decompressing it before
the application verifies the compressed checksum. `npm run bake:cockpit-binding`
regenerates only the vertex binding from an existing transport bake (no ray tracing).
Use the full bake when geometry, materials or transport inputs change. Each manifest
contains source/asset/data SHA-256 hashes, sampling settings, receiver keys,
flood control receivers and radiosity convergence diagnostics. Source text hashes
normalise CRLF to LF. `tests/cockpitTransfer.test.js` rejects stale inputs,
corrupt data, nonfinite coefficients and radiance amplification. Regenerate both
variants after changing geometry, controls, aperture, materials or the baker.

## Geometry and transport

`Cockpit.prepareModel()` is shared by the authoring tool and the browser: it
applies model alignment, material overrides, side-window shadow proxies, control
splitting, static batching and procedural ceiling/frame geometry. The geometry
loader imports all Draco positions/normals/UVs and PBR material factors without
requiring DOM textures. The current assets have no image textures. Future
textured materials require an albedo-aware extension to the baker.

The optical boundary is the six `APERTURE_OPENINGS`, including #164's fitted
No.3 windows. The closed liners are replaced by their cut proxies for transport;
both must never occlude simultaneously. Glass transmits, while actual posts,
instruments, seats and consoles occlude. This preserves the authored virtual
openings; it does not turn them into measured or visible window geometry.

Receivers cluster vertex positions on an 8 cm grid and normals at 0.5-component
intervals, retaining the first real surface point in each cell. Both sides of
double-sided surfaces receive separate coefficients. For every receiver the
baker traces:

- Cosine-weighted hemisphere directions, which either reach an aperture, hit
  another surface or are absorbed by the closed boundary.
- Unit-output point floods, including cosine, inverse-square falloff, Three's
  finite-range attenuation and line-of-sight occlusion.
- 26 parallel sun directions: six azimuths at elevations -60°, -20°, 20°, 60°,
  plus both poles. The full sphere handles banking/inverted aircraft where a
  world-above-horizon sun lies below the deck. Sun visibility uses the same
  apertures and deck occluders.

The sampled surface links form a sparse transport matrix. For each source
column, incident diffuse energy solves `H = D + F R H`. Linear-luminance diffuse
albedo is multiplied by `(1 - metalness)` and capped at 0.9, making the sampled
passive system contractive. Iteration stops at maximum absolute residual below
`1e-5`; failure to converge is an error. This is scalar diffuse radiosity, not
spectrally accurate colour bleeding or glossy transport.

The binary stores total uniform-sky transfer, total transfer from each of the
three floods, and sun **bounce only**. Direct sun is subtracted from the sun
columns to prevent double counting with rasterised illumination. Direct sun at
instrument control receivers is retained in the manifest for flood control.

## Runtime and automatic floods

Transport metadata, coefficients and vertex bindings fetch alongside the GLB.
After GLB assembly, precomputed UVs are attached as vertex attributes; the browser
does not reconstruct receiver keys or perform per-vertex Map lookups. Binding
layout, finite UVs, asset/transport identity and compressed checksum are validated
before installation. Tests compare every UV against the original receiver lookup
for both variants and reject stale source hashes.
The material samples a small float texture twice per vertex (front and back),
then interpolates irradiance over each triangle. Binding happens after batching,
in the neutral control pose. Coverage below 98% fails explicitly instead of
silently applying an unrelated bake. The binary SHA-256 is verified at load. The original `bind()` remains an offline
authoring/reference path; a missing or invalid binding uses the documented fixed
flood fallback rather than repeating the expensive lookup in the browser.

`Cockpit.syncLighting()` receives actual sky ambient colour/intensity, actual
weather-attenuated sun colour/intensity and aircraft-local sun direction.
Three's `AmbientLight` is irradiance, so uniform external radiance is its value
divided by pi. Point/sun coefficients already include the Lambertian `1/pi`.
The shader converts the combined result back to irradiance before Three's PBR
indirect-light evaluation, retaining metalness, specular energy allocation,
AO maps and emissive output. Outdoor diffuse IBL is excluded from the deck;
environment reflections use the receiver's baked uniform-sky accessibility
instead of the old global 0.25/0.35 multipliers. This is a hemispherical rough
reflection approximation, not directional glossy transfer; it prevents an
unoccluded outdoor HDR environment from lighting the closed ceiling at night.

Sun bounce uses a continuous nonnegative partition of unity over the 26 baked
directions. This smooths angular detail; the high-frequency direct shadow still
comes from the live raster pass. The present uniform ambient has one sky basis
column and is invariant under aircraft rotation. A directional sky model would
need more baked sky columns rather than a world-normal brightness band.

Flood auto-control has an explicit target: match the installed floods' unlit
instrument-receiver illumination baseline with the least squared deficit.
Bounded coordinate descent solves the three source outputs against the received
sky and direct/bounced sun. Outputs stay in `[0, installed intensity]`, can reach
zero and approach their solution with a 0.3 s time constant. There is no common
0.06 floor or dependence on total aperture area. The live PointLights are zeroed
when the bake is active: their visibility and diffuse transport are already in
the bake, including dome-light occlusion.

Input changes below 0.001 precision share cached transport evaluation; after
floods settle, unchanged frames do not upload the texture. Exterior/photo views
skip updates. If files are missing, malformed or incompatible, the cockpit
remains usable with fixed installed night floods and zero diffuse sky fill,
logs a warning and exposes `lightingBakeStatus = 'fallback'`. This degraded
mode is not advertised as a valid bake.

## Verification and limitations

Run `npm run check`, `npm test` and `npm run build`. Tests cover an analytical
two-patch repeated-bounce solution, closed/empty/invalid transport, passive
uniform-sky bounds, continuous sun interpolation, bounded flood deficit solving,
night/day/recovery sequences, upload caching, source hashes and failed loading.

Start Vite, open `/scripts/verify-cockpit-transfer.html`, wait for the interior
to load and click **Run acceptance**. It compares the previous shader/flood/sun
gain against the bake on the same loaded geometry, stages the six shadow-demo
directions, overcast, night, overhead views at 20°/75° elevation and ±35° bank,
checks GPU errors and control release, and reports coverage and CPU update cost.
Both staged night and cloud attenuation are asserted so a still-active demo
cannot silently overwrite those inputs. Use the variant selector to exercise
the lite asset independently. Inspect the images, not only the PASS label.

Evidence and measured acceptance results live in
`review-artifacts/cockpit-transfer/README.md`.

The bake is an authoring approximation. Animated controls and yoke visibility
keep their live direct shadows, but their diffuse occlusion/bounce stays at the
neutral, visible-yoke state. Receiver clustering, low angular resolution and
vertex interpolation limit detail, especially on large triangles. The aperture
remains fitted rather than certified airframe geometry. Specular transport and
screen emission lighting other surfaces are not solved by this diffuse bake.
These limitations must remain visible when judging or extending the result.
