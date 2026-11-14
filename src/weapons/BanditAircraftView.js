import * as THREE from 'three';
import { F16 } from '../aircraft/F16.js';
import { createBanditMesh, banditSkin } from './missileGeometry.js';

/** The same exterior asset as the player; a procedural proxy covers loading. */
export class BanditAircraftView {
  constructor(callsign) {
    this.callsign = callsign;
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
          this._skinAirframe();
          this.proxy.visible = false;
          this.mesh.add(this.airframe.group);
        }
      });
    }
  }

  /**
   * The proxy is only a placeholder, so the callsign shape and color must survive the swap to
   * the loaded F-16 or every bandit renders as the player's airframe (#722).
   */
  _skinAirframe() {
    const { trim, scale } = banditSkin(this.callsign);
    this.airframe.group.scale.set(scale[0], scale[1], scale[2]);
    if (trim === 0xd07b32) return;
    const tint = new THREE.Color(trim);
    this.airframe.group.traverse(node => {
      if (!node.material) return;
      const materials = [].concat(node.material).map(material => {
        const clone = material.clone();
        clone.color?.multiply(tint);
        return clone;
      });
      node.material = Array.isArray(node.material) ? materials : materials[0];
    });
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
