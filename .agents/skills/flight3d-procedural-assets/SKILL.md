---
name: flight3d-procedural-assets
description: Author, modify, validate, and debug script-generated 3D GLB/GLTF models, geometry windings, surface normals, and pylons in Three.js and Node.js.
---

# Flight3d procedural 3D assets

Guidelines and verification rules for generating, updating, and testing binary
GLTF/GLB 3D assets in Flight3d.

## 1. Tooling & Commands

- **Build models**: `npm run build:missiles` (`node scripts/build-missile-assets.mjs`)
- **Validate geometry**: `npm run validate:missiles` (`node scripts/validate-glb-mesh.mjs`)
- **Unit tests**: `node --test tests/missileGlb.test.js tests/validateGlbMesh.test.js`

Every asset generation run with `build:missiles` automatically runs
`validateGlbModel` on all exported binary buffers and fails immediately if any
geometry has inverted normals, broken windings, or fuselage gaps.

## 2. Three.js in Node.js Execution Rules

### Binary GLTF Export
`GLTFExporter.parseAsync(group, { binary: true })` uses the browser `FileReader`
API internally. In Node.js, polyfill `globalThis.FileReader` before calling the
exporter:

```javascript
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(result => {
        this.result = result;
        this.onloadend?.();
      });
    }
  };
}
```

### Dual-Environment Isolation (Node vs Browser)
Aircraft and weapons views are imported by both headless Node unit tests and
browser Vite bundles. Never call relative model URLs (`/models/...`) unconditionally
at module top-level or in constructors. Always guard preloads with:

```javascript
if (typeof window !== 'undefined') {
  preloadMissileModels();
}
```
This protects Node test runners from `ERR_INVALID_URL` errors and prevents
clobbering `t.mock.method(GLTFLoader.prototype, 'loadAsync')`.

## 3. Geometry & Normal Conventions

### Tangent Ogives & LatheGeometry
`THREE.LatheGeometry(points, radialSegments)` creates faces around the Y axis.
To ensure normals point outward (+radial):
- **Ordering**: Points in the profile array must be ordered with **non-decreasing Y**
  (from bottom to top, base to apex).
- When plotting an aerodynamic nose along negative Z, reverse the profile array
  (`points.reverse()`) before passing it to `LatheGeometry`.

### Custom BufferGeometry Triangle Winding
When lofting custom fin or strake wedges with raw triangle lists:
- Vertex winding must be counter-clockwise (CCW) when viewed from the outside:
  `Normal = (B - A) × (C - A)`.
- For +X faces, `Nx > 0`. For -X faces, `Nx < 0`. For trailing edges, `Nz > 0`.
  For tip caps, `Ny > 0`.
- Verify every face normal with `validate-glb-mesh.mjs` before committing.

### Fuselage Longitudinal Continuity
Never model hazard identification bands (e.g. yellow HE or brown motor collars) as
floating separated cylinders between the guidance section and the rocket motor.
- The rocket motor body cylinder must be **continuous** from the guidance section
  all the way to the aft boat-tail.
- Warning bands must sit directly on top of the continuous body as outer collars
  at `radius * 1.006`.

## 4. Pre-Flight Verification Checklist

Before pushing or opening a PR with 3D model changes:
1. `npm run build:missiles` — builds and validates models in one step.
2. `npm run validate:missiles` — standalone validation of all GLB files.
3. `node --test tests/missileGlb.test.js tests/validateGlbMesh.test.js` — focused tests.
4. `npm run check` — syntax and workflow actions check.
