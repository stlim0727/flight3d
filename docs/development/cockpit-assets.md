# GLB cockpit controls and instruments

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
