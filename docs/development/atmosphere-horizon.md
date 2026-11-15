# Haze and the horizon (#751)

## One haze law

`src/environment/AerialPerspective.js` holds it, as GLSL and as JS mirrors that
`tests/aerialPerspective.test.js` checks against numerical integration.

- Haze density falls with height as `exp(-0.00068 * y)`.
- A sight line accumulates the density integrated along it. Contrast falls as the square
  of that, the FogExp2 form the scene was tuned with.
- `scene.fog.density` is the density at the eye, as before. `SkyAtmosphere.updateSun`
  sets it from the time of day and the camera's altitude.

`installHeightFog()` replaces three's four `fog_*` chunks, so every fogged material
integrates along its own sight line. Stock three fog applies the eye's density to the
whole line, so from altitude the ground stayed clear while the sea, whose shader
integrated, hazed over. The replaced chunks also measure distance from the eye rather
than along the view axis, as the sea does, so fog no longer changes as the camera turns.

The sea mesh (`WaterOcean`) keeps its own shader with the same integral. Both blend the
haze colour in display space, after tone mapping, which is where three's fog chunk puts
it. The sea used to blend before tone mapping and so faded to a greyer colour than the
land beside it.

A custom `ShaderMaterial` with `fog: true` must include the four `fog_*` chunks and define
`mvPosition`; `vFogDepth` no longer exists.
