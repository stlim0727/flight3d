# Correct projection depth and clear cockpit sunlight

GPU: Intel ADL-N through ANGLE Vulkan, Chrome, 1280×720. Production code keeps
logarithmic exterior beauty depth; shadow depth and AO normal depth use ordinary
projection depth. Clear-sun gain 3.2, cookie leak 1%, unchanged flood normalization.
The transparent windshield overlay is unlit so it cannot brighten the outside view.

`npm run check`, all 408 Node tests and `npm run build` passed. The full
`scripts/verify-cockpit-shadows.mjs` acceptance passed ten deterministic
sun/weather/attitude views. See `deck-sun-report.json`.

At 16:48, heading 000°, clear weather, removing the native frame **only from the
localized sun shadow pass** changes 27,060 deck pixels with peak mean-RGB delta
103/255. Repeated-render noise, outside and instrument-display differences are 0.
The external directional shadow, beauty geometry, cookie and all lights stay
unchanged. The previous castShadow=false ablation also removed the external
sun's coarse shadows and could miss the broken local shadow depth.

`contrast-final.png`, `contrast-frame-casting-off.png`, `contrast-ao-off.png`
show independent frame-shadow and AO ablations. `pillar-console.png` and
`pillar-console-local-shadow-off.png` show the same pair looking down, with the
HTML HUD hidden; sunlight is exactly the production setting, without a diagnostic
intensity multiplier. Night and overcast evidence are retained too.

## Selected pillar regions

The native frame is one 667-triangle mesh. Selecting triangle centroids in
aircraft coordinates identifies two visible pillar regions (53 and 65 triangles,
including some adjacent trim). `selected-pillar-segments.png` marks these regions
magenta solely to verify the selection. All difference measurements restore the
original material and visible geometry, restricting draw ranges only for the
localized shadow camera. The external sun is retained.

`segment-ablation.json` records each region separately at four sun angles. At
16:48 the near region changes 17,879 pixels, forward region 27,500 pixels, and
both 49,400 pixels, peak mean-RGB delta 54.7/255. These full-image counts include
the left sidewall and lower console; the broad image zone named `panel` is not a
semantic instrument-panel mask. Native geometry and sun direction determine where
the bands land. The 737 glareshield blocks much of the vertical instrument panel;
this is not the same shadow layout as the reference fighter canopy.

Reproduce after launching Vite and dedicated GPU Chrome as described in
`docs/development/cockpit-sunlight.md`:

```
CDP_PORT=9483 ARTIFACT_DIR=/tmp/deck-check node scripts/verify-cockpit-shadows.mjs
CDP_PORT=9483 ARTIFACT_DIR=/tmp/pillar-check node review-artifacts/sharp-shadows/pillar-segment-check.mjs
```

The acceptance reports cached/forced render-plus-simulation costs of 116.16 /
174.37 ms per frame on this contended host. These establish caching behavior,
not an interactive FPS guarantee. Build retains the existing large-bundle warning;
Chrome reports the existing missing optional favicon.
