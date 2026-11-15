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

## The far sea

No mesh reaches the horizon: the sea mesh is a 17 km disc that follows the camera, the
coastal terrain is 22 km across. `ScreenSky` already rebuilds each pixel's view ray. Where
the ray strikes sea level on a sphere of 6,371 km it draws `oceanFarColor` (in
`WaterOcean.js`), the sea with every ripple unresolved, under the haze that ray has
crossed (`aerialSeaReach`).

The sea mesh blends into those same two functions between 70% and 95% of its half-size,
so the two passes paint identical pixels where the mesh ends and its rim cannot be seen.
Below about 90 m eye height the flat mesh's rim lies past the sphere's horizon and is
itself the horizon.

The haze colour the meshes fade to (`fogColor`) and the sky model's horizon colour are
tuned separately and differ, most of all at sunset. Over the far sea the haze colour
therefore runs from `fogColor` at the mesh rim to the sky's own colour at the horizon, so
the surface joins the mesh at one end and the sky at the other. The sky above the horizon
is drawn unchanged. Low down, where rim and horizon are a fraction of a degree apart, a
faint horizon line remains.

Regions that hide the sea mesh (Lukla, valley) get a flat land colour beyond their
terrain instead, seen through the same haze. It is a backdrop, not terrain. Physics there
is unchanged: Lukla still extrapolates its DEM edge, which #751 tracks.

## Checking a change

Unit tests cover the math and that both passes call the shared functions. Seams are a
rendering property: render fixed poses over open sea (for example x = z = 60 km) at 1, 3
and 10 km altitude and compare adjacent pixels down a screen column with `gl.readPixels`.
A step at the rim's depression angle, `atan(altitude / 17100)`, marks a seam.
