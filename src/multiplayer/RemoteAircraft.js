import * as THREE from 'three';
import { AircraftBreakup } from '../effects/AircraftBreakup.js';
import { RemoteAircraftIndicator } from './RemoteAircraftIndicator.js';
import { createRemoteAircraftModel, disposeRemoteModel } from './RemoteAircraftModel.js';

/** Remote visual only: production aircraft assets, no physics or collision ownership. */
export class RemoteAircraft {
  constructor(scene, aircraft, { createModel = createRemoteAircraftModel,
    createIndicator = () => new RemoteAircraftIndicator(),
    createBreakup = s => new AircraftBreakup(s),
    terrain = null,
    explosionSystem = null,
    audio = null } = {}) {
    this.group = new THREE.Group(); this.group.name = 'MultiplayerGhost';
    this.scene = scene;
    this.terrain = terrain;
    this.explosionSystem = explosionSystem;
    this.audio = audio;
    this.breakup = createBreakup ? createBreakup(scene) : null;
    this.wasCrashed = false;
    this.model = createModel(aircraft);
    this.group.add(this.model.group);
    this.group.visible = false; scene.add(this.group);
    this.indicator = createIndicator();
    this.disposed = false;
    this.disposedResources = new Set();
    this.lastUpdate = performance.now();
    this.configureExterior();
    this.ready = Promise.resolve(this.model.ready).then(() => {
      if (this.disposed) {
        disposeRemoteModel(this.model.group, this.disposedResources);
        return;
      }
      this.configureExterior();
      this.breakup?.prepare(this.model);
      this.animate(this.group.userData.remote, 0);
    });
  }
  configureExterior() {
    this.model.setCockpitMode(false);
    // Remote navigation lamps remain visible, but do not add another set of
    // scene-illuminating lights and shadow maps on mobile.
    this.lights = [];
    this.model.group.traverse(node => { if (node.isLight) { node.visible = false; this.lights.push(node); } });
  }
  animate(sample, dt) {
    if (!sample) return;
    this.model.update(dt, { gearState: sample.gear, flapDegree: sample.flaps });
    for (const light of this.lights) light.visible = false;
  }
  update(sample, name, camera, { status = '', showIndicator = true, localPosition, cameraMode } = {}) {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(.1, Math.max(0, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;

    const isCrashed = Boolean(sample && sample.crashed);
    if (isCrashed) {
      if (!this.wasCrashed) {
        this.wasCrashed = true;
        const pos = new THREE.Vector3().fromArray(sample.p);
        const vel = new THREE.Vector3().fromArray(sample.v);
        const terrain = this.terrain;
        const terrainH = terrain?.getHeight?.(pos.x, pos.z) ?? 0;
        const waterLevel = terrain?.getWaterLevel?.(pos.x, pos.z) ?? 0.0;
        const isWater = (terrainH <= waterLevel + 2.5) && (pos.y <= waterLevel + 2.0);
        const crashType = isWater ? 'WATER' : 'TERRAIN';

        this.explosionSystem?.spawnExplosion({
          point: pos,
          type: crashType,
          speedKnots: vel.length() * 1.94384,
        }, vel);

        if (this.audio) {
          const dist = localPosition ? pos.distanceTo(localPosition) : undefined;
          this.audio.playRemoteExplosion?.(dist, isWater);
        }

        this.group.position.fromArray(sample.p);
        this.group.quaternion.fromArray(sample.q);
        this.group.updateMatrixWorld(true);
        this.breakup?.spawn(this.model, vel);
      }
      this.group.visible = false;
      this.indicator.hide();
      const waterLevel = this.terrain?.getWaterLevel?.(sample.p[0], sample.p[2]) ?? 0;
      this.breakup?.update(dt, this.terrain, waterLevel);
      return;
    }

    if (this.wasCrashed) {
      this.wasCrashed = false;
      this.breakup?.clear({ persist: true, duration: 30 });
    } else {
      this.breakup?.update(dt, this.terrain);
    }

    this.group.visible = Boolean(sample);
    if (!this.group.visible) {
      this.indicator.hide();
      return;
    }
    const previous = this.group.userData.remote;
    if (previous?.epoch !== sample.epoch || previous?.round !== sample.round
      || (previous && Math.hypot(...sample.p.map((value, i) => value - previous.p[i])) > 1000)) {
      this.indicator.hide();
    }
    this.group.position.fromArray(sample.p); this.group.quaternion.fromArray(sample.q);
    this.animate(sample, dt);
    this.group.userData.remote = sample;
    if (!showIndicator) {
      this.indicator.hide();
      return;
    }
    const distance = localPosition && !sample.stale ? this.group.position.distanceTo(localPosition) : undefined;
    this.indicator.update(this.group.position, name, status, camera, { distance, cameraMode });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.breakup?.disposePrepared?.();
    this.group.removeFromParent(); this.indicator?.dispose?.();
    disposeRemoteModel(this.model.group, this.disposedResources);
  }
}
