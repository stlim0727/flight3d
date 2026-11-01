import * as THREE from 'three';
import { HANGANG_COURSE, riverCenter, hangangHeight } from '../config/hangangCourse.js';
import { createBridge, createBridgeMaterials } from './hangangBridges.js';
import { createSeoulScenery } from './SeoulLandmarks.js';

// Realistic twilight Hangang scenery featuring the Yeouido–Yongsan Han River corridor,
// glowing bridge architecture, expressways, and sparkling metropolis night grid.
export class HangangScene {
  constructor(course = HANGANG_COURSE) {
    this.group = new THREE.Group();
    this.group.name = 'Hangang training scenery';
    this.group.visible = false;
    this.terrain = { getHeight: hangangHeight, getNormal: () => new THREE.Vector3(0, 1, 0) };
    this.airport = { isOnRunway: () => false, update() {} };

    // Deep nocturnal water with high specular sheen to capture the sunset horizon reflection
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(18000, 18000),
      new THREE.MeshStandardMaterial({
        color: 0x081119,
        roughness: 0.14,
        metalness: 0.68,
      })
    );
    river.rotation.x = -Math.PI / 2;
    river.position.z = -2500;
    river.receiveShadow = true;
    this.group.add(river);

    // River banks with natural slope up to urban level
    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x1a261c,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const vertices = [], indices = [];
      for (let i = 0; i <= 160; i++) {
        const z = 2500 - i * 65;
        for (const d of [450, 490, 3200]) {
          const x = riverCenter(z) + side * d;
          vertices.push(x, hangangHeight(x, z), z);
        }
        if (i < 160) {
          for (let j = 0; j < 2; j++) {
            const a = i * 3 + j;
            indices.push(...(side < 0 ? [a, a + 3, a + 1, a + 1, a + 3, a + 4] : [a, a + 1, a + 3, a + 1, a + 4, a + 3]));
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const bank = new THREE.Mesh(geometry, bankMat);
      bank.receiveShadow = true;
      this.group.add(bank);
    }

    // Bridges with architectural night lighting & illuminated clearance gates
    const bridgeMaterials = createBridgeMaterials();
    this.bridges = course.bridges.map(bridge => {
      const group = createBridge(bridge, bridgeMaterials);
      this.group.add(group);
      return group;
    });

    // Seoul Metropolis Scenery & Landmarks
    const seoul = createSeoulScenery();
    this.group.add(seoul.group);
    this.seoulUpdate = seoul.update;
  }

  update(dt) {
    this.seoulUpdate?.(dt);
  }
}
