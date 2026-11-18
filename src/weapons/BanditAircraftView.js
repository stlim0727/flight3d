import * as THREE from 'three';
import { F16 } from '../aircraft/F16.js';
import { createBanditMesh, banditSkin } from './missileGeometry.js';

const PLANE_NORMAL = new THREE.Vector3(0, 0, 1);

function findAirframeMesh(gltfGroup) {
  let found = null;
  gltfGroup.traverse(node => {
    if (!found && node.isMesh && node.name.startsWith('F-16-airframe')) found = node;
  });
  return found;
}

/** Average position of the vertices closest to one bounding-box extreme. */
function extremeAnchor(mesh, axis, sign) {
  const position = mesh.geometry.attributes.position;
  const box = mesh.geometry.boundingBox;
  const min = axis === 'x' ? box.min.x : box.min.y;
  const max = axis === 'x' ? box.max.x : box.max.y;
  const limit = sign > 0 ? max : min;
  const tolerance = (max - min) * 0.01;
  const anchor = new THREE.Vector3();
  let count = 0;
  for (let index = 0; index < position.count; index++) {
    const value = axis === 'x' ? position.getX(index) : position.getY(index);
    if (Math.abs(value - limit) > tolerance) continue;
    anchor.x += position.getX(index);
    anchor.y += position.getY(index);
    anchor.z += position.getZ(index);
    count++;
  }
  return count ? anchor.multiplyScalar(1 / count) : null;
}

/**
 * Nose-side anchor for the slot number. The F-16 skin is one merged mesh, so
 * sample the vertices in a slim band around the nose to find the outer surface
 * instead of guessing a radius.
 */
function noseSideAnchor(mesh, side, size) {
  const position = mesh.geometry.attributes.position;
  const targetZ = size.z * 0.14;
  const zTolerance = size.z * 0.04;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumZ = 0;
  let count = 0;
  // The bounding box includes the tall fin, so the aircraft's vertical centre is
  // not the nose centre. Sample the nose band itself to find its true middle.
  for (let index = 0; index < position.count; index++) {
    const z = position.getZ(index) - mesh.geometry.boundingBox.min.z;
    if (Math.abs(z - targetZ) > zTolerance) continue;
    const y = position.getY(index);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumZ += z;
    count++;
  }
  if (!count) return null;
  const y = (minY + maxY) * 0.5;
  const z = sumZ / count + mesh.geometry.boundingBox.min.z;
  const yTolerance = Math.max((maxY - minY) * 0.22, size.z * 0.008);
  let surfaceX = null;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    if (Math.abs(position.getY(index) - y) > yTolerance
      || Math.abs(position.getZ(index) - z) > zTolerance) continue;
    if (surfaceX === null || side * x > side * surfaceX) surfaceX = x;
  }
  if (surfaceX === null) return null;
  return { x: surfaceX + side * size.z * 0.004, y, z };
}

/**
 * `bindGltfControlSurfaces()` splits elevators, flaperons and the rudder into
 * unnamed child meshes before the skin is painted. They share the parent
 * material, so paint the whole mesh tree with one cloned material instead of
 * leaving the moving surfaces in the player's original gray.
 */
function tintMeshTree(mesh, tint) {
  if (!mesh?.isMesh || !mesh.material || Array.isArray(mesh.material)) return;
  const material = mesh.material.clone();
  material.color.copy(tint);
  mesh.traverse(node => {
    if (node.isMesh && !Array.isArray(node.material)) node.material = material;
  });
}

function numberTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '900 104px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(8, 10, 12, 0.92)';
  ctx.strokeText(number, canvas.width / 2, canvas.height / 2 + 4);
  ctx.fillStyle = '#f4f7f2';
  ctx.fillText(number, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

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
    const { body, trim, number, scale } = banditSkin(this.callsign);
    this.airframe.group.scale.set(scale[0], scale[1], scale[2]);
    // Repaint the exterior skin and its moving surfaces, plus the empty weapon
    // rails. Canopy, HUD and landing lights keep their own materials.
    const tint = new THREE.Color(body);
    const gltfGroup = this.airframe.gltfGroup ?? this.airframe.group;
    tintMeshTree(findAirframeMesh(gltfGroup), tint);
    const rails = this.airframe.gltfGroup?.getObjectByName('F-16-rails_8');
    if (rails) tintMeshTree(rails, tint);
    if (typeof document === 'undefined' || !this.airframe.gltfGroup) return;
    this._addIdentificationMarks(trim, number);
  }

  /** Wingtips and fin tip carry the accent; the nose carries the slot number. */
  _addIdentificationMarks(trim, number) {
    const parent = this.airframe.gltfGroup;
    const airframe = findAirframeMesh(parent);
    if (!airframe) return;
    airframe.geometry.computeBoundingBox();
    const box = airframe.geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const marks = new THREE.Group();
    marks.name = `BanditMarks_${this.callsign}`;
    const markMaterial = new THREE.MeshStandardMaterial({
      color: trim, roughness: 0.45, metalness: 0.15,
      emissive: trim, emissiveIntensity: 0.12,
    });

    const pod = new THREE.BoxGeometry(size.z * 0.018, size.y * 0.03, size.z * 0.06);
    for (const side of [-1, 1]) {
      const anchor = extremeAnchor(airframe, 'x', side);
      if (!anchor) continue;
      const marker = new THREE.Mesh(pod, markMaterial);
      marker.position.copy(anchor);
      marks.add(marker);
    }
    const tail = extremeAnchor(airframe, 'y', 1);
    if (tail) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(size.x * 0.03, size.y * 0.025, size.z * 0.05),
        markMaterial,
      );
      cap.position.copy(tail);
      marks.add(cap);
    }

    const texture = numberTexture(number);
    const numberMaterial = new THREE.MeshStandardMaterial({
      map: texture, transparent: true, alphaTest: 0.08, roughness: 0.6, metalness: 0.1,
      depthWrite: false,
    });
    numberMaterial.userData.banditOwnedMap = true;
    const plane = new THREE.PlaneGeometry(size.z * 0.045, size.z * 0.05);
    for (const side of [-1, 1]) {
      const anchor = noseSideAnchor(airframe, side, size);
      if (!anchor) continue;
      const badge = new THREE.Mesh(plane, numberMaterial);
      badge.position.set(anchor.x, anchor.y, anchor.z);
      badge.quaternion.setFromUnitVectors(PLANE_NORMAL, new THREE.Vector3(side, 0, 0));
      marks.add(badge);
    }
    parent.add(marks);
  }

  update(dt, flight) {
    const throttle = flight?.controls?.throttle ?? flight?.throttle ?? 0.85;
    const engine1 = flight?.engines
      ? {
          n1: flight.engines.n1?.[0] ?? (throttle * 100),
          thrust: flight.engines.thrust?.[0] ?? (15000 * throttle),
          failed: Boolean(flight.engines.failed?.[0]),
        }
      : (flight?.engine1 ?? { n1: throttle * 100, thrust: 15000 * throttle, failed: false });
    this.airframe?.update(dt, {
      gearState: 0,
      elevator: flight?.aero?.elevator ?? flight?.elevator ?? 0,
      aileron: flight?.aero?.aileron ?? flight?.aileron ?? 0,
      rudder: flight?.aero?.rudder ?? flight?.rudder ?? 0,
      throttle,
      engine1,
    });
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
    for (const item of materials) {
      if (item.userData?.banditOwnedMap) item.map?.dispose();
      item.dispose();
    }
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
