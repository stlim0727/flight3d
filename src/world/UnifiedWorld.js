import * as THREE from 'three';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';
import { haversineDistanceM, initialBearingDeg } from '../geospatial/CorridorCoordinateSystem.js';
import { REAL_AIRPORTS, RUNWAY_THRESHOLDS, worldPositionToWgs84, realOffsetInIncheonFrame } from '../geospatial/airportGeodesy.js';

/**
 * One always-present world for every persistent region: coastal, Incheon,
 * Jeju, Lukla and Neon Metropolis. The lobby airport only picks a spawn
 * anchor; the generated valley remains a mission-mounted overlay.
 *
 * The simulator used to swap its whole scene in PresetSpawner.setAirport():
 * only the selected region's meshes were visible and a single mutable
 * currentTerrain/currentAirport pair was rebound. That made a flight from
 * Incheon to Jeju or Lukla impossible — the destination had no mesh and no
 * contact surface.
 *
 * World coordinates use the Incheon scenery patch origin, which is the frame
 * of the rendered terrain, open-world tiles and the flight surface.
 * Each region keeps its own authoring frame: regions are translated
 * into the world frame instead of rebasing their geometry. The anchor region
 * is the spawn region, so existing scenario/director code still works in its
 * own local frame; switching the anchor only translates the other regions.
 */

const JEJU_IN_INCHEON = projectToLocal(JEJU_ORIGIN.latitude, JEJU_ORIGIN.longitude);

// Region placement: Incheon <-> Jeju uses the surveyed WGS84 separation; Lukla
// sits a flyable distance south of Jeju. Arcade regions have no WGS84 frame,
// so they are separated in the same world instead of sharing the origin.
const LUKLA_SOUTH_OF_JEJU_M = 260000;

export const BASE_OFFSETS = Object.freeze({
  incheon: Object.freeze([0, 0]),
  jeju: Object.freeze([JEJU_IN_INCHEON[0], JEJU_IN_INCHEON[1]]),
  lukla: Object.freeze([JEJU_IN_INCHEON[0], JEJU_IN_INCHEON[1] + LUKLA_SOUTH_OF_JEJU_M]),
  coastal: Object.freeze([-80000, -60000]),
  neon: Object.freeze([80000, -60000]),
  valley: Object.freeze([0, -180000]),
});

export const WORLD_REGIONS = Object.freeze(Object.keys(BASE_OFFSETS));

// Extents in each region's own local frame. Jeju's north edge includes the
// Chuja emergency strip at roughly (-18300, -50008), which is rendered by
// JejuAirport but lies far outside the island's main terrain box.
export const REGION_EXTENTS = Object.freeze({
  incheon: Object.freeze({ minX: -7000, maxX: 22000, minZ: -7000, maxZ: 22000 }),
  jeju: Object.freeze({ minX: -30000, maxX: 45000, minZ: -54000, maxZ: 45000 }),
  lukla: Object.freeze({ minX: -22000, maxX: 22000, minZ: -22000, maxZ: 22000 }),
  coastal: Object.freeze({ minX: -12000, maxX: 12000, minZ: -12000, maxZ: 12000 }),
  neon: Object.freeze({ minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 }),
  valley: Object.freeze({ minX: -30000, maxX: 30000, minZ: -30000, maxZ: 30000 }),
});

export const REGION_NAME_KEYS = Object.freeze({
  coastal: 'coastal.airport',
  incheon: 'incheon.airport',
  jeju: 'jeju.airport',
  lukla: 'lukla.vnlk',
  neon: 'neon.metropolis',
  valley: 'valley.region',
});

export const REGION_CODES = Object.freeze({
  coastal: 'CST', incheon: 'ICN', jeju: 'CJU',
  lukla: 'LUK', neon: 'NEO', valley: 'VAL',
});

const _normal = new THREE.Vector3();
const _camera = new THREE.Vector3();

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
  get geometry() { return this.anchorTerrain?.geometry; }
  get localTerraceGeometry() { return this.anchorTerrain?.localTerraceGeometry; }
  get segments() { return this.anchorTerrain?.segments; }
  getNaturalHeight(x, z) {
    return this.anchorTerrain?.getNaturalHeight?.(x, z) ?? this.getHeight(x, z);
  }
  get loadError() { return this.anchorTerrain?.loadError; }
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

  /** Camera position in the coastal authoring frame, for foliage/city LOD. */
  coastalLocalCamera(cameraPosition) {
    const [ox, oz] = this.offsets.get('coastal');
    return _camera.set(cameraPosition.x - ox, cameraPosition.y, cameraPosition.z - oz);
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

  /** i18n key for the region under a world position, or null over open sea. */
  regionNameKey(x, z) {
    const hit = this.regionAt(x, z);
    return hit ? REGION_NAME_KEYS[hit.id] ?? null : null;
  }


  /** Short code for the region under a world position, for compact HUD readouts. */
  regionCode(x, z) {
    const hit = this.regionAt(x, z);
    return hit ? REGION_CODES[hit.id] ?? null : null;
  }

  /** Bearing and distance from a world position to another airport's approach threshold. */
  destinationInfo(x, z, id) {
    const target = BASE_OFFSETS[id];
    if (!target) return null;
    const anchor = BASE_OFFSETS[this.anchor];
    const dx = target[0] - anchor[0] - x;
    const dz = target[1] - anchor[1] - z;
    const planarDistanceM = Math.hypot(dx, dz);
    const threshold = RUNWAY_THRESHOLDS[id];
    const from = worldPositionToWgs84(this.anchor, x, z);
    const realOffset = realOffsetInIncheonFrame(id);
    const placementIsReal = realOffset
      && Math.hypot(target[0] - realOffset[0], target[1] - realOffset[1]) < 5;
    const synthetic = this.anchor !== 'incheon' || !REAL_AIRPORTS.includes(id)
      || !placementIsReal || !from || !threshold;
    const distanceM = synthetic
      ? planarDistanceM
      : haversineDistanceM(from.latitude, from.longitude, threshold.latitude, threshold.longitude);
    const bearingDeg = synthetic
      ? (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360
      : initialBearingDeg(from.latitude, from.longitude, threshold.latitude, threshold.longitude);
    return {
      id,
      code: REGION_CODES[id],
      nameKey: REGION_NAME_KEYS[id],
      dx, dz,
      distanceM,
      distanceNm: distanceM / 1852,
      bearingDeg,
      synthetic,
      target: synthetic ? 'centre' : 'threshold',
    };
  }
  /** Ground query: region surface when inside one, streamed DEM or anchor surface outside. */
  getHeight(x, z) {
    const hit = this.regionAt(x, z);
    if (!hit) {
      const terrain = this.anchorTerrain;
      const streamed = terrain?.openWorld?.sample?.(x, z)?.height;
      if (Number.isFinite(streamed)) return streamed;
      return terrain?.getHeight?.(x, z) ?? 0;
    }
    return hit.region.terrain.getHeight(hit.x, hit.z) ?? 0;
  }

  getNormal(x, z) {
    const hit = this.regionAt(x, z);
    if (hit && hit.region.terrain.getNormal) return hit.region.terrain.getNormal(hit.x, hit.z);
    // Outside an authored region, differentiate the same height query physics
    // uses so streamed DEM slopes are not reported as a flat surface.
    const eps = 1;
    return _normal.set(
      this.getHeight(x - eps, z) - this.getHeight(x + eps, z),
      2 * eps,
      this.getHeight(x, z - eps) - this.getHeight(x, z + eps),
    ).normalize();
  }

  getWaterLevel(x, z) {
    const hit = this.regionAt(x, z);
    const terrain = hit?.region.terrain ?? this.anchorTerrain;
    const lx = hit ? hit.x : x;
    const lz = hit ? hit.z : z;
    const streamed = terrain?.openWorld?.sample?.(lx, lz);
    if (streamed) return streamed.water ? streamed.height : -10000;
    return terrain?.getWaterLevel?.(lx, lz) ?? 0;
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
