# Ship exterior assets (issue #14)

Four original GLBs replace the primitive ship exteriors: container cargo ship,
cruise liner, oil tanker and motor yacht/speedboat. Existing ocean rendering,
large-vessel locations, route centres/radii/speeds and wave-height API remain.

## Selection, source and redistribution

Selected candidate for each type: an original Flight3d exterior model, authored
by Flight3d contributors with Codex assistance. Fab/CGTrader were possible
marketplaces in the issue, not mandatory purchases. No third-party artwork,
downloaded texture, real ship brand or restricted source asset is used.

Editable original source:
[build-ship-assets.mjs](https://github.com/yt7good/flight3d/blob/codex/issue-14-ship-assets/scripts/build-ship-assets.mjs).
The same path will be available in the upstream repository after merge.
[The ship asset MIT license](../../public/models/ships/LICENSE.txt) covers the
generator, its four GLBs and the original wake texture generator. It permits
modification, repository redistribution and browser delivery; it does not
relicense unrelated repository files.

The generator lofts a chine hull with a pointed bow, flared waterline and transom
stern. Exterior additions include cargo stacks/corrugation, bridge windows,
rails, masts, funnels, stepped passenger decks, pools, lifeboats and tanker
manifolds. There are no cabins, furniture or interior equipment. Hidden stack
corrugations and locking bars are omitted. Indexed geometry is batched by a
small PBR material palette; duplicate speedboats share geometries/materials.
There are no model image textures, external buffers or decoder extensions.

Regenerate using Node 22.23.2 and lockfile dependencies:

```sh
node scripts/build-ship-assets.mjs
node --test tests/ships.test.js tests/collision.test.js
```

| Asset | Length × beam (m) | Local Y range (m) | Triangles | Draws | GLB bytes |
| --- | --- | --- | ---: | ---: | ---: |
| Cargo | 220 × 34.13 | -6 to 46 | 8,584 | 8 | 520,960 |
| Cruise | 190 × 30 | -5 to 39.5 | 8,668 | 7 | 525,300 |
| Tanker | 180 × 28 | -5 to 37 | 1,200 | 7 | 69,968 |
| Speedboat | 22 × 5 | -1 to 3.775 | 284 | 6 | 22,480 |

## Placement, animation and collision contract

All GLBs use metres, +Y up, -Z bow, and an origin at the centre of the waterline.
`shipAssetManifest.json` is generated from actual vertex bounds. Runtime bounds
are measured from each loaded visual before attaching it to a motion root.
Fallbacks have bounds matching their own simple visible hull, not an invisible
full-height superstructure. Asset loading never changes the root, route phase
or pose, and failed loads leave visible, collidable hulls with diagnostic status.

Large vessels retain their wave-following pitch and gentle sinusoidal roll;
bow/stern wave samples now respect heading. Rotation order YXZ keeps pitch/roll
in the heading frame. Positive X pitches a -Z bow upward. Moving boats now use
`PI - angle` heading and +6 degrees pitch: the former `-angle` and -6 degrees
pointed the bow opposite travel and down. The circular routes are unchanged.

Collision uses sphere-versus-local-bounds tests through the full inverse world
matrix, covering wave elevation, heading, pitch and roll. It includes speedboats
and the true mast/bow envelope. Ship motion roots are unit scale. These remain
conservative bounding boxes, not triangle-accurate hull/deck collision; open
space inside the envelope may therefore count as collision.

The shared 128×128 RGBA wake texture has feathered V-shaped foam and central
churn. Two independently deforming 8×24-segment wake meshes follow wave heights
at their vertices, 0.12 m above the queried surface. They inherit heading but
not planing pitch/roll, and sit behind the stern. Depth writing is disabled;
polygon offset and transparent borders avoid the previous solid rectangle and
coplanar overlap. This is a short visual trail, not a fluid simulation/history.

## Browser evidence and measured budget

Evidence: [screenshots and raw results](../../review-artifacts/ships/README.md).
Baseline: `31bede9206f28fbe9201c4ad9589bd3f13580e82`. Comparison uses seeded
baseline cargo placement, identical camera/target positions, wave time 12 s,
1440×1000 pixels, fixed daylight and the real WaterOcean shader. Shadows are
disabled for both versions. Five views include each type and a waterline view;
additional captures at wave times 18/24 s inspect changing surface contact.

Reference machine: Windows, Intel Core Ultra 7 256V, Intel Arc 140V (8GB),
Chrome 155 headless, ANGLE D3D11. The table records the final acceptance run.
Three warmups precede 12 samples per view; wall time waits for GPU completion
through fences and timer polling. Short samples/timer scheduling have variance;
this is an isolated maritime scene, not a full-flight FPS guarantee.

| View | Draws before → after | Median ms before → after | P95 ms before → after |
| --- | ---: | ---: | ---: |
| Cargo (includes distant boat) | 157 → 16 | 10.1 → 6.1 | 12.5 → 10.6 |
| Cruise | 15 → 8 | 7.3 → 9.6 | 38.2 → 11.0 |
| Tanker | 7 → 8 | 7.0 → 6.5 | 10.7 → 11.0 |
| Speedboat | 4 → 8 | 9.4 → 9.4 | 11.4 → 11.4 |
| Waterline | 4 → 8 | 5.6 → 5.7 | 10.4 → 10.5 |

After the first baseline measurement, the working budget was set to at most
8 material draws/type and 37 for all five ships, two wakes and ocean (no shadows),
under 1.2 MB of new model payload, and under 0.1 MiB of added texture storage.
Actual model payload is 1,138,708 bytes (four requests; both speedboats share a
request). Before: zero separate ship model/texture requests. Local HTTP transfer
including headers: 1,139,908 bytes. Texture allocation increases from zero to
87,380 bytes for one RGBA8 wake including its mip chain. This excludes existing
ocean shaders/buffers and the rest of the application. More detailed models
increase triangle counts and do not improve every view's frame time.

Browser assertions confirm all five GLBs load in the full simulator, four unique
asset requests, shared boat resources, no runtime exceptions, and no failed
shader program in the comparison scene. Node tests cover real GLB bounds/normals,
late replacement, failed downloads, multi-step motion/heading/wake clearance and
collision at rotated/elevated mast and beam extents. The full local gate passed
304 tests, syntax/action checks and production build; final geometry optimization
was followed by the focused asset tests and another build.

Reproduce (Vite defaults to 5173; override `SIM_URL` if needed):

```sh
npm run dev -- --host 127.0.0.1
node scripts/verify-ships.mjs
```

Use `CHROME_PATH` for a platform-specific Chrome executable, `GPU_ANGLE=d3d11`
on the reference Windows host, and `FULL_APP=1` to also smoke-test the application.
The default backend is SwiftShader. `ARTIFACT_DIR`, `CDP_PORT` and `BASELINE_REF`
are configurable. Results go to `.tmp/ships/`. No deployment or end-to-end flight
acceptance is claimed by this scoped scene check.
