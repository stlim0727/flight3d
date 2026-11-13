import * as THREE from 'three';
import { F16 } from '../aircraft/F16.js';
import { createBanditMesh } from './missileGeometry.js';

/** The same exterior asset as the player; a procedural proxy covers loading. */
export class BanditAircraftView {
  constructor(callsign) {
    this.mesh = new THREE.Group();
    this.mesh.name = `Bandit_${callsign}`;
    this.proxy = createBanditMesh(callsign);
    this.mesh.add(this.proxy);
    this.disposed = false;
    // Pure-state/replay Node tests do not fetch browser assets.
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.airframe = new F16({ exteriorOnly: true });
      this.airframe.setMissileLoadout([]);
      this.airframe.ready.then(() => {
        if (this.disposed) return this.disposeAirframe();
        if (this.airframe.modelLoaded) {
          this.airframe.update(0, { gearState: 0 });
          this.proxy.visible = false;
          this.mesh.add(this.airframe.group);
        }
      });
    }
  }

  update(dt, flight) {
    this.airframe?.update(dt, { gearState: 0, elevator: flight?.aero.elevator ?? 0,
      aileron: flight?.aero.aileron ?? 0, rudder: flight?.aero.rudder ?? 0 });
  }

  disposeAirframe() {
    // Missile materials are shared by procedural weapons; GLB materials are owned.
    const shared = new Set();
    this.airframe.missilesGroup.traverse(node => {
      if (node.material) shared.add(node.material);
    });
    const geometry = new Set(), materials = new Set();
    this.airframe.group.traverse(node => {
      if (node.geometry) geometry.add(node.geometry);
      for (const material of [].concat(node.material ?? [])) {
        if (!shared.has(material)) materials.add(material);
      }
    });
    for (const item of geometry) item.dispose();
    for (const item of materials) item.dispose();
    this.airframe.group.removeFromParent();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.proxy.traverse(node => node.geometry?.dispose());
    if (this.airframe && !this.airframe.loadingGltf) this.disposeAirframe();
  }
}
