# Haze and the horizon (#751)

No mesh reaches the horizon: the sea mesh is 36 km across and follows the camera, the
coastal terrain is 22 km. Their edges used to be hidden by fades painted at fixed world
or mesh coordinates, which showed as squares from altitude. The edges are now covered by
one haze law and a sea drawn analytically out to the horizon.

## One haze law

`src/environment/AerialPerspective.js` holds it, as GLSL and as JS mirrors that
`tests/aerialPerspective.test.js` checks against numerical integration.

- Haze density falls with height as `exp(-0.00068 * y)`.
- A sight line accumulates a *reach*: density integrated along it. Contrast falls as
  `exp(-reach^2)`, the FogExp2 form the scene was tuned with.
- `SkyAtmosphere.visibilityM` (default 10 km, `setVisibility(metres)`) scales sea-level
  density. The time-of-day densities in `updateSun` are tuned at the default and scale
  with it. Visibility is the distance at which contrast is 2%.

Three consumers evaluate it:

| Consumer | Geometry | Where |
|---|---|---|
| Every fogged material | flat earth, eye to fragment | `installHeightFog()` replaces three's `fog_*` chunks |
| Sea mesh | flat earth, eye to fragment | `WaterOcean` fragment shader |
| Far sea, far land, sky in fog | sphere of 6,371 km | `ScreenSky` fragment shader |

All three blend the haze colour in display space, after tone mapping, which is where
three's fog chunk puts it. The sea mesh used to blend before tone mapping and so faded to
a greyer colour than the land beside it.

`scene.fog.density` is still the density at the eye. Stock three fog applies that one
value to the whole sight line, so from altitude the ground stayed clear while the sea,
which integrated, hazed over. The replaced chunks integrate, and measure distance radially
rather than along the view axis, so fog no longer changes as the camera turns.

A custom `ShaderMaterial` with `fog: true` must include the four `fog_*` chunks and define
`mvPosition`; `vFogDepth` no longer exists.

## The far sea

`ScreenSky` already rebuilds each pixel's view ray. Where the ray strikes sea level on
the sphere it draws `oceanFarColor` (in `WaterOcean.js`), the sea with every ripple
unresolved, under the haze that ray has crossed (`aerialSeaReach`).

The sea mesh blends into those same two functions between 70% and 95% of its half-size,
measured radially, so the two passes paint identical pixels where the mesh ends and its
square outline cannot be seen in any weather. Below about 90 m eye height the flat mesh's
rim lies past the sphere's horizon and is itself the horizon.

The haze colour the meshes fade to (`fogColor`) and the sky model's horizon colour are
tuned separately and differ, most of all at sunset. Over the far sea the haze colour
therefore runs from `fogColor` at the mesh's farthest corner to the sky's own colour at the horizon,
so the surface joins the mesh at one end and the sky at the other. In clear air the haze
is thin there and the horizon stays a line, as it should.

## The sky

The sky model already depicts the atmosphere the scene is tuned for, so at the default
visibility it is drawn unchanged. Only haze thicker than the tuned density veils it
(`uSkyHazeDensity`, with `aerialSkyReach`): lowering visibility closes fog over the low
sky first and the zenith last, and climbing out of the fog clears it.

Regions that hide the sea mesh (Lukla, valley) get a flat land colour beyond their
terrain instead, seen through the same haze. It is a backdrop, not terrain. Physics there
is unchanged: Lukla still extrapolates its DEM edge, which #751 tracks.

## Checking a change

Unit tests cover the math and that both passes call the shared functions. Seams are a
rendering property: render fixed poses over open sea (for example x = z = 60 km) at 1,
3 and 10 km altitude, on an axis and a diagonal heading, at 10 km and 50 km visibility,
and compare adjacent pixels down a screen column with `gl.readPixels`. A step larger than
the sky gradient's marks a seam. `scripts/capture-fog-matrix.js` captures the time-of-day
by altitude matrix on the Linux GPU host.
