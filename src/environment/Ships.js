import * as THREE from 'three';
import {
  createShipAssetLoader,
  createShipFallback,
  createWakeTexture,
  shipBounds
} from './ShipAssets.js';

/** Exterior GLBs live below stable motion roots; water physics stays in WaterOcean. */
export class Ships {
  constructor(water, { loadAsset = createShipAssetLoader(), random = Math.random, deferAssets = false } = {}) {
    this.water = water;
    this.group = new THREE.Group();
    this.vessels = [];
    this.speedboats = [];
    this.assetErrors = [];
    this.pending = [];
    this.assetsRequested = new Promise(resolve => { this.startAssets = resolve; });
    this.loadAsset = loadAsset;
    this.wakeTexture = createWakeTexture();
    this.wakeMaterial = new THREE.MeshBasicMaterial({
      map: this.wakeTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.addVessel('cargo', 800, 4200, 35);
    this.addVessel('cruise', -2400, 5500, -60);
    this.addVessel('tanker', 4500, 6500, 110);
    this.addSpeedboat(-500, 3200, 15, 1200, random() * Math.PI * 2);
    this.addSpeedboat(1500, 2800, 18, 900, random() * Math.PI * 2);
    this.update(0, 0);
    this.ready = Promise.all(this.pending);
    if (!deferAssets) this.loadAssets();
  }

  /** Keep motion/collision roots usable before requesting optional GLBs. */
  loadAssets() {
    this.startAssets();
    return this.ready;
  }

  addVisual(type, record) {
    const fallback = createShipFallback(type);
    record.bounds = shipBounds(fallback);
    record.mesh.add(fallback);
    record.visual = fallback;
    record.assetStatus = 'deferred';
    const updateDimensions = () => {
      const size = record.bounds.getSize(new THREE.Vector3());
      record.length = size.z;
      record.width = size.x;
      record.height = size.y;
    };
    updateDimensions();
    // Resolve errors per record so a failed download retains a collidable fallback.
    this.pending.push(
      this.assetsRequested
        .then(() => {
          record.assetStatus = 'loading';
          return this.loadAsset(type);
        })
        .then((model) => {
          const bounds = shipBounds(model);
          if (bounds.isEmpty()) throw new Error(`Empty ${type} model`);
          record.mesh.remove(fallback);
          fallback.traverse((n) => {
            if (n.isMesh) {
              n.geometry.dispose();
              n.material.dispose();
            }
          });
          record.bounds = bounds;
          updateDimensions();
          record.mesh.add(model);
          record.visual = model;
          record.assetStatus = 'loaded';
        })
        .catch((error) => {
          record.assetStatus = 'fallback';
          this.assetErrors.push({ type, message: error.message });
          console.warn(`Ship asset ${type}: retaining fallback`, error);
        })
    );
  }

  addVessel(type, x, z, heading) {
    const mesh = new THREE.Group();
    mesh.name = `ship-${type}`;
    mesh.rotation.order = 'YXZ';
    mesh.position.set(x, 0, z);
    mesh.rotation.y = THREE.MathUtils.degToRad(heading);
    const record = { type, mesh, basePos: mesh.position.clone() };
    this.addVisual(type, record);
    this.group.add(mesh);
    this.vessels.push(record);
  }

  addSpeedboat(cx, cz, speed, radius, angle) {
    const mesh = new THREE.Group();
    mesh.name = 'ship-speedboat';
    mesh.rotation.order = 'YXZ';
    const wakeGeometry = new THREE.PlaneGeometry(16, 50, 8, 24);
    wakeGeometry.rotateX(-Math.PI / 2);
    // UV y=0 is the narrow stern end; local +Z follows the widening wake.
    const uv = wakeGeometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const wake = new THREE.Mesh(wakeGeometry, this.wakeMaterial);
    wake.name = 'ship-wake';
    wake.renderOrder = 1;
    const record = { type: 'speedboat', mesh, cx, cz, speed, radius, angle, wake };
    this.addVisual('speedboat', record);
    this.group.add(mesh, wake);
    this.speedboats.push(record);
  }

  update(dt, totalTime) {
    for (const v of this.vessels) {
      const { x, z } = v.basePos,
        halfL = v.length * 0.4,
        yaw = v.mesh.rotation.y;
      const dx = Math.sin(yaw) * halfL,
        dz = Math.cos(yaw) * halfL;
      const bow = this.water.getWaveHeight(x - dx, z - dz, totalTime);
      const stern = this.water.getWaveHeight(x + dx, z + dz, totalTime);
      v.mesh.position.y = this.water.getWaveHeight(x, z, totalTime);
      v.mesh.rotation.x = Math.atan2(bow - stern, v.length) * 0.85;
      v.mesh.rotation.z = Math.sin(totalTime * 0.6 + x * 0.01) * 0.015;
    }
    for (const b of this.speedboats) {
      b.angle += (b.speed / b.radius) * dt;
      const x = b.cx + Math.cos(b.angle) * b.radius,
        z = b.cz + Math.sin(b.angle) * b.radius;
      b.mesh.position.set(x, this.water.getWaveHeight(x, z, totalTime) + 0.3, z);
      b.mesh.rotation.y = Math.PI - b.angle; // -Z bow follows the orbit's tangent.
      b.mesh.rotation.x = THREE.MathUtils.degToRad(6);
      // Wake is independent of pitch/roll and draped over the sampled water.
      const yaw = b.mesh.rotation.y,
        s = Math.sin(yaw),
        c = Math.cos(yaw);
      const aft = b.bounds.max.z + 25;
      b.wake.position.set(x + s * aft, 0, z + c * aft);
      b.wake.rotation.y = yaw;
      const positions = b.wake.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const lx = positions.getX(i),
          lz = positions.getZ(i);
        positions.setY(
          i,
          this.water.getWaveHeight(
            b.wake.position.x + c * lx + s * lz,
            b.wake.position.z - s * lx + c * lz,
            totalTime
          ) + 0.12
        );
      }
      positions.needsUpdate = true;
      b.wake.geometry.computeBoundingSphere();
    }
  }
}
