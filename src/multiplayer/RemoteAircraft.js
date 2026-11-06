import * as THREE from 'three';

/** Lightweight remote-only silhouette; never registered with physics or collisions. */
export class RemoteAircraft {
  constructor(scene, aircraft) {
    this.group = new THREE.Group(); this.group.name = 'MultiplayerGhost';
    const [length, span, width] = { C172: [8.3, 11, 1.2], B738: [39.5, 35.8, 3.8], F16: [15, 10, 1.5] }[aircraft];
    const material = new THREE.MeshStandardMaterial({ color: 0x67d8f0, roughness: .65 });
    const add = (geometry, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z);
      mesh.castShadow = true; this.group.add(mesh); return mesh;
    };
    const body = add(new THREE.CylinderGeometry(width * .3, width * .45, length, 10), 0, 0, 0);
    body.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(span, .16 * width, length * .13), 0, aircraft === 'C172' ? width * .5 : 0, 0);
    add(new THREE.BoxGeometry(span * .35, width * .12, length * .09), 0, width * .15, length * .38);
    add(new THREE.BoxGeometry(width * .15, length * .15, length * .14), 0, length * .065, length * .38);
    const canopy = add(new THREE.SphereGeometry(width * .5, 12, 8), 0, width * .3, -length * .2);
    canopy.scale.set(1, .8, 1.7);
    this.gear = new THREE.Group(); this.group.add(this.gear);
    for (const [x, z] of [[-width * .7, length * .05], [width * .7, length * .05], [0, -length * .3]]) {
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(width * .2, 8, 6), material);
      wheel.position.set(x, -width * .7, z); this.gear.add(wheel);
    }
    this.group.visible = false; scene.add(this.group);
    this.label = document.createElement('div'); this.label.className = 'mp-nameplate';
    this.label.hidden = true; document.body.append(this.label);
  }
  update(sample, name, camera) {
    this.group.visible = Boolean(sample && !sample.crashed);
    this.label.hidden = !this.group.visible;
    if (!this.group.visible) return;
    this.group.position.fromArray(sample.p); this.group.quaternion.fromArray(sample.q);
    this.gear.visible = sample.gear > .5;
    const projected = this.group.position.clone().add(new THREE.Vector3(0, 10, 0)).project(camera);
    this.label.hidden = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
    this.label.style.left = `${(projected.x * .5 + .5) * innerWidth}px`;
    this.label.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
    this.label.textContent = name;
    this.group.userData.remote = sample;
  }
  dispose() {
    this.group.removeFromParent(); this.label.remove();
    const materials = new Set();
    this.group.traverse(o => { o.geometry?.dispose(); if (o.material) materials.add(o.material); });
    materials.forEach(m => m.dispose());
  }
}
