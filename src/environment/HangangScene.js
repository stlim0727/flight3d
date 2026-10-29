import * as THREE from 'three';
import { HANGANG_COURSE, bridgeSolids, riverCenter, hangangHeight } from '../config/hangangCourse.js';
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
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x586066, roughness: 0.85 });
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.9 });
    const pierLightMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });

    this.bridges = course.bridges.map((bridge, index) => {
      const group = new THREE.Group();
      group.position.set(bridge.x, 0, bridge.z);
      group.rotation.y = bridge.yaw;

      const isArch = bridge.style === 'arch';
      const isTower = bridge.style === 'tower';

      // Steel superstructure with emissive night glow
      const steelMat = new THREE.MeshStandardMaterial({
        color: bridge.color,
        roughness: 0.5,
        metalness: 0.45,
        emissive: isArch ? 0xcc3300 : isTower ? 0x0055bb : 0x223344,
        emissiveIntensity: 0.45,
      });

      for (const solid of bridgeSolids(bridge)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...solid.size), solid.part === 'pier' ? concreteMat : steelMat);
        mesh.position.set(...solid.center);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      }

      // Road deck surface
      const surface = new THREE.Mesh(new THREE.BoxGeometry(1200, 0.05, 19), roadMat);
      surface.position.y = 40.03;
      group.add(surface);

      // Deck Streetlights
      for (let sx = -550; sx <= 550; sx += 55) {
        for (const sz of [-9.5, 9.5]) {
          const lightPole = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 3.5, 0.3),
            concreteMat
          );
          lightPole.position.set(sx, 41.8, sz);
          group.add(lightPole);

          const lantern = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 0.4, 0.6),
            pierLightMat
          );
          lantern.position.set(sx, 43.6, sz);
          group.add(lantern);
        }
      }

      // Pier upward floodlights
      for (const px of [-550, -350, -150, -55, 55, 150, 350, 550]) {
        const flood = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), pierLightMat);
        flood.position.set(px, 3, 0);
        group.add(flood);
      }

      // Above-deck decorative arches (Hangang Bridge / Central bridge)
      if (isArch) {
        for (const z of [-9, 9]) {
          const curve = new THREE.CatmullRomCurve3(
            Array.from({ length: 17 }, (_, i) => new THREE.Vector3(-150 + i * 18.75, 41 + 35 * Math.sin(i * Math.PI / 16), z))
          );
          const arch = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 1.4, 8, false), steelMat);
          arch.castShadow = true;
          group.add(arch);
        }
      }

      // Navigation clearance markers (Gate opening)
      const markerMat = new THREE.MeshStandardMaterial({
        color: 0xffd044,
        emissive: 0xff9900,
        emissiveIntensity: 0.9,
      });
      for (const x of [-43, 43]) {
        const marker = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.4), markerMat);
        marker.position.set(x, 31, 11.3);
        group.add(marker);
      }

      // Gate number signboard
      let signMat;
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = '#0f2630';
          context.fillRect(0, 0, 256, 128);
          context.strokeStyle = '#ffb330';
          context.lineWidth = 6;
          context.strokeRect(4, 4, 248, 120);
          context.fillStyle = '#ffe0a0';
          context.font = 'bold 70px sans-serif';
          context.textAlign = 'center';
          context.fillText(String(index + 1).padStart(2, '0'), 128, 88);
        }
        signMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) });
      } else {
        signMat = new THREE.MeshBasicMaterial({ color: 0x163642 });
      }
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 7.5),
        signMat
      );
      sign.position.set(0, 43, 11.4);
      group.add(sign);

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
