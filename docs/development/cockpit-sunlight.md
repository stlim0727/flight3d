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
the full outdoor ambient and HDR environment. The localized sun gain is 3.2;
other surfaces are outside its cone. Instrument floods dim to 8% in full sun,
with a 0.06 floor. Front-to-aft sunlight puts the yoke's cast shadow behind the
pilot; AO makes its contact with nearby surfaces readable even when that cast
shadow is out of view.

`CockpitOcclusion` adds half-resolution, 16-sample SSAO in balanced quality
(three-quarter resolution in high, capped at 960 px wide). It renders only opaque
cockpit geometry with an 8 m AO depth range. A depth mask protects the exterior,
and unlit instrument surfaces are redrawn after the multiply composite. Glass
is excluded. Its thin tint overlay is unlit, so increasing deck sunlight does not
add an opaque diffuse veil over the exterior. Performance quality and exterior/photo views skip AO entirely;
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

## Direct admittance

`directAdmittance()` in `CockpitAperture.js` is the aperture area projected normal to the
sun, `Σ max(0, n̂·sun)·A`, in square metres — the parallel-beam flux an opening admits.
`referenceDirectAdmittance()` scans the upper hemisphere for the bearing that admits the
most, and the deck sun is scaled by the ratio, so `1.0` means "this aperture at its best"
and editing the profile cannot silently rescale the rig.

It replaced a single dot product against the deck→pane-centre direction, which discarded
`pane.rotation` and `pane.size` and depended on where the anchor happened to sit relative
to each pane. That read a high sun as almost not admitted (0.32 against 1.0 for a morning
sun), which left the instrument floods near full brightness at noon and washed the shaded
overhead panel out — the deck sun is the only thing that dims them. Admittance is also
computed in the deck frame, so aircraft attitude no longer enters the term at all.

The swap does not by itself make the noon deck read as intended, and the honest before/after
is in `review-artifacts/cockpit-aperture/`: the noon frame is near-unchanged in mean luma
while the *off-axis* frames got brighter. Lowering an over-reported `facing` of ~1.0 to a
measured admittance drops `daylight`, and `syncDaylight` then leaves the floods closer to
full than they were. Those bearings genuinely admit less direct sun than the heuristic
claimed, because the profile has no openings aft of the windshield; over-brightening there is
the measurement being right about an incomplete profile, not a reason to re-add a curve.

## Known limits

- The aperture profile is authored, not measured. No GLB in this repository carries a
  windshield mesh (`b737-cockpit-medium.glb`, `b737-cockpit-draco.glb` and `b737-800.glb`
  contain no node, mesh or material named for glass), so `WINDSHIELD_PANES` is a hand-built
  approximation that the interior framing and the light cookie both draw from. It is now
  self-consistent — the front glass leans back over the nose, as on a real 737 — but the
  angle has not been checked against airframe data.
- The profile is a forward fan: all four pane normals have a negative (forward) Z component,
  so nothing aft of about 135° off the nose is admitted at all. Measured admittance as a
  fraction of `referenceDirectAdmittance()`, by bearing off the nose:

  | elevation | 0° | 45° | 90° | 135° | 180° |
  | --- | --- | --- | --- | --- | --- |
  | 20° | 1.00 | 0.85 | 0.44 | 0.10 | 0.00 |
  | 40° | 0.91 | 0.80 | 0.45 | 0.08 | 0.00 |

  A real 737 deck admits an afternoon sun through the No.3 and No.4 side windows, which this
  profile does not have. Adding them is [issue #164](https://github.com/stlim0727/flight3d/issues/164);
  it cannot be done by editing the list alone, because `Cockpit.js` renders one tint quad per
  pane and the cookie paints one light band per pane, and the shipped skin has no opening for
  either. Measured from the loaded scene, that is the smaller half of the problem: every mesh
  in `gltfCockpitGroup` lies within |x| ≤ 1.0 m of the centreline, so the interior has no
  side-window geometry at all. Completing the aperture is an asset change before it is a
  lighting one, and until then the forward fan is faithful to what the model contains.
- Diffuse skylight is not modelled through the aperture. The deck's indirect fill is a
  fixed two-band scaling of the outdoor ambient, so it has the right *shape* (upward faces
  brighter) but its coupling to the actual glass area is a constant. Integrating the sky
  view factor per receiver is the first thing an offline bake would give us.
- The instrument floods follow the *admitted* sun, not general skylight, so a bright
  overcast day leaves them brighter than a clear one.
- Exterior airframe self-shadow (fuselage onto wing, tail onto tailplane, gear onto
  fuselage) is not part of this change; it needs main-sun frustum and texel tuning,
  tracked separately.
- The mechanism is model-agnostic; the numbers are not. `computeDeckSunPose()` and
  `projectPanesForCookie()` accept panes, anchor, standoff and clip distance as parameters,
  but `CockpitSunShadow` calls them with the `CockpitAperture.js` defaults. Another cockpit
  needs its own aperture profile — by swapping that module, or by threading a per-instance
  profile into `update()` and `repaintCookie()`. A model whose skin has real windshield
  openings can drop the cookie and exterior-proxy exclusion, which only exist because this
  one does not.

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
receivers, admittance continuity through a 1° azimuth sweep, cookie projection bounds,
the body-fixed shadow image, repaint-only-on-movement, the cloud gate, and the
flood/daylight trade. Required checks are `npm run check`, `npm test` and
`npm run build`.


## Projection depth with logarithmic exterior rendering

The beauty renderer uses logarithmic depth for the 45 km scene. Perspective
spot-shadow lookups and SSAO, however, reconstruct ordinary projection depth.
`CockpitDepth` removes the logarithmic fragment-depth write from the actual
renderer-selected aircraft shadow depth variants and the AO normal material.
It preserves shader customizations and the renderer's alpha/clipping/displacement
variants, and registers asynchronously loaded or rebuilt aircraft meshes before
rendering. Point-light distance materials keep their radial encoding. The
exterior beauty depth remains logarithmic.

At a receiver 40 m from the spot, near/far 37.8/45.2 m, regular projection depth
is approximately 0.336 whereas logarithmic depth is approximately 0.969. Mixing
these encodings falsely marks pillar-shadowed receivers as lit. Increasing map
resolution does not fix this. The acceptance ablation now removes frame geometry
only from the tagged cockpit sun pass; the external directional shadow remains
unchanged, so it cannot hide this regression.

Clear sunlight gain is 3.2 to emphasize lit/shaded separation, with cookie
leak reduced to 1% to retain the previous outside-aperture light budget; daylight/flood
normalization remains unchanged. The native 737 glareshield shades much of the
vertical instrument panel. Pillar bands are clearest on the left sidewall and
lower console at 16:48, heading 000 degrees, clear weather; this model does not
put the same pattern on the panel as a fighter canopy. Screenshots capture the
actual model and its cast shadows without adding substitute shadow geometry.


## Interactive shadow scenario

Main menu → Scenarios → **Cockpit shadow demo** → **Fly**. Available at both
airports. `CockpitShadowDemo` holds the runway aircraft still in the 3D cockpit;
mouse/touch looking remains available. The sun visits six aircraft-relative
bearings/elevations: front-left, ahead, front-right, right, high and low. Each
six-second segment holds for 4.5 seconds and interpolates for 1.5 seconds, looping
in 36 seconds. Previous/Next work while paused; Resume restarts automatic movement.
The ordinary pause/menu also freezes the tour. Exit opens the main menu.

`SkyAtmosphere.sunDirectionOverride` changes the actual main sun and sky direction,
which also drives the localized cockpit sun and cached shadow invalidation. It is
an artificial lighting inspection, independent of the time-of-day trajectory.
Stopping or changing presets clears the override and restores time, cloud cover
and the previous camera. Aircraft physics is held only while this demo is active;
regular scenarios retain their normal integration.

Known limits of the demo view: the beauty renderer has MSAA, but long shallow
silhouettes (glareshield trim seen from the side) still stair-step, and dragging
the view to extremes exposes sliver gaps in the shipped cockpit skin where the
GLB panels meet. Neither is shadow-demo-specific; both are model/antialiasing
limits rather than regressions this scenario introduced.

`tests/cockpitShadowDemo.test.js` covers continuous loop boundaries, pause/manual
steps, heading-relative light, repeat entry and restoration. For browser evidence,
start Vite and a GPU-capable Chrome under the shared Chrome lease, then run:

```
APP_URL=http://127.0.0.1:5292 CDP_PORT=9484 chrome-session node scripts/verify-shadow-demo.mjs
```

When already holding a persistent `chrome-session hold` lease, invoke the Node
command directly within that workflow. The harness opens/closes its own tab,
selects the scenario through the menu, captures six sun directions, checks the
stationary pose and visible cockpit changes, pause/steps/loop, portrait layout
and exit restoration. It does not close or restart the shared browser.
