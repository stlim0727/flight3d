import * as THREE from 'three';

/**
 * Three.js 3D Procedural Mountain Valley Terrain
 * Creates an alpine canyon mesh matching the exact mathematical heights of
 * generateValley({ seed, rules }).
 */
export class GeneratedValleyTerrain {
  constructor(valleyTerrain, sim = null, { size = 16000, segments = 128 } = {}) {
    this.terrain = valleyTerrain;
    this.isLoaded = true;
    this.loadError = null;
    this.region = 'generated-valley';
    this.size = size;
    this.segments = segments;
    this.mesh = null;
    this.group = new THREE.Group();
    this.group.name = 'generated-valley-terrain';

    if (sim?.scene) {
      const geom = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
      geom.rotateX(-Math.PI * 0.5);
      // Center the mesh along the generated valley trajectory (starts at z=0, extends southward)
      geom.translate(0, 0, 4000);

      const pos = geom.attributes.position;
      const count = pos.count;
      const colors = new Float32Array(count * 3);
      const cFloor = new THREE.Color(0x273628);  // valley floor moss/pine
      const cCanyon = new THREE.Color(0x524638); // canyon earth/rock
      const cRidge = new THREE.Color(0x7a746e);  // alpine granite
      const cSnow = new THREE.Color(0xdce5ed);   // high mountain peaks
      const tmpColor = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = this.terrain.getHeight(x, z);
        pos.setY(i, y);

        // Procedural vertex tint based on elevation above valley floor (~2100m)
        const relY = y - 2100;
        if (relY < 60) {
          tmpColor.lerpColors(cFloor, cCanyon, Math.max(0, relY / 60));
        } else if (relY < 320) {
          tmpColor.lerpColors(cCanyon, cRidge, (relY - 60) / 260);
        } else {
          tmpColor.lerpColors(cRidge, cSnow, Math.min(1, (relY - 320) / 300));
        }
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }

      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.computeVertexNormals();

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
