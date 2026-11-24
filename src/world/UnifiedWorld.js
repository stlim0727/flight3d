import * as THREE from 'three';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';
import { haversineDistanceM, initialBearingDeg } from '../geospatial/CorridorCoordinateSystem.js';
import { REAL_AIRPORTS, AIRPORT_ORIGINS, RUNWAY_THRESHOLDS, worldPositionToWgs84, realOffsetInIncheonFrame } from '../geospatial/airportGeodesy.js';
import { isExternalDestination } from '../config/externalDestinations.js';
import { APPROACH_DATA } from '../config/approachData.js';

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

// Region placement: Incheon/Jeju/Lukla use surveyed WGS84 origins projected
// into the Incheon scenery frame. Arcade regions have no WGS84 frame, so
// they are separated in the same world instead of sharing an origin.
const LUKLA_IN_INCHEON = projectToLocal(AIRPORT_ORIGINS.lukla.latitude, AIRPORT_ORIGINS.lukla.longitude);

export const BASE_OFFSETS = Object.freeze({
  incheon: Object.freeze([0, 0]),
  jeju: Object.freeze([JEJU_IN_INCHEON[0], JEJU_IN_INCHEON[1]]),
  lukla: Object.freeze([LUKLA_IN_INCHEON[0], LUKLA_IN_INCHEON[1]]),
  coastal: Object.freeze([-80000, -60000]),
  neon: Object.freeze([80000, -60000]),
  valley: Object.freeze([0, -180000]),
});

export const WORLD_REGIONS = Object.freeze(Object.keys(BASE_OFFSETS));

// Extents in each region's own local frame. Jeju's north edge includes the
// Chuja emergency strip at roughly (-18300, -50008), rendered by the common
// open-world anchor surface.
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

function sameOrigin(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;
}

function createCustomTerrainHost() {
  const mesh = new THREE.Group();
  mesh.name = 'Custom origin open-world host';
  return {
    mesh,
    isLoaded: true,
    openWorld: null,
    geographicBuildingLayer: null,
    geographicRoadLayer: null,
    geographicGreenLayer: null,
    getHeight() { return 0; },
    getNaturalHeight() { return 0; },
    getWaterLevel() { return 0; },
  };
}

export class UnifiedWorld {
  constructor(anchor = 'incheon') {
    this.regions = new Map();
    this.anchor = BASE_OFFSETS[anchor] ? anchor : 'incheon';
    this.customOrigin = null;
    this.customTerrain = null;
    this.offsets = new Map();
    this.dynamicOffsets = new Map();
    this.destinationOffsets = new Map();
    this.dynamicStatus = new Map();
    this.recomputeOffsets();
  }

  /** Physics and demo flights must wait while the spawn region's DEM is loading. */
  get isLoaded() {
    if (this.customOrigin) return true;
    const region = this.regions.get(this.anchor);
    return region ? region.terrain.isLoaded !== false : true;
  }

  get anchorTerrain() {
    if (this.customOrigin && this.customTerrain) return this.customTerrain;
    return this.regions.get(this.anchor)?.terrain;
  }

  get activeOrigin() {
    return this.customOrigin ?? AIRPORT_ORIGINS[this.anchor] ?? null;
  }

  /**
   * Switch to a local WGS84 tangent plane for distant global map starts so
   * tiles and streamed runways stay distortion-free near (0, 0). Pass null to
   * restore the built-in anchor frame.
   */
  setCustomOrigin(origin, scene = null) {
    const next = origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
      ? Object.freeze({ latitude: origin.latitude, longitude: origin.longitude })
      : null;
    if (sameOrigin(this.customOrigin, next)) {
      if (next && this.customTerrain && scene && !this.customTerrain.mesh.parent) {
        scene.add(this.customTerrain.mesh);
      }
      return false;
    }
    if (this.customTerrain) {
      this.customTerrain.openWorld?.dispose?.();
      this.customTerrain.geographicBuildingLayer?.dispose?.();
      this.customTerrain.geographicRoadLayer?.dispose?.();
      this.customTerrain.geographicGreenLayer?.dispose?.();
      this.customTerrain.openWorld = null;
      this.customTerrain.geographicBuildingLayer = null;
      this.customTerrain.geographicRoadLayer = null;
      this.customTerrain.geographicGreenLayer = null;
    }
    this.customOrigin = next;
    this.destinationOffsets.clear();
    if (next) {
      this.customTerrain ??= createCustomTerrainHost();
      if (scene && !this.customTerrain.mesh.parent) scene.add(this.customTerrain.mesh);
    } else if (this.customTerrain?.mesh) {
      this.customTerrain.mesh.removeFromParent();
    }
    this.recomputeOffsets();
    return true;
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
  get airportMesh() { return this.anchorTerrain?.airportMesh ?? null; }
  get geographicBuildingLayer() { return this.anchorTerrain?.geographicBuildingLayer; }
  set geographicBuildingLayer(value) { if (this.anchorTerrain) this.anchorTerrain.geographicBuildingLayer = value; }
  get corridorStreamer() { return this.anchorTerrain?.corridorStreamer; }
  set corridorStreamer(value) { if (this.anchorTerrain) this.anchorTerrain.corridorStreamer = value; }

  /** extent: {minX, maxX, minZ, maxZ} in the region's own local frame. */
  register(id, { terrain, airport, group = null, mesh = null, extent, mounted }) {
    if (!BASE_OFFSETS[id] && !this.dynamicOffsets.has(id)) throw new Error(`Unknown unified region: ${id}`);
    if (!terrain || !extent) throw new Error(`Unified region ${id} needs terrain and extent`);
    const previous = this.regions.get(id);
    const keepMounted = mounted === undefined ? (previous?.mounted ?? true) : mounted;
    this.regions.set(id, { terrain, airport, group, mesh, extent, mounted: Boolean(keepMounted) });
    this.syncMeshes();
    return this;
  }

  /** Surface records stay registered when visuals are unmounted. */
  isMounted(id) {
    return this.regions.get(id)?.mounted === true;
  }

  setMounted(id, mounted) {
    const region = this.regions.get(id);
    if (!region || region.mounted === Boolean(mounted)) return false;
    region.mounted = Boolean(mounted);
    this.syncMeshes();
    return true;
  }

  /** Distance in metres from an anchor-local point to a region's world-frame box. */
  distanceToRegion(id, x, z) {
    const region = this.regions.get(id);
    const base = BASE_OFFSETS[id];
    if (!region || !base) return Infinity;
    const anchor = BASE_OFFSETS[this.anchor];
    const ox = base[0] - anchor[0];
    const oz = base[1] - anchor[1];
    const e = region.extent;
    return Math.hypot(
      Math.max(e.minX + ox - x, 0, x - e.maxX - ox),
      Math.max(e.minZ + oz - z, 0, z - e.maxZ - oz),
    );
  }

  /** Add a streamed airport slot whose WGS84 placement is derived from index data. */
  registerDynamic(id, { baseOffset, extent, terrain, airport, group = null, mesh = null }) {
    if (BASE_OFFSETS[id] || !Array.isArray(baseOffset) || baseOffset.length !== 2
      || !baseOffset.every(Number.isFinite)) throw new Error(`Invalid dynamic region: ${id}`);
    this.rememberDestination(id, baseOffset);
    this.dynamicOffsets.set(id, Object.freeze([baseOffset[0], baseOffset[1]]));
    this.recomputeOffsets();
    this.register(id, { terrain, airport, group, mesh, extent });
  }

  /** Keep the last known WGS84 placement even when rendering is unmounted. */
  rememberDestination(id, baseOffset) {
    if (!Array.isArray(baseOffset) || baseOffset.length !== 2
      || !baseOffset.every(Number.isFinite)) return;
    this.destinationOffsets.set(id, Object.freeze([baseOffset[0], baseOffset[1]]));
  }

  unregister(id) {
    if (!this.dynamicOffsets.delete(id)) return false;
    this.regions.delete(id);
    this.offsets.delete(id);
    this.dynamicStatus.delete(id);
    this.syncMeshes();
    return true;
  }

  setDynamicStatus(id, status) {
    this.dynamicStatus.set(id, status);
  }

  recomputeOffsets() {
    const anchor = this.customOrigin ? [0, 0] : BASE_OFFSETS[this.anchor];
    for (const [id, base] of Object.entries(BASE_OFFSETS)) {
      this.offsets.set(id, [base[0] - anchor[0], base[1] - anchor[1]]);
    }
    for (const [id, base] of this.dynamicOffsets) {
      this.offsets.set(id, [base[0] - anchor[0], base[1] - anchor[1]]);
    }
    this.syncMeshes();
  }


  /** Incheon world-frame metres -> current anchor's local sample frame. */
  incheonFrameToAnchor(x, z) {
    if (this.customOrigin) return [x, z];
    const anchor = BASE_OFFSETS[this.anchor];
    return [x - anchor[0], z - anchor[1]];
  }

  setAnchor(id) {
    if (!BASE_OFFSETS[id]) return false;
    this.anchor = id;
    this.recomputeOffsets();
    return true;
  }

  /** Keep every registered region in the active frame; only mounted ones draw. */
  syncMeshes() {
    for (const [id, region] of this.regions) {
      const [x, z] = this.offsets.get(id);
      const visible = this.customOrigin ? (!BASE_OFFSETS[id] && region.mounted) : region.mounted;
      region.group?.position.set(x, 0, z);
      region.mesh?.position.set(x, 0, z);
      if (region.group) region.group.visible = visible;
      if (region.mesh) region.mesh.visible = visible;
    }
    if (this.customTerrain?.mesh) {
      this.customTerrain.mesh.visible = Boolean(this.customOrigin);
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
      if (this.customOrigin && BASE_OFFSETS[id]) continue;
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

  externalDestinationInfo(x, z, id) {
    const anchor = this.customOrigin ? [0, 0] : BASE_OFFSETS[this.anchor];
    const base = this.destinationOffsets.get(id) ?? this.dynamicOffsets.get(id) ?? null;
    const status = this.dynamicStatus.get(id);
    const prepare = status?.state ?? null;
    if (!base) {
      return {
        id, code: id, nameKey: id, dx: null, dz: null,
        distanceM: null, distanceNm: null, bearingDeg: null,
        synthetic: true, target: 'unknown', prepare,
      };
    }
    const [ox, oz] = this.offsets.get(id) ?? [base[0] - anchor[0], base[1] - anchor[1]];
    const centre = this.regions.get(id)?.terrain?.centre;
    const targetX = (centre?.x ?? 0) + ox;
    const targetZ = (centre?.z ?? 0) + oz;
    const dx = targetX - x;
    const dz = targetZ - z;
    const distanceM = Math.hypot(dx, dz);
    return {
      id,
      code: id,
      nameKey: id,
      dx, dz,
      distanceM,
      distanceNm: distanceM / 1852,
      bearingDeg: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360,
      synthetic: true,
      target: 'centre',
      prepare,
    };
  }

  /** Bearing and distance from a world position to another airport's approach threshold. */
  destinationInfo(x, z, id) {
    if (this.dynamicOffsets.has(id) || isExternalDestination(id)) return this.externalDestinationInfo(x, z, id);
    const target = BASE_OFFSETS[id];
    if (!target) return null;
    const anchor = BASE_OFFSETS[this.anchor];
    const centreDx = target[0] - anchor[0] - x;
    const centreDz = target[1] - anchor[1] - z;
    const planarDistanceM = Math.hypot(centreDx, centreDz);
    const threshold = RUNWAY_THRESHOLDS[id];
    const from = worldPositionToWgs84(this.anchor, x, z, this.customOrigin);
    const realOffset = realOffsetInIncheonFrame(id);
    const placementIsReal = realOffset
      && Math.hypot(target[0] - realOffset[0], target[1] - realOffset[1]) < 5;
    const synthetic = !REAL_AIRPORTS.includes(id)
      || !placementIsReal || !from || !threshold;
    const distanceM = synthetic
      ? planarDistanceM
      : haversineDistanceM(from.latitude, from.longitude, threshold.latitude, threshold.longitude);
    const bearingDeg = synthetic
      ? (Math.atan2(centreDx, -centreDz) * 180 / Math.PI + 360) % 360
      : initialBearingDeg(from.latitude, from.longitude, threshold.latitude, threshold.longitude);
    const authoredThreshold = APPROACH_DATA[id]?.threshold;
    const markerLocal = synthetic || !authoredThreshold || this.customOrigin
      ? null
      : [target[0] - anchor[0] + authoredThreshold.x, target[1] - anchor[1] + authoredThreshold.z];
    let dx;
    let dz;
    if (this.customOrigin && !synthetic) {
      const bearingRad = bearingDeg * Math.PI / 180;
      dx = Math.sin(bearingRad) * distanceM;
      dz = -Math.cos(bearingRad) * distanceM;
    } else {
      dx = markerLocal ? markerLocal[0] - x : centreDx;
      dz = markerLocal ? markerLocal[1] - z : centreDz;
    }
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
