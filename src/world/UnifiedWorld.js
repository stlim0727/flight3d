import * as THREE from 'three';
import { jejuToIncheonLocal } from '../geospatial/CorridorCoordinateSystem.js';

/**
 * One always-present world for the three real-world airports.
 *
 * The simulator used to swap its whole scene in PresetSpawner.setAirport():
 * only the selected region's meshes were visible and a single mutable
 * currentTerrain/currentAirport pair was rebound. That made a flight from
 * Incheon to Jeju or Lukla impossible — the destination had no mesh and no
 * contact surface.
 *
 * World coordinates are the Incheon local tangent plane (+X east, +Z south,
 * metres). Each region keeps its own authoring frame: regions are translated
 * into the world frame instead of rebasing their geometry. The anchor region
 * is the spawn region, so existing scenario/director code still works in its
 * own local frame; switching the anchor only translates the other regions.
 */

const JEJU_IN_INCHEON = jejuToIncheonLocal(0, 0);

// Phase 1 placement: Incheon <-> Jeju uses the surveyed WGS84 separation.
// Lukla has no WGS84 frame in the simulator yet, so it is placed a flyable
// distance south of Jeju. Replacing this with surveyed coordinates is a
// data-only change to BASE_OFFSETS.
const LUKLA_SOUTH_OF_JEJU_M = 260000;

export const BASE_OFFSETS = Object.freeze({
  incheon: Object.freeze([0, 0]),
  jeju: Object.freeze([JEJU_IN_INCHEON[0], JEJU_IN_INCHEON[1]]),
  lukla: Object.freeze([JEJU_IN_INCHEON[0], JEJU_IN_INCHEON[1] + LUKLA_SOUTH_OF_JEJU_M]),
});

export const WORLD_REGIONS = Object.freeze(Object.keys(BASE_OFFSETS));

// Extents in each region's own local frame. Jeju's north edge includes the
// Chuja emergency strip at roughly (-18300, -50008), which is rendered by
// JejuAirport but lies far outside the island's main terrain box.
export const REGION_EXTENTS = Object.freeze({
  incheon: Object.freeze({ minX: -7000, maxX: 22000, minZ: -7000, maxZ: 22000 }),
  jeju: Object.freeze({ minX: -30000, maxX: 45000, minZ: -54000, maxZ: 45000 }),
  lukla: Object.freeze({ minX: -22000, maxX: 22000, minZ: -22000, maxZ: 22000 }),
});

const _normal = new THREE.Vector3();

export class UnifiedWorld {
  constructor(anchor = 'incheon') {
    this.regions = new Map();
    this.anchor = BASE_OFFSETS[anchor] ? anchor : 'incheon';
    this.offsets = new Map();
    this.recomputeOffsets();
  }

  /** Physics and demo flights must wait while the spawn region's DEM is loading. */
  get isLoaded() {
    const region = this.regions.get(this.anchor);
    return region ? region.terrain.isLoaded !== false : true;
  }

  get anchorTerrain() {
    return this.regions.get(this.anchor)?.terrain;
  }

  // The open-world terrain and geographic building layers attach their groups
  // to surface.mesh and keep state on the terrain object. Preserve that
  // contract while physics queries go through this dispatcher.
  get mesh() { return this.anchorTerrain?.mesh ?? null; }
  get region() { return this.anchorTerrain?.region; }
  get size() { return this.anchorTerrain?.size; }
  get openWorld() { return this.anchorTerrain?.openWorld; }
  set openWorld(value) { if (this.anchorTerrain) this.anchorTerrain.openWorld = value; }
  get geographicBuildingLayer() { return this.anchorTerrain?.geographicBuildingLayer; }
  set geographicBuildingLayer(value) { if (this.anchorTerrain) this.anchorTerrain.geographicBuildingLayer = value; }
  get corridorStreamer() { return this.anchorTerrain?.corridorStreamer; }
  set corridorStreamer(value) { if (this.anchorTerrain) this.anchorTerrain.corridorStreamer = value; }

  /** extent: {minX, maxX, minZ, maxZ} in the region's own local frame. */
  register(id, { terrain, airport, group = null, mesh = null, extent }) {
    if (!BASE_OFFSETS[id]) throw new Error(`Unknown unified region: ${id}`);
    if (!terrain || !extent) throw new Error(`Unified region ${id} needs terrain and extent`);
    this.regions.set(id, { terrain, airport, group, mesh, extent });
    this.syncMeshes();
    return this;
  }

  recomputeOffsets() {
    const anchor = BASE_OFFSETS[this.anchor];
    for (const [id, base] of Object.entries(BASE_OFFSETS)) {
      this.offsets.set(id, [base[0] - anchor[0], base[1] - anchor[1]]);
    }
    this.syncMeshes();
  }

  setAnchor(id) {
    if (!BASE_OFFSETS[id]) return false;
    this.anchor = id;
    this.recomputeOffsets();
    return true;
  }

  /** Keep every registered region visible, translated into the current frame. */
  syncMeshes() {
    for (const [id, region] of this.regions) {
      const [x, z] = this.offsets.get(id);
      region.group?.position.set(x, 0, z);
      region.mesh?.position.set(x, 0, z);
      if (region.group) region.group.visible = true;
      if (region.mesh) region.mesh.visible = true;
    }
  }

  local(id, x, z) {
    const [ox, oz] = this.offsets.get(id);
    return [x - ox, z - oz];
  }

  regionAt(x, z) {
    for (const [id, region] of this.regions) {
      const [lx, lz] = this.local(id, x, z);
      const e = region.extent;
      if (lx >= e.minX && lx <= e.maxX && lz >= e.minZ && lz <= e.maxZ) {
        return { id, x: lx, z: lz, region };
      }
    }
    return null;
  }

  /** Physics ground query: sea level outside every registered region. */
  getHeight(x, z) {
    const hit = this.regionAt(x, z);
    if (!hit) return 0;
    return hit.region.terrain.getHeight(hit.x, hit.z) ?? 0;
  }

  getNormal(x, z) {
    const hit = this.regionAt(x, z);
    if (!hit) return _normal.set(0, 1, 0);
    if (hit.region.terrain.getNormal) return hit.region.terrain.getNormal(hit.x, hit.z);
    const eps = 1;
    return _normal.set(
      this.getHeight(hit.x - eps, hit.z) - this.getHeight(hit.x + eps, hit.z),
      2 * eps,
      this.getHeight(hit.x, hit.z - eps) - this.getHeight(hit.x, hit.z + eps),
    ).normalize();
  }

  getWaterLevel() {
    return 0;
  }

  isOnRunway(x, z) {
    const hit = this.regionAt(x, z);
    return Boolean(hit?.region.airport?.isOnRunway?.(hit.x, hit.z));
  }

  isRunwaySafetyArea(x, z) {
    const hit = this.regionAt(x, z);
    return Boolean(hit?.region.airport?.isRunwaySafetyArea?.(hit.x, hit.z));
  }

  nightLightingUpdate(sunY) {
    for (const { airport } of this.regions.values()) {
      airport?.nightLighting?.update?.(sunY);
    }
  }
}
