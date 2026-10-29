import * as THREE from 'three';
import { HANGANG_COURSE, bridgeSolids, riverCenter, hangangHeight } from '../config/hangangCourse.js';

// Original, procedural preview assets; surveyed/GLB replacements are issue #267.
export class HangangScene {
  constructor(course = HANGANG_COURSE) {
    this.group = new THREE.Group(); this.group.name = 'Hangang training scenery';
    this.group.visible = false;
    this.terrain = { getHeight: hangangHeight, getNormal: () => new THREE.Vector3(0, 1, 0) };
    this.airport = { isOnRunway: () => false, update() {} };
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa1a29a, roughness: 0.9 });
    const road = new THREE.MeshStandardMaterial({ color: 0x35444c, roughness: 0.85 });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000),
      new THREE.MeshStandardMaterial({ color: 0x3d7d8b, roughness: 0.43, metalness: 0.15 }));
    river.rotation.x = -Math.PI / 2; river.position.z = -2500; river.receiveShadow = true;
    this.group.add(river);
    // Same continuous bank height used by collisions; sampled ribbon, not an ocean map.
    for (const side of [-1, 1]) {
      const vertices = [], indices = [];
      for (let i = 0; i <= 160; i++) {
        const z = 2500 - i * 65;
        for (const d of [450, 490, 3000]) vertices.push(riverCenter(z) + side * d, hangangHeight(riverCenter(z) + side * d, z), z);
        if (i < 160) for (let j = 0; j < 2; j++) {
          const a = i * 3 + j;
          indices.push(...(side < 0 ? [a, a + 3, a + 1, a + 1, a + 3, a + 4] : [a, a + 1, a + 3, a + 1, a + 4, a + 3]));
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      const bank = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x63845c, roughness: 1, side: THREE.DoubleSide }));
      bank.receiveShadow = true; this.group.add(bank);
    }
    this.bridges = course.bridges.map((bridge, index) => {
      const group = new THREE.Group(); group.position.set(bridge.x, 0, bridge.z); group.rotation.y = bridge.yaw;
      const steel = new THREE.MeshStandardMaterial({ color: bridge.color, roughness: 0.65, metalness: 0.25 });
      for (const solid of bridgeSolids(bridge)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...solid.size), solid.part === 'pier' ? concrete : steel);
        mesh.position.set(...solid.center); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
      }
      const surface = new THREE.Mesh(new THREE.BoxGeometry(1200, 0.05, 19), road);
      surface.position.y = 40.03; group.add(surface);
      // Above-deck decorative arch: no obstruction inside the flight opening.
      // It remains inside the deck's horizontal footprint; overflight is not a valid gate.
      if (bridge.style === 'arch') for (const z of [-9, 9]) {
        const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => new THREE.Vector3(-150 + i * 18.75, 41 + 35 * Math.sin(i * Math.PI / 16), z)));
        const arch = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 1.2, 6, false), steel); arch.castShadow = true; group.add(arch);
      }
      const markerMat = new THREE.MeshStandardMaterial({ color: 0xffc454, emissive: 0x5c3300 });
      for (const x of [-43, 43]) {
        const marker = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.4), markerMat);
        marker.position.set(x, 31, 11.3); group.add(marker);
      }
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
      const context = canvas.getContext('2d'); context.fillStyle = '#163642'; context.fillRect(0, 0, 256, 128);
      context.fillStyle = '#ffe0a0'; context.font = 'bold 70px sans-serif'; context.textAlign = 'center'; context.fillText(String(index + 1).padStart(2, '0'), 128, 88);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 7.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
      sign.position.set(0, 43, 11.4); group.add(sign);
      this.group.add(group); return group;
    });
    // Shared skyline geometry/material. Fictional buildings, no copied map assets.
    const skyline = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xa1b0b4, roughness: 0.85 }), 160);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      const z = 1200 - Math.floor(i / 2) * 80;
      const x = riverCenter(z) + (i % 2 ? 1 : -1) * (580 + ((i * 73) % 450));
      const height = 18 + ((i * 47) % 100);
      matrix.compose(new THREE.Vector3(x, 8 + height / 2, z), new THREE.Quaternion(), new THREE.Vector3(25 + i % 20, height, 25));
      skyline.setMatrixAt(i, matrix);
    }
    skyline.castShadow = true; this.group.add(skyline);
    // Skyline is outside the mission corridor, which the run enforces.
  }
}
