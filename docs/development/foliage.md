# Instanced vegetation (issue #10)

The coastal landscape uses three original stylized species: a broad tiered pine,
a narrow blue-green spruce, and a lobed deciduous oak. Their closed solid crowns,
brown trunks, matte PBR material and restrained greens share one visual style.
This is a lightweight stylized selection, not a photorealistic tree pack.

## Provenance and distribution

Author: Flight3d contributors, 2026. Original editable source:
https://github.com/stlim0727/flight3d/blob/codex/issue-10-foliage-lod/src/environment/TreeModels.js
(the same path on main after merge). The geometries and vertex colors are created
entirely by that source. There are no downloaded models, photos, textures,
purchases or derivatives of the candidate marketplace packs. Fab, Poly Haven and
Quaternius were acquisition candidates in the issue, not required dependencies.

[TreeModels.LICENSE.txt](../../src/environment/TreeModels.LICENSE.txt) grants MIT
redistribution, modification, repository inclusion and browser delivery rights
for this source and its generated assets. Three.js remains under its own license.
The change replaces the old single crown with layered/clustered crowns, gives
species distinct trunk/crown dimensions and colors, and generates a cheaper
distant mesh for each. There is no binary model regeneration step.

## Placement, rendering and collision

The original random stream, 3,500-tree limit, 9 km distribution radius, 600 m
inner radius, ground height lookup and 3.5–280 m altitude filter are preserved.
So are the airport center exclusions (`|x| < 2400 && |z| < 450`) and approach
exclusions (`|x| < 3600 && |z| < 250`), in meters. The fixed-seed browser check
asserts identical before/after tree centers. Size, height and yaw variation remain;
species cycle through the three types and a position-derived tint varies color
without consuming extra placement random numbers. City code is unchanged.

Each species has one near and one far InstancedMesh, sharing one vertex-colored
material. Trunk and crowns are merged into each geometry. There are at most six
vegetation color draws, plus up to three near shadow draws. A camera approaching
within 650 m selects near detail; near trees switch back beyond 750 m. Repacking
occurs after 25 m of camera movement, so actual crossing can lag by up to 25 m.
The 100 m hysteresis prevents oscillation; teleports rebuild the batches and their
bounding spheres. Updates run after camera movement in both stepping and render
paths. Hidden foliage at Lukla skips the work.

Near trees cast/receive shadows; distant trees receive them but do not cast them.
Far trunks omit hidden end caps. Crowns use fewer radial segments or octahedral
lobes in place of detailed icosahedral lobes. Leaf cards, alphaTest, transparency
and double-sided rendering are deliberately unnecessary: the meshes are opaque
and front-sided, avoiding layered alpha overdraw and back-face shadow artifacts.
Solid crown lobes still overlap, but the number is bounded (three/five per tree).

`treeData` keeps the existing cylinder contract, independent of visual LOD. Height
comes from the union of both geometry bounds times the actual vertical scale;
radius is the maximum vertex distance from the trunk axis times horizontal scale,
so yaw cannot extend outside it. This fixes the old fixed `10.5 * scale` height,
which ignored random vertical stretching. Both meshes fit the same proxy.

## Verification and evidence

On 2026-10-21, Node 22.23.2: `npm ci`, `npm run check`, `npm test` (287 passing),
and `npm run build` passed. The usual large-bundle build warning remains.
`tests/foliage.test.js` checks cheaper distinct species, every transformed vertex
against collision bounds, exclusion zones, rejected terrain, LOD hold/reversal/
teleport, exactly one visible instance per tree and actual collision at the top
of a generated tree. Collision metadata is unchanged throughout LOD sequences.

[Browser evidence](../../review-artifacts/foliage/README.md) includes fixed-camera
before/after captures, 650 m transition captures and measured frame time, draw
calls, texture memory and production transfer size. These isolated vegetation
checks do not establish full-flight FPS, mobile performance or complete simulator
acceptance. No 60 FPS guarantee is made.

Reproduce with a local Vite server, Node 22.23.2 and installed Chrome:

```powershell
npm run dev -- --host 127.0.0.1
# In another terminal:
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/verify-foliage.mjs
```

`SIM_URL`, `CDP_PORT`, `ARTIFACT_DIR` and `BASELINE_REF` can override defaults.
The script uses its own temporary browser profile, waits for Vite imports, checks
runtime exceptions and writes to `.tmp/foliage`. Baseline defaults to `184ec96`.
It does not load aircraft, terrain textures, cities, water or atmosphere; the
flat ground/daylight are identical between versions. Production bundle comparison
used an isolated archive of the baseline source, built with the same Node/Vite
and lockfile dependencies (no public assets copied); main JS byte counts are in
`transfer-results.json`.
