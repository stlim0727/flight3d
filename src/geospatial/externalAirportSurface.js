// Runway surface and mesh generated from a single OurAirports index record.
// Descriptors and contact queries use airport-local coordinates (metres from
// the ARP); baseOffset translates that frame into the Incheon world frame.
import * as THREE from 'three';
import { projectToLocal } from './incheon.js';

const BLEND_START_M = 40;
const BLEND_END_M = 240;
const SAFETY_AREA_M = 60;
const EXTENT_MARGIN_M = 1500;
export const EXTERNAL_MESH_LIFT_M = 0.015;
const EPSILON = 1e-9;

const finite = Number.isFinite;

function normalizedOffset(baseOffset) {
  if (Array.isArray(baseOffset) && baseOffset.length >= 2
    && finite(baseOffset[0]) && finite(baseOffset[1])) {
    return { x: baseOffset[0], z: baseOffset[1] };
  }
  if (baseOffset && finite(baseOffset.x) && finite(baseOffset.z)) {
    return { x: baseOffset.x, z: baseOffset.z };
  }
  return { x: 0, z: 0 };
}

function airportOrigin(airport) {
  if (!airport || !finite(airport.latitude) || !finite(airport.longitude)) return { x: 0, z: 0 };
  try {
    const [x, z] = projectToLocal(airport.latitude, airport.longitude);
    return { x, z };
  } catch {
    return { x: 0, z: 0 };
  }
}

function localPoint(point, origin, fallbackElevation) {
  const [x, z] = projectToLocal(point.latitude, point.longitude);
  return {
    x: x - origin.x,
    z: z - origin.z,
    elevationM: finite(point.elevationM) ? point.elevationM : fallbackElevation,
  };
}

/** WGS84 runway geometry converted into the airport's local east/south frame. */
export function buildExternalRunwayDescriptors(airport) {
  if (!airport || !Array.isArray(airport.runways)) return [];
  const origin = airportOrigin(airport);
  const fallbackElevation = finite(airport.elevationM) ? airport.elevationM : 0;
  const descriptors = [];

  for (let index = 0; index < airport.runways.length; index++) {
    const runway = airport.runways[index];
    if (!runway || !Array.isArray(runway.ends) || runway.ends.length < 2) continue;
    let ends;
    try {
      ends = runway.ends.slice(0, 2).map(end => {
        if (!end || !end.physical || !end.threshold) throw new Error('Incomplete runway end');
        return {
          ident: end.ident ?? '',
          physical: localPoint(end.physical, origin, fallbackElevation),
          threshold: localPoint(end.threshold, origin, fallbackElevation),
          displacedThresholdM: finite(end.displacedThresholdM)
            ? Math.max(0, end.displacedThresholdM) : 0,
          headingDegT: finite(end.headingDegT) ? end.headingDegT : 0,
        };
      });
    } catch {
      continue;
    }
    const a = ends[0].physical;
    const b = ends[1].physical;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(length > EPSILON)) continue;
    descriptors.push({
      id: runway.id ?? String(index),
      lengthM: finite(runway.lengthM) ? runway.lengthM : length,
      widthM: finite(runway.widthM) && runway.widthM > 0 ? runway.widthM : 0,
      surface: typeof runway.surface === 'string' ? runway.surface : '',
      centre: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
      ends,
    });
  }
  return descriptors;
}

function segmentAt(runway, x, z) {
  const a = runway.ends[0].physical;
  const b = runway.ends[1].physical;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (!(lengthSquared > EPSILON)) return null;
  const raw = ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared;
  const t = Math.max(0, Math.min(1, raw));
  const distance = Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
  return {
    raw,
    distance,
    elevationM: a.elevationM + (b.elevationM - a.elevationM) * t,
  };
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Airport-local terrain contact surface; no buildings or taxiways are modeled. */
export class ExternalAirportSurface {
  constructor({ airport, baseOffset = [0, 0], outsideHeight } = {}) {
    this.runways = buildExternalRunwayDescriptors(airport);
    this.baseOffset = normalizedOffset(baseOffset);
    this.outsideHeight = typeof outsideHeight === 'function' ? outsideHeight : null;
    this.isLoaded = true;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const runway of this.runways) for (const end of runway.ends) {
      for (const point of [end.physical, end.threshold]) {
        if (!finite(point.x) || !finite(point.z)) continue;
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
    }
    if (!Number.isFinite(minX)) {
      minX = maxX = minZ = maxZ = 0;
    }
    this.centre = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    this.extent = {
      minX: minX - EXTENT_MARGIN_M,
      maxX: maxX + EXTENT_MARGIN_M,
      minZ: minZ - EXTENT_MARGIN_M,
      maxZ: maxZ + EXTENT_MARGIN_M,
    };
  }

  outside(x, z, fallback) {
    if (!this.outsideHeight) return fallback;
    try {
      const height = this.outsideHeight(x + this.baseOffset.x, z + this.baseOffset.z);
      return finite(height) ? height : fallback;
    } catch {
      return fallback;
    }
  }

  nearest(x, z) {
    let best = null;
    for (const runway of this.runways) {
      const hit = segmentAt(runway, x, z);
      if (hit && (!best || hit.distance < best.hit.distance)) best = { runway, hit };
    }
    return best;
  }

  getHeight(x, z) {
    if (!finite(x) || !finite(z)) return 0;
    const nearest = this.nearest(x, z);
    if (!nearest) return this.outside(x, z, 0);
    const elevation = nearest.hit.elevationM;
    const blend = smoothstep((nearest.hit.distance - BLEND_START_M) / (BLEND_END_M - BLEND_START_M));
    if (blend <= 0) return elevation;
    if (blend >= 1) return this.outside(x, z, elevation);
    const surrounding = this.outside(x, z, elevation);
    return elevation * (1 - blend) + surrounding * blend;
  }

  getNormal(x, z) {
    const delta = 0.5;
    const normal = new THREE.Vector3(
      this.getHeight(x - delta, z) - this.getHeight(x + delta, z),
      2 * delta,
      this.getHeight(x, z - delta) - this.getHeight(x, z + delta),
    );
    if (!finite(normal.x) || !finite(normal.y) || !finite(normal.z) || normal.lengthSq() < EPSILON) {
      return new THREE.Vector3(0, 1, 0);
    }
    return normal.normalize();
  }

  getWaterLevel() {
    return 0;
  }

  isOnRunway(x, z) {
    if (!finite(x) || !finite(z)) return false;
    return this.runways.some(runway => {
      const hit = segmentAt(runway, x, z);
      return !!hit && hit.raw >= -EPSILON && hit.raw <= 1 + EPSILON
        && hit.distance <= runway.widthM / 2 + EPSILON;
    });
  }

  isRunwaySafetyArea(x, z) {
    if (!finite(x) || !finite(z)) return false;
    return this.runways.some(runway => {
      const hit = segmentAt(runway, x, z);
      return !!hit && hit.raw >= -EPSILON && hit.raw <= 1 + EPSILON
        && hit.distance <= runway.widthM / 2 + SAFETY_AREA_M + EPSILON;
    });
  }

  dispose() {
    this.outsideHeight = null;
  }
}

const SURFACE_COLORS = [
  ['ASP', 0x4b4b4b],
  ['CON', 0x565656],
  ['TURF', 0x42683b],
  ['GRE', 0x8a7c60],
  ['DIRT', 0x7a5a3e],
  ['PEM', 0x6d6054],
];

function surfaceColor(surface) {
  const category = String(surface ?? '').toUpperCase();
  for (const [token, color] of SURFACE_COLORS) if (category.includes(token)) return color;
  return 0x5c5c5c;
}

function disposeGroup(group) {
  if (!group?.isGroup) return;
  for (const child of [...group.children]) {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material?.dispose?.();
    group.remove(child);
  }
  group.clear();
}

function ribbonGeometry(descriptor) {
  const a = descriptor.ends[0]?.physical;
  const b = descriptor.ends[1]?.physical;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > EPSILON)) return null;
  const halfWidth = descriptor.widthM / 2;
  const px = -dz / length * halfWidth;
  const pz = dx / length * halfWidth;
  const yA = a.elevationM + EXTERNAL_MESH_LIFT_M;
  const yB = b.elevationM + EXTERNAL_MESH_LIFT_M;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    a.x + px, yA, a.z + pz,
    a.x - px, yA, a.z - pz,
    b.x + px, yB, b.z + pz,
    b.x - px, yB, b.z - pz,
  ]), 3));
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  geometry.computeVertexNormals();
  return geometry;
}

/** One flat ribbon per runway, plus optional thin bars at displaced thresholds. */
export function createExternalAirportMesh(descriptors) {
  const group = new THREE.Group();
  group.name = 'external-airport-mesh';
  group.dispose = () => disposeGroup(group);
  if (!Array.isArray(descriptors)) return group;

  for (const descriptor of descriptors) {
    const geometry = ribbonGeometry(descriptor);
    if (!geometry) continue;
    const material = new THREE.MeshStandardMaterial({
      color: surfaceColor(descriptor.surface),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.name = `runway-${descriptor.id}`;
    ribbon.userData = { runwayId: descriptor.id, surface: descriptor.surface };
    group.add(ribbon);

    const a = descriptor.ends[0].physical;
    const b = descriptor.ends[1].physical;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const displaced = descriptor.ends.filter(end => end.displacedThresholdM > 0);
    if (!displaced.length || !(length > EPSILON)) continue;
    const barMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f0e8,
      roughness: 0.8,
      metalness: 0,
    });
    for (const end of displaced) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(2, descriptor.widthM * 0.9), 0.08, 2),
        barMaterial,
      );
      bar.name = `threshold-${descriptor.id}-${end.ident}`;
      bar.position.set(
        end.threshold.x,
        end.threshold.elevationM + EXTERNAL_MESH_LIFT_M + 0.04,
        end.threshold.z,
      );
      bar.rotation.y = Math.atan2(dx, dz);
      group.add(bar);
    }
  }
  return group;
}

/** Terrain facade, runway mesh and no-op airport API for one streamed airport. */
export function createExternalAirportRegion({ airport, baseOffset = [0, 0], outsideHeight } = {}) {
  const terrain = new ExternalAirportSurface({ airport, baseOffset, outsideHeight });
  const group = createExternalAirportMesh(terrain.runways);
  const offset = terrain.baseOffset;
  const airportFacade = {
    isLoaded: true,
    terrain,
    isOnRunway: (x, z) => terrain.isOnRunway(x, z),
    isRunwaySafetyArea: (x, z) => terrain.isRunwaySafetyArea(x, z),
    update() {},
    nightLighting: { update() {} },
    getGazeTargets() { return []; },
    hasModeledBuilding() { return false; },
    checkBuildingCollision() { return false; },
    updateRenderLights() {},
  };
  return {
    terrain,
    airport: airportFacade,
    group,
    extent: terrain.extent,
    baseOffset: [offset.x, offset.z],
    dispose() {
      disposeGroup(group);
      terrain.dispose();
    },
  };
}
