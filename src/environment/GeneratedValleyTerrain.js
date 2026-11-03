import * as THREE from 'three';

/**
 * Three.js 3D Procedural Mountain Valley Terrain
 * Creates an alpine canyon mesh matching the exact mathematical heights of
 * generateValley({ seed, rules }).
 */
export class GeneratedValleyTerrain {
  constructor(valleyTerrain, sim = null, options = {}) {
    this.terrain = valleyTerrain;
    this.isLoaded = true;
    this.loadError = null;
    this.region = 'generated-valley';

    const b = valleyTerrain?.bounds;
    const minX = b?.minX ?? -2000;
    const maxX = b?.maxX ?? 2000;
    const minZ = b?.minZ ?? -18000;
    const maxZ = b?.maxZ ?? 0;

    // Course extends northward (negative Z) from z=0 to minZ (~-18000m).
    // Provide generous mountain terrain margins:
    // - Ahead of finish line: 10,000m beyond minZ (runout and forward visibility)
    // - Behind start line: 6,000m past maxZ (approach and rear visibility)
    // - Lateral margin: at least 7,000m on each side of the corridor
    const northEdgeZ = minZ - 10000;
    const southEdgeZ = maxZ + 6000;
    const lengthZ = options.lengthZ ?? (options.size ? options.size : (southEdgeZ - northEdgeZ));
    const centerZ = options.centerZ ?? ((southEdgeZ + northEdgeZ) / 2);

    const widthX = options.widthX ?? (options.size ? options.size : Math.max(18000, (maxX - minX) + 14000));
    const centerX = options.centerX ?? ((minX + maxX) / 2);

    this.size = Math.max(widthX, lengthZ);
    this.widthX = widthX;
    this.lengthZ = lengthZ;
    this.centerX = centerX;
    this.centerZ = centerZ;

    const segmentsX = options.segmentsX ?? (options.segments ? options.segments : 200);
    const segmentsZ = options.segmentsZ ?? (options.segments ? Math.round(options.segments * (lengthZ / widthX)) : 380);
    this.segments = Math.max(segmentsX, segmentsZ);
    this.mesh = null;
    this.group = new THREE.Group();
    this.group.name = 'generated-valley-terrain';

    if (sim?.scene) {
      const geom = new THREE.PlaneGeometry(widthX, lengthZ, segmentsX, segmentsZ);
      geom.rotateX(-Math.PI * 0.5);
      // Center the mesh along the generated valley trajectory
      geom.translate(centerX, 0, centerZ);

      const pos = geom.attributes.position;
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, this.terrain.getHeight(x, z));
      }
      geom.computeVertexNormals();
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const norm = geom.attributes.normal;
      const colors = new Float32Array(count * 3);
      const cFloor = new THREE.Color(0x273628);  // valley floor moss/pine
      const cCanyon = new THREE.Color(0x524638); // canyon earth/rock
      const cCliff = new THREE.Color(0x352e26);  // sheer cliff rock face
      const cRidge = new THREE.Color(0x7a746e);  // alpine granite
      const cSnow = new THREE.Color(0xdce5ed);   // high mountain peaks
      const tmpColor = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const y = pos.getY(i);
        const ny = norm.getY(i);

        // Procedural vertex tint based on elevation above valley floor (~2100m)
        const relY = y - 2100;
        if (relY < 60) {
          tmpColor.lerpColors(cFloor, cCanyon, Math.max(0, relY / 60));
        } else if (relY < 320) {
          tmpColor.lerpColors(cCanyon, cRidge, (relY - 60) / 260);
        } else {
          tmpColor.lerpColors(cRidge, cSnow, Math.min(1, (relY - 320) / 300));
        }

        // Steep canyon wall shading: darken sheer rock faces
        if (ny < 0.78) {
          const cliffFactor = Math.min(1, (0.78 - ny) / 0.45);
          tmpColor.lerp(cCliff, cliffFactor * 0.75);
        }

        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.05,
        flatShading: false,
      });

      this.mesh = new THREE.Mesh(geom, mat);
      this.mesh.receiveShadow = true;
      this.group.add(this.mesh);
      sim.scene.add(this.group);
    }
  }

  getHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  getNormal(x, z) {
    return this.terrain.getNormal ? this.terrain.getNormal(x, z) : new THREE.Vector3(0, 1, 0);
  }

  dispose(sim = null) {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach(m => m.dispose());
      } else {
        this.mesh.material.dispose();
      }
      this.mesh = null;
    }
    const scene = sim?.scene;
    if (scene && this.group) {
      scene.remove(this.group);
    }
  }
}
