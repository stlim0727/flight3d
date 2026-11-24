/**
 * Paris showcase: the dedicated Eiffel Tower GLB seated on streamed terrain,
 * Pont d'Iéna's deck and the Seine quay steps. The same ground query positions
 * the visuals and builds their collision envelopes, so there is no separate
 * phantom-height source.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  EIFFEL_TOWER_HEIGHT_M, PARIS_SHOWCASE, isParisShowcaseOrigin,
} from '../config/parisShowcase.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';

export const EIFFEL_MODEL_URL = `${import.meta.env?.BASE_URL ?? '/'}models/landmarks/eiffel-tower.glb`;
export const EIFFEL_LOD_LEVELS = Object.freeze([
  Object.freeze({ name: 'EiffelNear', distance: 0 }),
  Object.freeze({ name: 'EiffelMid', distance: 800 }),
  Object.freeze({ name: 'EiffelFar', distance: 2200 }),
]);

let kitPromise;
export function loadEiffelKit() {
  return kitPromise ??= new GLTFLoader().loadAsync(EIFFEL_MODEL_URL).then(gltf => {
    validateEiffelKit(gltf.scene);
    return gltf.scene;
  }).catch(error => { kitPromise = undefined; throw error; });
}

export function validateEiffelKit(kit) {
  for (const { name } of EIFFEL_LOD_LEVELS) {
    if (!kit?.getObjectByName(name)) throw new Error(`Eiffel kit missing ${name}`);
  }
}

/** Near-to-far LOD; hysteresis keeps a level from flickering at its threshold. */
export function createEiffelTower(kit) {
  validateEiffelKit(kit);
  const lod = new THREE.LOD();
  lod.name = 'eiffel-tower';
  for (const { name, distance } of EIFFEL_LOD_LEVELS) {
    lod.addLevel(kit.getObjectByName(name).clone(true), distance, .1);
  }
  lod.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  return lod;
}

/**
 * Separate lower-leg and upper-structure envelopes. The open arch under the
 * tower has no solid, and the quay/bridge solids belong to the same list so a
 * low pass is judged against exactly what is drawn.
 */
export function eiffelCollisionSolids(base = { x: 0, y: 0, z: 0 }) {
  const solids = [];
  const tiers = [[0, 57, 4], [57, 115, 3], [115, 276, 5], [276, 300, 1]];
  const halfWidth = y => y <= 57 ? 62 - 47 * (y / 57)
    : y <= 115 ? 15 - 5 * ((y - 57) / 58)
      : y <= 276 ? 10 - 5 * ((y - 115) / 161)
        : 5 - 2.5 * ((y - 276) / 24);
  for (const [bottom, top, steps] of tiers) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let step = 0; step < steps; step++) {
        const y0 = bottom + (top - bottom) * step / steps;
        const y1 = bottom + (top - bottom) * (step + 1) / steps;
        const h = halfWidth((y0 + y1) / 2);
        solids.push({
          id: `leg-${sx}-${sz}-${y0}`,
          part: 'Eiffel Tower leg',
          center: [base.x + sx * h, base.y + (y0 + y1) / 2, base.z + sz * h],
          size: [11, y1 - y0 + 2, 11],
        });
      }
    }
  }
  // Follow the four visible arches; the passage beneath them stays open.
  const archCorner = y => {
    const h = halfWidth(y);
    return [[h, y, h], [-h, y, h], [-h, y, -h], [h, y, -h]];
  };
  const archSegments = 8;
  for (let face = 0; face < 4; face++) {
    const a = archCorner(8)[face], b = archCorner(8)[(face + 1) % 4];
    for (let step = 0; step < archSegments; step++) {
      const point = t => {
        const [ax, , az] = a, [bx, , bz] = b;
        return [ax * (1 - t) + bx * t, 8 + 24 * Math.sin(Math.PI * t), az * (1 - t) + bz * t];
      };
      const p0 = point(step / archSegments), p1 = point((step + 1) / archSegments);
      solids.push(solid(`arch-${face}-${step}`, 'Eiffel Tower arch',
        [base.x + (p0[0] + p1[0]) / 2, base.y + (p0[1] + p1[1]) / 2, base.z + (p0[2] + p1[2]) / 2],
        [Math.abs(p1[0] - p0[0]) + 6, Math.abs(p1[1] - p0[1]) + 6, Math.abs(p1[2] - p0[2]) + 6]));
    }
  }
  for (const [bottom, top, width, part] of [
    [59, 115, 28, 'tower shaft'],
    [116, 276, 16, 'upper tower'],
    [277, 300, 10, 'summit'],
    [300, EIFFEL_TOWER_HEIGHT_M, 2, 'antenna'],
  ]) {
    solids.push({
      id: part, part,
      center: [base.x, base.y + (bottom + top) / 2, base.z],
      size: [width, top - bottom, width],
    });
  }
  // Slab widths and thicknesses match the generator exactly; the deck edges
  // are solid so a low pass cannot fly through a visible platform.
  for (const [y, width, thickness] of [[57, 74, 3.2], [115, 46, 2.8], [276, 22, 1.8], [300, 12, 1.4]]) {
    solids.push(solid(`deck-${y}`, `observation deck at ${y} m`,
      [base.x, base.y + y, base.z], [width, thickness, width]));
  }
  return solids;
}

function solid(id, part, center, size) {
  return { id, part, center, size };
}

/** World-space boxes are rebuilt only from the same heights used for rendering. */
function boxFor(item) {
  const [x, y, z] = item.center;
  const [w, h, d] = item.size;
  return new THREE.Box3(
    new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
    new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
  );
}

export class ParisShowcase {
  constructor(kit, origin) {
    this.origin = origin;
    this.group = new THREE.Group();
    this.group.name = 'paris-showcase';
    this.tower = createEiffelTower(kit);
    this.tower.visible = false;
    this.group.add(this.tower);
    const material = new THREE.MeshStandardMaterial({ color: 0x8d8980, roughness: .82 });
    this.material = material;
    this.bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    this.bridge.name = 'pont-iena-deck';
    this.bridge.visible = false;
    this.bridge.castShadow = true;
    this.bridge.receiveShadow = true;
    this.group.add(this.bridge);
    this.quays = [-1, 1].map(side => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = `seine-quay-${side < 0 ? 'south' : 'north'}`;
      mesh.visible = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    });
    this.solids = [];
    this.boxes = [];
    this.ready = false;
  }

  /** Project the curated WGS84 anchors into whichever local origin is active. */
  anchors() {
    const at = ({ latitude, longitude }) => wgs84ToLocal(latitude, longitude, this.origin);
    return {
      tower: at(PARIS_SHOWCASE.tower),
      bridgeSouth: at({ latitude: 48.85889, longitude: 2.29222 }),
      bridgeNorth: at({ latitude: 48.86055, longitude: 2.29222 }),
    };
  }

  /** Returns false until the streamed tiles under the showcase have loaded. */
  place(terrain, streamedOnly = false) {
    const { tower, bridgeSouth, bridgeNorth } = this.anchors();
    // A custom-origin host returns 0 before its tiles load; only the rendered
    // tile sample is authoritative for seating, so nothing jumps at load time.
    const height = (x, z) => {
      const streamed = terrain?.openWorld?.sample?.(x, z)?.height;
      if (streamedOnly) return streamed;
      return Number.isFinite(streamed) ? streamed : terrain?.getHeight?.(x, z);
    };
    const towerGround = height(...tower);
    if (!Number.isFinite(towerGround)) return false;
    this.tower.position.set(tower[0], towerGround, tower[1]);
    this.tower.visible = true;
    this.towerSeat = [tower[0], towerGround, tower[1]];
    const solids = eiffelCollisionSolids({ x: tower[0], y: towerGround, z: tower[1] });

    const south = height(...bridgeSouth), north = height(...bridgeNorth);
    if (Number.isFinite(south) && Number.isFinite(north)) {
      const dx = bridgeNorth[0] - bridgeSouth[0], dz = bridgeNorth[1] - bridgeSouth[1];
      const length = Math.hypot(dx, dz);
      const deckY = Math.max(south, north) + 3.5;
      this.bridge.visible = true;
      this.bridge.position.set((bridgeSouth[0] + bridgeNorth[0]) / 2, deckY,
        (bridgeSouth[1] + bridgeNorth[1]) / 2);
      this.bridge.rotation.y = Math.atan2(dx, dz);
      this.bridge.scale.set(PARIS_SHOWCASE.bridge.widthM, PARIS_SHOWCASE.bridge.deckThicknessM, length);
      solids.push(solid('pont-iena', 'Pont d’Iéna deck', this.bridge.position.toArray(),
        [PARIS_SHOWCASE.bridge.widthM, PARIS_SHOWCASE.bridge.deckThicknessM + 1.2, length]));

      for (const [mesh, bankZ, ground] of [[this.quays[0], bridgeSouth[1], south],
        [this.quays[1], bridgeNorth[1], north]]) {
        const x = (bridgeSouth[0] + bridgeNorth[0]) / 2;
        mesh.visible = true;
        mesh.position.set(x, ground - 3, bankZ);
        mesh.scale.set(360, 6, 4);
        solids.push(solid(mesh.name, 'Seine quay wall', mesh.position.toArray(), [360, 6, 4]));
      }
    } else {
      this.bridge.visible = false;
      for (const quay of this.quays) quay.visible = false;
    }
    this.solids = solids;
    this.boxes = solids.map(boxFor);
    this.ready = true;
    return true;
  }

  update(sim) {
    if (!this.place(sim.currentTerrain, Boolean(sim.world?.customOrigin))) return;
    if (sim.camera?.isCamera) this.tower.update(sim.camera);
  }


  /** Suppress the generic Overture building mesh under the dedicated model. */
  excludes(x, z) {
    if (!this.towerSeat) return false;
    return Math.hypot(x - this.towerSeat[0], z - this.towerSeat[2])
      <= PARIS_SHOWCASE.tower.footprintRadiusM;
  }

  checkCollision(probes) {
    for (const probe of probes) {
      const radius = probe.radius ?? 0;
      for (let i = 0; i < this.boxes.length; i++) {
        const box = this.boxes[i];
        const nearest = box.clampPoint(probe.pos, _nearest);
        if (nearest.distanceToSquared(probe.pos) <= radius * radius) {
          return { point: probe.pos.clone(), part: this.solids[i].part };
        }
      }
    }
    return null;
  }

  dispose() {
    this.group.removeFromParent();
    // LOD children share the cached kit geometry; only owned meshes are disposed.
    this.bridge.geometry.dispose();
    for (const quay of this.quays) quay.geometry.dispose();
    this.material.dispose();
  }
}

const _nearest = new THREE.Vector3();

/** One showcase per active origin; created lazily so the GLB is only fetched in Paris. */
export function updateParisShowcase(sim) {
  const origin = sim.world?.customOrigin ?? null;
  const active = isParisShowcaseOrigin(origin);
  const current = sim.parisShowcase;
  const originChanged = Boolean(current && active && (
    Math.abs(current.origin.latitude - origin.latitude) > 1e-6
    || Math.abs(current.origin.longitude - origin.longitude) > 1e-6));
  if (current && (!active || originChanged || sim.currentTerrain?.mesh !== current.group.parent)) {
    current.dispose();
    sim.parisShowcase = null;
    if (sim.currentTerrain?.parisShowcase === current) delete sim.currentTerrain.parisShowcase;
  }
  if (!active || !sim.currentTerrain?.mesh) {
    sim.parisShowcasePending = null;
    return;
  }
  if (!sim.parisShowcase) {
    const clearPending = () => { sim.parisShowcasePending = null; };
    sim.parisShowcasePending ??= loadEiffelKit().then(kit => {
      if (!isParisShowcaseOrigin(sim.world?.customOrigin)) { clearPending(); return null; }
      const showcase = new ParisShowcase(kit, sim.world.customOrigin);
      sim.currentTerrain.mesh.add(showcase.group);
      sim.parisShowcase = showcase;
      sim.currentTerrain.parisShowcase = showcase;
      clearPending();
      // Rebuild streamed buildings so the generic tower gives way to the GLB.
      const buildings = sim.currentTerrain.geographicBuildingLayer;
      buildings?.dispose();
      if (sim.geographicBuildingLayer === buildings) sim.geographicBuildingLayer = null;
      sim.currentTerrain.geographicBuildingLayer = null;
      return showcase;
    }).catch(error => { clearPending(); console.warn('Paris showcase failed to load:', error); });
    return;
  }
  sim.parisShowcase.update(sim);
}
