# GLB cockpit controls and instruments

## Selected asset and attribution (issue #9)

Retain hakai315's [Boeing 737-800 Cockpit](https://sketchfab.com/3d-models/boeing-737-800-cockpit-d463256f98654b36af019d2d88bd5bbe),
the 737-800 NG flight deck already shipped in both GLBs, rather than introducing
a MAX flight deck or purchasing another model. Its six main display apertures,
MCP windows, CDU keys, separate control geometry and measured pivots match the
existing instrument bindings. The shipped material set uses glTF metallic/
roughness PBR factors; fixed lettering and engravings are asset geometry, not
runtime Canvas drawing. These GLBs have no embedded bitmap images: a new label
atlas is unnecessary for this asset. Existing static batching combines compatible
opaque lettering/panels after moving parts have been separated.

Both GLBs identify the title, author, source and CC BY 4.0 license in
`asset.extras`. That embedded record is the attribution source; the Sketchfab
page returned HTTP 403 during this verification, so its current listing was not
independently inspected. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
permits redistribution and adaptation with attribution, a license link and an
indication of changes. The [distributed notice](../../public/models/b737-cockpit.LICENSE.txt)
and [credits](../../CREDITS.md) retain those details. The earlier conversion used
glTF-Transform/Draco; Flight3d applies alignment, material adjustments, static
batching, dynamic screen overlays and control articulation at runtime. Issue #9
does not replace, re-encode or enlarge either GLB.

The procedural interior was already removed by #118. Keep the small enclosure
and glass corrections and the live display meshes in `Cockpit.js`; do not
restore its old box/cylinder panel, seat, yoke or fixed-label builders.

## Airframe controls

`bindGltfAirframeControls()` separates the native gear handle, flap selector,
speedbrake and two trim wheels before static batching. For the medium GLB,
`Cylinder058`, `Cube482`, `Cube481`, `Cylinder210` and `Cylinder211` identify the
complete parts, including their markings. The material-batched lite GLB uses
measured bounds to select the exposed moving handles and wheels. Its buried
lever bases remain in the fixed quadrant.

Asset coordinates are metres, +Y up and +Z forward (the root rotates by PI into
aircraft coordinates). Pivots live beside their measured bounds in
`GltfCockpitControls.js`. Gear extension continuously translates its handle along
the vertical gate; flap index 0–6 and spoiler fraction 0–1 pull the handles aft.
Trim wheel angle derives from telemetry `pitchTrim` in degrees, with a visual
ratio of 60 degrees per trim degree. This is a visual linkage, not a certified
mechanical gear ratio. Absolute transforms keep hold/reversal/reset independent
of render frequency. All five pivots are excluded from the static batch and
included in the cockpit sun-shadow invalidation signature.

## Reproduce issue #9 acceptance

Use Node 22.23.2. Start Vite on port 5209 and a separate Chrome with CDP port
9499, a dedicated profile, and a 1440×1000 viewport. For example on Windows:

```powershell
npm run dev -- --host 127.0.0.1 --port 5209 --strictPort
# In another terminal (use your installed Chrome path):
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --remote-debugging-port=9499 --user-data-dir=C:\temp\flight3d-cockpit-review --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader about:blank
node scripts/verify-cockpit-assets.mjs
```

`SIM_URL`, `CDP_PORT`, `ARTIFACT_DIR` and `BASELINE_REF` override the defaults.
The default baseline is `caab0a7`. Restart Vite after source edits if the host's
filesystem watcher retains old modules. The verifier reconstructs the baseline
cockpit and control module in ignored `.tmp/`, uses the same GLBs, cameras,
lighting and resolution, and writes before/after forward, instrument, pedestal
and night images. It blocks the medium URL for the third scenario to exercise
the real lite fallback. It fails empty control bindings, hold/reset drift,
missing screen maps, unchanged pixels for any of the six CanvasTextures, and
page exceptions. Node tests additionally exercise reversal, invalid telemetry,
static batch exclusion and shadow-cache invalidation.

See [recorded results](../../review-artifacts/cockpit-assets/README.md) for this
run's hardware/backend, timing, draw calls, texture estimate, bytes and visual
review. The isolated cockpit measurement excludes terrain, flight dynamics,
full-scene shadows/AO and audio; it is not a simulator FPS guarantee.

The GLTF interior is the only cockpit geometry; the vector cockpit and its photo
textures were removed. `Cockpit.cockpitModelLoading` and
`cockpitModelFailed` report the download state. The default cockpit must request
`b737-cockpit-medium.glb`. Call
`loadCockpitModel()` without a URL at initialization; explicitly passing the lite
URL bypasses the medium default. The lite Draco asset remains the load fallback.
If neither asset resolves, `main.js` leaves the cockpit view for chase and toasts
that the interior is unavailable, because cockpit mode hides the exterior groups.

## Preserve the enclosure

Keep every native shell mesh visible, including `Body018`. Its geometry closes
parts of the cockpit even though it was previously classified as exterior nose
skin. Frame, lining, and console surfaces include single-layer triangles and
must render with `DoubleSide`; `FrontSide` makes interior-facing surfaces vanish
at the windshield sill, side walls, and rear/roof enclosure. Preserve material
transparency so actual window openings remain clear. The medium and lite GLBs
remain unchanged by this rendering repair.

Run the browser regression against a local Vite server:

```sh
PORT=5198 ARTIFACT_DIR=/tmp/cockpit-enclosure-evidence node scripts/verify-window-framing.js
```

It checks native shell visibility and inward rendering, raycasts the solid wall
below the left window, and captures front, side, rear, roof, and floor views.
The pre-repair loader fails the shell assertions. The repaired medium model
intercepts the sidewall ray at approximately 0.268 m. Blocking the medium request
also verified the lite fallback enclosure in Chrome, including a sidewall
intersection at approximately 0.268 m.

The GLBs share asset coordinates: forward +Z, panel LCDs at approximately
Z=1.458, and captain yoke at X=0.302. The model root rotates by PI around Y and
translates by (0, -1.31, -11.43) into aircraft coordinates. Display apertures are
measured from the GLB geometry. MCP and CDU canvas UVs
crop to LCD content so the model's switches and keypad remain visible.

The medium asset has nested transforms and shared geometry; the lite asset
batches unrelated geometry by material. `GltfCockpitControls.js` extracts only
yoke triangles in model coordinates, retaining UVs and normals. Keep both paths
working when replacing an asset. Never animate a whole material batch.

`J` or the action-panel button hides the yoke handles for reading
the instruments. Controls continue to animate while hidden. `D` is right roll;
the demo restart shortcut is `P`, matching the displayed help.

Instrument drawing is shared by animation and deterministic stepping. Inspector
history records even while its panel is closed, including valid zero-G samples.

## Browser acceptance

Captured in headless Chrome at 1440×1000 with ANGLE/Vulkan. Evidence is in
`review-artifacts/cockpit-live/` (screenshots and assertion results).

- Confirmed HTTP 200 for medium GLB, with no lite request on the normal path.
- Both yokes bind to nonempty native geometry; native D/A keyboard input reaches
  the rendered GLB, and D leaves demo inactive.
- Held, reversed, and released aileron/elevator snapshots animate both handles
  and restore their neutral transforms.
- PFD and ISFD display changed speed, altitude, pitch, and bank; PFD pixels changed.
  Deterministic stepping refreshes the PFD before returning.
- J and the action button hide/show the handles. Native columns remain visible.
- Hidden inspector records zero G; opening it draws green/cyan graph pixels.
- Blocking the medium request successfully loads and binds the lite fallback.
- No page exceptions on the normal path. These are rendering/interaction checks,
  not a flight-dynamics or frame-rate benchmark.
