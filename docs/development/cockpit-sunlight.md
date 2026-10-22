# Cockpit interior sunlight (#90)

Sunlight that enters the windshield lights the flight deck and casts the window
frame, pillar and roof bands across the glareshield, panel face, yokes, seats and
pedestal. The pattern follows the sun's bearing **in the deck frame**, so time of
day, heading, attitude and cloud cover all move it, and it disappears at night.

`CockpitSunShadow` owns one `SpotLight` aimed down the sun vector through the
windshield aperture. It is a localized light, deliberately: a second
`DirectionalLight` with a tight shadow frustum would add unshadowed sun to the
whole scene, because three treats fragments outside a shadow frustum as fully
lit. A spot contributes nothing outside its cone, so the deck is the only thing
this light touches. `decay = 0` removes the inverse-square falloff that three
applies even with `distance = 0`, which lets a light 40 m up the beam behave as
parallel sunlight.

## Aperture, cookie and slab

The shipped cockpit skin is a closed low-poly tube: it has no windshield cutouts,
so real geometry cannot mask the aperture and would throw a solid shadow instead.
`CockpitSunShadow` therefore paints a 256² light cookie (`SpotLight.map`) from the
`WINDSHIELD_PANES` quads in `src/aircraft/CockpitAperture.js`, projected along the
sun into the light's own shadow space. The cookie is recomputed only when the
deck-local sun vector turns by more than 0.008 rad, and the shadow image is kept
body-fixed by setting `shadow.camera.up` from the deck frame, avoiding an extra image roll relative to the deck. Interior meshes still cast
into the map at about 5 mm/texel, which
is what puts the pillar and roof edges on the panel.

The shadow slab reaches 2.2 m sunward of the deck anchor, including both full
window frames and the side consoles. Closed exterior shadow proxies opt out of
this light's pass via paired `onBeforeShadow`/`onAfterShadow` hooks: their draw
range is empty only for the tagged deck shadow camera, then restored for the
main sun. No single near plane can both reject the closed skin and retain all
pillars from every sun bearing.

The depth image is cached while the deck-local sun and controls are steady.
Yoke visibility/deflection, throttles, pedals and model readiness invalidate it.
Pending invalidation survives multiple simulation substeps before a render;
the world-to-shadow matrix still follows the aircraft when the image is frozen.

The deck's PBR materials use reduced, directional sky fill instead of receiving
the full outdoor ambient and HDR environment. The localized sun gain is 1.6;
other surfaces are outside its cone. Instrument floods dim to 8% in full sun,
with a 0.06 floor. Front-to-aft sunlight puts the yoke's cast shadow behind the
pilot; AO makes its contact with nearby surfaces readable even when that cast
shadow is out of view.

`CockpitOcclusion` adds half-resolution, 16-sample SSAO in balanced quality
(three-quarter resolution in high, capped at 960 px wide). It renders only opaque
cockpit geometry with an 8 m AO depth range. A depth mask protects the exterior,
and unlit instrument surfaces are redrawn after the multiply composite. Glass
is excluded. Performance quality and exterior/photo views skip AO entirely;
render targets are allocated only on the first eligible cockpit render.
The SSAO and depth-display shader ranges track that 8 m camera on every render,
including near-plane changes; metre-based rejection bounds use the same range.
AO darkening is capped at 25% so it cannot wash out the cast-sunlight bands.
This is contact/crease shading, not a replacement for directional cast shadows.

`SkyAtmosphere` owns the weather gate: `setCloudCover(0..1)` attenuates direct sun
continuously, softens both shadow maps, lifts ambient skylight and greys the fog.
The same factor reaches the deck sun, so an overcast noon washes the pattern out
instead of switching it off. `Cockpit.syncDaylight` trades the three instrument
floods against the light the deck actually admits, with a floor so the night look
survives. `main.js` drives both from `stepSimulation` and `animate`, gated by the
cockpit camera mode, which ramps over ~0.3 s rather than switching.

## Known limits

- A high sun barely enters: at 12:30 the sun is 64° up and the facing term falls to
  0.35, so the deck keeps most of its flood lighting. That is the windshield doing its
  job, but it means noon is the weakest frame for this feature.
- The instrument floods follow the *admitted* sun, not general skylight, so a bright
  overcast day leaves them brighter than a clear one.
- Exterior airframe self-shadow (fuselage onto wing, tail onto tailplane, gear onto
  fuselage) is not part of this change; it needs main-sun frustum and texel tuning,
  tracked separately.
- The mechanism is model-agnostic; the numbers are not. `computeDeckSunPose()` and
  `projectPanesForCookie()` accept panes, anchor, standoff and clip distance as parameters,
  but `CockpitSunShadow` calls them with the `CockpitAperture.js` defaults, which are
  measured from the shipped 737 GLBs. Another cockpit needs its own aperture profile — by
  swapping that module, or by threading a per-instance profile into `update()` and
  `repaintCookie()`. A model whose skin has real windshield openings can drop the
  cookie and exterior-proxy exclusion, which only exist because this one does not.

## Reproduce visual evidence

Use Node 22.23.2. Start Vite on any free port, then a dedicated Chrome on that page:

```sh
npm run dev -- --host 127.0.0.1 --port 5196 --strictPort
```

```sh
google-chrome-stable --headless=new \
  --user-data-dir=/tmp/flight3d-deck-sun \
  --remote-debugging-port=9471 --window-size=1280,720 \
  --use-gl=angle --use-angle=vulkan --no-first-run \
  http://127.0.0.1:5196/
```

Then run `CDP_PORT=9471 node scripts/verify-cockpit-shadows.mjs`. It reloads the page
so the frames come from the source on disk, waits for the interior GLB, pauses the
animation loop, enters the 3D cockpit, and stages ten deterministic frames
(07:00/12:30/16:48/21:00, sun abeam left and right, ±35° bank, 0.8 cloud cover, sun
astern), reporting the deck-local sun bearing, spot intensity, cookie coverage and
centroid, daylight factor, flood intensities and a centre-patch luma histogram for
each. Screenshots and `deck-sun-report.json` land in `review-artifacts/issue90/`.

The ablation stage renders the same frame with the deck sun multiplied out and
diffs it, restricted to pixels that repeat-render stable. Before the contrast/AO update, on this machine (Intel
Graphics ADL-N through ANGLE Vulkan) it moves 6.1% of the frame, with the centroid
at 64%/72% of the width and height, i.e. on the deck:

| Region | Mean luma delta | Pixels moved | Peak delta |
| --- | ---: | ---: | ---: |
| World outside the windshield | 0.10 | 0.0% | 1.0 |
| Glareshield top | 2.37 | 16.0% | 19.9 |
| Panel face | 1.32 | 7.0% | 22.1 |
| Pedestal | 4.43 | 26.5% | 19.9 |

Cookie centroids mirror across the deck as expected: sun abeam left 0.461/0.483,
abeam right 0.536/0.509; bank left 0.486/0.462, bank right 0.483/0.519.

Historical frame cost before the contrast/AO update on the same integrated GPU, cockpit view, frozen shadow map versus
forcing a repaint every frame: 122.8 ms versus 199.8 ms per frame. These are
contended headless measurements, not frame-rate claims; they only establish that
freezing the map is the cheaper of the two and that the rig does not force a
repaint while the deck-local sun is steady.

Node tests cover the rig invariants, the slab against windshield corners and deck
receivers, facing continuity through a 1° azimuth sweep, cookie projection bounds,
the body-fixed shadow image, repaint-only-on-movement, the cloud gate, and the
flood/daylight trade. Required checks are `npm run check`, `npm test` and
`npm run build`.
