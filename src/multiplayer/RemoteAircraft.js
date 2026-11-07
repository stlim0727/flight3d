import * as THREE from 'three';
import { RemoteAircraftIndicator } from './RemoteAircraftIndicator.js';
import { createRemoteAircraftModel, disposeRemoteModel } from './RemoteAircraftModel.js';

/** Remote visual only: production aircraft assets, no physics or collision ownership. */
export class RemoteAircraft {
  constructor(scene, aircraft, { createModel = createRemoteAircraftModel,
    createIndicator = () => new RemoteAircraftIndicator() } = {}) {
    this.group = new THREE.Group(); this.group.name = 'MultiplayerGhost';
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
    this.group.visible = Boolean(sample && !sample.crashed);
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
    this.group.removeFromParent(); this.indicator.dispose();
    disposeRemoteModel(this.model.group, this.disposedResources);
  }
}
