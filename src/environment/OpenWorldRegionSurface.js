import * as THREE from 'three';
import { pavementRibbon } from './IncheonPavement.js';

const DEG = Math.PI / 180;

/**
 * Anchor surface for a region whose ground is rendered by OpenWorldTerrain.
 * It supplies the mesh host, precinct local-imagery geometry and an analytic
 * height fallback for cold cache or failed tiles; no region-specific mesh or
 * macro canvas atlas is needed.
 */
export class OpenWorldRegionSurface {
  constructor({
    elevationM = 0,
    precinctExtent = [-3200, -1500, 3200, 1500],
    fallback,
    strips = [],
  } = {}) {
    this.fallback = fallback;
    this.openWorld = null;
    this.isLoaded = true;
    this.mesh = new THREE.Group();
    this.mesh.name = 'Open-world region surface';

    const [minX, minZ, maxX, maxZ] = precinctExtent;
    this.geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate((minX + maxX) / 2, elevationM, (minZ + maxZ) / 2);
    this.airportMesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ visible: false }));
    this.mesh.add(this.airportMesh);

    const stripMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3033, roughness: 0.9 });
    this.stripMeshes = strips.map(strip => {
      const angle = strip.headingDeg * DEG;
      const dx = Math.sin(angle) * strip.lengthM / 2;
      const dz = -Math.cos(angle) * strip.lengthM / 2;
      const ribbon = pavementRibbon([
        [strip.center[0] - dx, strip.center[1] - dz],
        [strip.center[0] + dx, strip.center[1] + dz],
      ], strip.widthM);
      ribbon.translate(0, strip.elevationM + 0.02, 0);
      const mesh = new THREE.Mesh(ribbon, stripMaterial);
      this.mesh.add(mesh);
      return mesh;
    });
    this.stripMaterial = stripMaterial;
  }

  // OpenWorldTerrain derives its precinct localImagery from this geometry.
  get airportGeometry() { return this.geometry; }

  getHeight(x, z) {
    if (this.fallback?.isOnRunway?.(x, z)) return this.fallback.getHeight(x, z);
    const streamed = this.openWorld?.sampleRaw?.(x, z) ?? this.openWorld?.sample?.(x, z)?.height;
    if (Number.isFinite(streamed)) return streamed;
    return this.fallback?.getHeight(x, z) ?? 0;
  }

  getNaturalHeight(x, z) {
    return this.getHeight(x, z);
  }

  getWaterLevel(x, z) {
    const streamed = this.openWorld?.sample?.(x, z);
    if (streamed) return streamed.water ? streamed.height : -10000;
    return this.fallback?.getWaterLevel(x, z) ?? 0;
  }

  getNormal(x, z) {
    const d = 1;
    return new THREE.Vector3(
      this.getHeight(x - d, z) - this.getHeight(x + d, z),
      2 * d,
      this.getHeight(x, z - d) - this.getHeight(x, z + d),
    ).normalize();
  }

  isOnRunway(x, z) {
    return Boolean(this.fallback?.isOnRunway?.(x, z));
  }

  isRunwaySafetyArea(x, z) {
    return Boolean(this.fallback?.isRunwaySafetyArea?.(x, z));
  }

  dispose() {
    this.geometry.dispose();
    this.airportMesh.material.dispose();
    for (const mesh of this.stripMeshes) mesh.geometry.dispose();
    this.stripMaterial.dispose();
    this.mesh.removeFromParent();
  }
}
