# GLB gallery LODs and mesh decimation

`assets.html` previews every shipped GLB. Assets of 1 MiB or more get a
decimated LOD variant under `public/models/lod/`, listed next to the source in
the gallery with a `LOD` badge. Runtime aircraft and cockpit loaders keep using
the full assets; LOD files exist for the gallery comparison only.

## Generate

```sh
npm run build:lod
```

`scripts/decimate-glb-assets.mjs` scans `public/models/**/*.glb` (skipping
`public/models/lod`), and for every source at or above 1 MiB:

1. welds vertices (tolerance 0.0001) and simplifies with meshoptimizer to 10% of
   the triangles under a 1% relative error budget (`--ratio`, `--error`);
2. keeps `KHR_draco_mesh_compression` when the source is Draco-compressed;
3. writes `public/models/lod/<source path>` with nodes, materials and animations
   intact;
4. deletes the variant unless it cuts the payload by at least 15%
   (`--min-gain`) and removes LODs whose source no longer qualifies.

`--dry-run` reports results without touching disk. Dependencies are
`@gltf-transform/{core,functions,extensions}`, `meshoptimizer` and
`draco3dgltf`.

## Current results

| Source | Source size / tris | LOD size / tris | Payload gain |
| --- | --- | --- | --- |
| `b737-cockpit-draco.glb` | 2.12 MB / 832,427 | 1.03 MB / 387,349 | 51.5% |
| `b737-cockpit-medium.glb` | 3.66 MB / 964,844 | 2.23 MB / 357,284 | 39.1% |
| `f-16.glb` | 5.25 MB / 30,272 | 3.99 MB / 11,801 | 24.0% |
| `c172.glb` (skipped) | 7.91 MB / 187,453 | 7.17 MB / 21,121 | 9.4% |

`c172.glb` is texture-bound: 7.2 MB of its 7.9 MB are textures, so mesh
decimation cannot make a lighter gallery asset. Shrinking it needs texture
compression, not more triangles removed; the script therefore leaves no LOD for
it. The error budget also stops the cockpits well above the 10% ratio target,
because instrument lettering and switch geometry cannot be collapsed further
within 1% of the model size.

## Gallery entries

`MODEL_CATALOG` in `assets.html` carries one hand-written entry per LOD
(`f-16-lod`, `b737-cockpit-medium-lod`, `b737-cockpit-draco-lod`). Each copies
its source title, description style, license and camera preset, and states the
source/LOD sizes and triangle counts. After regenerating with different
parameters, update those entries or delete the ones whose variant is skipped.

## Verify

```sh
node --test tests/decimatedGlbAssets.test.js
```

The test reads every file in `public/models/lod`, requires a source of at least
1 MiB with a payload gain of at least 15%, and asserts fewer triangles with
identical node and material names. It also keeps `c172` from reappearing as a
mesh-decimated duplicate. Gallery rendering still needs a hardware-GPU browser
check.
