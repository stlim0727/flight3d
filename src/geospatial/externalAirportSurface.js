// Runway surface and mesh generated from a single OurAirports index record.
// Descriptors and contact queries use airport-local coordinates (metres from
// the ARP); baseOffset translates that frame into the Incheon world frame.
import * as THREE from 'three';
import { projectToLocal } from './incheon.js';
import { wgs84ToLocal } from './TileCoordinateSystem.js';
import { applyLogDepthOffset } from '../environment/RunwayMarkings.js';
import { getAirportOverride } from '../config/airportOverrides.js';
import { nightLightLevel } from '../environment/AirportNightLighting.js';

const BLEND_START_M = 40;
const BLEND_END_M = 240;
const SAFETY_AREA_M = 60;
const EXTENT_MARGIN_M = 1500;
export const EXTERNAL_MESH_LIFT_M = 0.015;
export const MARKING_LIFT_M = 0.05;
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

function projectPoint(latitude, longitude, geoOrigin = null) {
  return geoOrigin && finite(geoOrigin.latitude) && finite(geoOrigin.longitude)
    ? wgs84ToLocal(latitude, longitude, geoOrigin)
    : projectToLocal(latitude, longitude);
}

function airportOrigin(airport, geoOrigin = null) {
  if (!airport || !finite(airport.latitude) || !finite(airport.longitude)) return { x: 0, z: 0 };
  try {
    const [x, z] = projectPoint(airport.latitude, airport.longitude, geoOrigin);
    return { x, z };
  } catch {
    return { x: 0, z: 0 };
  }
}

function localPoint(point, origin, fallbackElevation, hasElevationOverride = false, geoOrigin = null) {
  const [x, z] = projectPoint(point.latitude, point.longitude, geoOrigin);
  return {
    x: x - origin.x,
    z: z - origin.z,
    elevationM: hasElevationOverride ? fallbackElevation : (finite(point.elevationM) ? point.elevationM : fallbackElevation),
  };
}

/** WGS84 runway geometry converted into the airport's local east/south frame. */
export function buildExternalRunwayDescriptors(airport, overrides, { geoOrigin = null } = {}) {
  if (!airport || !Array.isArray(airport.runways)) return [];
  const origin = airportOrigin(airport, geoOrigin);
  const fallbackElevation = finite(overrides?.elevationM)
    ? overrides.elevationM
    : (finite(airport.elevationM) ? airport.elevationM : 0);
  const descriptors = [];

  for (let index = 0; index < airport.runways.length; index++) {
    const runway = airport.runways[index];
    if (!runway || !Array.isArray(runway.ends) || runway.ends.length < 2) continue;
    if (overrides?.hideRunways?.some(id => String(id) === String(runway?.id))) continue;
    let ends;
    const hasElevOverride = finite(overrides?.elevationM);
    try {
      ends = runway.ends.slice(0, 2).map(end => {
        if (!end || !end.physical || !end.threshold) throw new Error('Incomplete runway end');
        const elev = hasElevOverride
          ? overrides.elevationM
          : (finite(end.physical?.elevationM) ? end.physical.elevationM : fallbackElevation);
        const threshElev = hasElevOverride
          ? overrides.elevationM
          : (finite(end.threshold?.elevationM) ? end.threshold.elevationM : fallbackElevation);
        return {
          ident: end.ident ?? '',
          physical: localPoint(end.physical, origin, elev, hasElevOverride, geoOrigin),
          threshold: localPoint(end.threshold, origin, threshElev, hasElevOverride, geoOrigin),
          displacedThresholdM: finite(end.displacedThresholdM)
            ? Math.max(0, end.displacedThresholdM) : 0,
          headingDegT: finite(end.headingDegT) ? end.headingDegT : 0,
        };
      });
    } catch {
      continue;
    }
    const end0 = ends[0].ident;
    const end1 = ends[1].ident;
    const runwayOverride = overrides?.runways?.find(ro => {
      if (ro.ident && (ro.ident === `${end0}/${end1}` || ro.ident === `${end1}/${end0}`)) return true;
      if (ro.id && (ro.id === runway.id || ro.id === String(index))) return true;
      return false;
    });
    const correctedEnds = runwayOverride?.ends
      ? ends.map(end => {
        const corrected = runwayOverride.ends.find(entry => entry.ident === end.ident);
        if (!corrected) return end;
        return {
          ...end,
          // Corrected ends may intentionally declare different elevations
          // (e.g. Lukla's sloped runway), so do not flatten them.
          physical: localPoint(corrected.physical, origin, fallbackElevation, false, geoOrigin),
          threshold: localPoint(corrected.threshold, origin, fallbackElevation, false, geoOrigin),
          displacedThresholdM: finite(corrected.displacedThresholdM)
            ? Math.max(0, corrected.displacedThresholdM) : 0,
        };
      })
      : ends;
    const a = correctedEnds[0].physical;
    const b = correctedEnds[1].physical;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!(length > EPSILON)) continue;

    const widthM = finite(runwayOverride?.widthM)
      ? runwayOverride.widthM
      : (finite(runway.widthM) && runway.widthM > 0 ? runway.widthM : 0);

    const lengthM = finite(runwayOverride?.lengthM)
      ? runwayOverride.lengthM
      : (finite(runway.lengthM) ? runway.lengthM : length);

    const hasLightingOverride = Boolean(runwayOverride?.lighting);
    const isLighted = hasLightingOverride || Boolean(runway.lighted);

    const defaultLighting = isLighted ? {
      papi: [
        { endIdent: end0, glideslopeDeg: 3.0, units: 4, touchdownDistanceM: 300 },
        { endIdent: end1, glideslopeDeg: 3.0, units: 4, touchdownDistanceM: 300 },
      ],
    } : null;

    descriptors.push({
      id: runway.id ?? String(index),
      lengthM,
      widthM,
      surface: typeof runway.surface === 'string' ? runway.surface : '',
      centre: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
      ends: correctedEnds,
      lighted: isLighted,
      lighting: runwayOverride?.lighting ?? defaultLighting,
    });
  }
  return descriptors;
}

export function buildExternalTaxiwayDescriptors(taxiways, origin, fallbackElevation) {
  if (!Array.isArray(taxiways)) return [];
  const descriptors = [];
  for (let i = 0; i < taxiways.length; i++) {
    const twy = taxiways[i];
    if (!twy || !Array.isArray(twy.points) || twy.points.length < 2) continue;
    const points = twy.points.map(pt => {
      if (Array.isArray(pt)) {
        return [pt[0], pt[1], pt[2] ?? fallbackElevation];
      }
      return [pt.x, pt.z, pt.elevationM ?? fallbackElevation];
    });
    descriptors.push({
      id: twy.id ?? `twy-${i}`,
      name: twy.name ?? `Taxiway ${i + 1}`,
      widthM: finite(twy.widthM) && twy.widthM > 0 ? twy.widthM : 23,
      surface: twy.surface ?? 'ASP',
      points,
    });
  }
  return descriptors;
}

export function buildExternalFacilityDescriptors(facilities, fallbackElevation = 0) {
  if (!Array.isArray(facilities)) return [];
  return facilities.map((fac, idx) => ({
    id: fac.id ?? `facility-${idx}`,
    name: fac.name ?? `Facility ${idx + 1}`,
    kind: fac.kind ?? 'building',
    position: [
      fac.position?.[0] ?? 0,
      fac.position?.[1] ?? fallbackElevation,
      fac.position?.[2] ?? 0,
    ],
    height: fac.height ?? 20,
    radius: fac.radius ?? 10,
    size: fac.size ?? [30, 20, 30],
    rotationY: fac.rotationY ?? 0,
    cabHeight: fac.cabHeight ?? 8,
    cabRadius: fac.cabRadius ?? 11,
    shaftRadius: fac.shaftRadius ?? 8,
    collision: fac.collision ?? null,
  }));
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

function segmentAtPoints(points, x, z) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lenSq = dx * dx + dz * dz;
    if (!(lenSq > EPSILON)) continue;
    const raw = ((x - a[0]) * dx + (z - a[1]) * dz) / lenSq;
    const t = Math.max(0, Math.min(1, raw));
    const dist = Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
    if (!best || dist < best.distance) {
      const elev = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t;
      best = { distance: dist, raw, t, elevationM: elev };
    }
  }
  return best;
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Airport-local terrain contact surface with runway, taxiway, and facility integration. */
export class ExternalAirportSurface {
  constructor({ airport, baseOffset = [0, 0], outsideHeight, overrides, geoOrigin = null } = {}) {
    const code = airport?.ident ?? airport?.icao ?? airport?.iata ?? airport?.code;
    this.overrides = overrides ?? getAirportOverride(code);
    this.runways = buildExternalRunwayDescriptors(airport, this.overrides, { geoOrigin });
    this.baseOffset = normalizedOffset(baseOffset);
    this.outsideHeight = typeof outsideHeight === 'function' ? outsideHeight : null;
    this.isLoaded = true;

    const origin = airportOrigin(airport, geoOrigin);
    const fallbackElevation = finite(this.overrides?.elevationM)
      ? this.overrides.elevationM
      : (finite(airport?.elevationM) ? airport.elevationM : 0);
    this.elevationM = fallbackElevation;

    this.taxiways = buildExternalTaxiwayDescriptors(this.overrides?.taxiways, origin, fallbackElevation);
    this.facilities = buildExternalFacilityDescriptors(this.overrides?.facilities, fallbackElevation);
    this.apronLamps = this.overrides?.lighting?.apronLamps ?? [];

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
    for (const twy of this.taxiways) {
      for (const pt of twy.points) {
        minX = Math.min(minX, pt[0]);
        maxX = Math.max(maxX, pt[0]);
        minZ = Math.min(minZ, pt[1]);
        maxZ = Math.max(maxZ, pt[1]);
      }
    }
    for (const fac of this.facilities) {
      const fx = fac.position[0];
      const fz = fac.position[2];
      const r = fac.kind === 'tower'
        ? Math.max(fac.radius ?? 10, fac.cabRadius ?? 10)
        : Math.hypot(fac.size?.[0] ?? 30, fac.size?.[2] ?? 30) * 0.5;
      minX = Math.min(minX, fx - r);
      maxX = Math.max(maxX, fx + r);
      minZ = Math.min(minZ, fz - r);
      maxZ = Math.max(maxZ, fz + r);
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

  outside(x, z, fallback, options) {
    if (!this.outsideHeight) return fallback;
    try {
      const height = this.outsideHeight(x + this.baseOffset.x, z + this.baseOffset.z, options);
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

  nearestTaxiway(x, z) {
    let best = null;
    for (const twy of this.taxiways) {
      const hit = segmentAtPoints(twy.points, x, z);
      if (hit && (!best || hit.distance < best.hit.distance)) best = { taxiway: twy, hit };
    }
    return best;
  }

  nearestFacility(x, z) {
    if (!Array.isArray(this.facilities) || this.facilities.length === 0) return null;
    let best = null;
    for (const fac of this.facilities) {
      const fx = fac.position[0];
      const fz = fac.position[2];
      const baseElev = fac.position[1] ?? this.elevationM;
      let dist = Infinity;
      if (fac.kind === 'tower') {
        const radius = Math.max(fac.radius ?? 10, fac.shaftRadius ?? 8, fac.cabRadius ?? 10);
        const centerDist = Math.hypot(x - fx, z - fz);
        dist = Math.max(0, centerDist - radius);
      } else {
        const halfW = fac.collision?.halfX ?? ((fac.size?.[0] ?? 30) * 0.5);
        const halfD = fac.collision?.halfZ ?? ((fac.size?.[2] ?? 30) * 0.5);
        const rot = fac.rotationY ?? 0;
        let qx = 0;
        let qz = 0;
        if (rot !== 0) {
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const dx = x - fx;
          const dz = z - fz;
          const lx = Math.abs(dx * cos - dz * sin);
          const lz = Math.abs(dx * sin + dz * cos);
          qx = Math.max(0, lx - halfW);
          qz = Math.max(0, lz - halfD);
        } else {
          qx = Math.max(0, Math.abs(x - fx) - halfW);
          qz = Math.max(0, Math.abs(z - fz) - halfD);
        }
        dist = Math.hypot(qx, qz);
      }
      if (!best || dist < best.distance) {
        best = { distance: dist, elevationM: baseElev };
      }
    }
    return best;
  }

  getHeight(x, z) {
    if (!finite(x) || !finite(z)) return 0;
    const nearestRunway = this.nearest(x, z);
    const nearestTwy = this.nearestTaxiway(x, z);
    const nearestFac = this.nearestFacility(x, z);

    let nearest = nearestRunway
      ? { distance: nearestRunway.hit.distance, elevationM: nearestRunway.hit.elevationM }
      : null;
    if (nearestTwy && (!nearest || nearestTwy.hit.distance < nearest.distance)) {
      nearest = { distance: nearestTwy.hit.distance, elevationM: nearestTwy.hit.elevationM };
    }
    if (nearestFac && (!nearest || nearestFac.distance < nearest.distance)) {
      nearest = nearestFac;
    }

    if (!nearest) return this.outside(x, z, 0);
    const elevation = nearest.elevationM;
    const blend = smoothstep((nearest.distance - BLEND_START_M) / (BLEND_END_M - BLEND_START_M));
    if (blend <= 0) return elevation;
    if (blend >= 1) return this.outside(x, z, elevation);
    const surrounding = this.outside(x, z, elevation, { unblended: true });
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

  isOnTaxiway(x, z) {
    if (!finite(x) || !finite(z)) return false;
    return this.taxiways.some(twy => {
      const hit = segmentAtPoints(twy.points, x, z);
      return !!hit && hit.raw >= -EPSILON && hit.raw <= 1 + EPSILON
        && hit.distance <= twy.widthM / 2 + EPSILON;
    });
  }

  isRunwaySafetyArea(x, z) {
    if (!finite(x) || !finite(z)) return false;
    const onRunwayOrSafety = this.runways.some(runway => {
      const hit = segmentAt(runway, x, z);
      return !!hit && hit.raw >= -EPSILON && hit.raw <= 1 + EPSILON
        && hit.distance <= runway.widthM / 2 + SAFETY_AREA_M + EPSILON;
    });
    if (onRunwayOrSafety) return true;
    return this.isOnTaxiway(x, z);
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

function disposeObject(obj) {
  if (!obj) return;
  if (Array.isArray(obj.children)) {
    for (const child of [...obj.children]) {
      disposeObject(child);
      obj.remove(child);
    }
  }
  obj.geometry?.dispose?.();
  const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const material of materials) material?.dispose?.();
}

function disposeGroup(group) {
  if (!group) return;
  disposeObject(group);
  if (typeof group.clear === 'function') group.clear();
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

// Markings are built from the same index geometry as the pavement ribbon. One
// merged geometry per runway keeps streamed airports cheap to draw, and the
// 50 mm lift stays well above float32 precision at transcontinental offsets.
const MARKING_FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  L: ['100', '100', '100', '100', '111'],
  R: ['110', '101', '110', '101', '101'],
  C: ['111', '100', '100', '100', '111'],
};

function runwayFrame(descriptor) {
  const a = descriptor.ends[0]?.physical;
  const b = descriptor.ends[1]?.physical;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length > EPSILON)) return null;
  return { a, b, length, ux: dx / length, uz: dz / length, px: -dz / length, pz: dx / length };
}

function thresholdAlong(frame, end) {
  const point = end.threshold ?? end.physical;
  return (point.x - frame.a.x) * frame.ux + (point.z - frame.a.z) * frame.uz;
}

function pushMarkingQuad(positions, indices, frame, startAlong, endAlong, left, right) {
  const alongMin = Math.min(startAlong, endAlong);
  const alongMax = Math.max(startAlong, endAlong);
  const lateralMin = Math.min(left, right);
  const lateralMax = Math.max(left, right);
  const vertex = (along, lateral) => {
    const t = along / frame.length;
    return [
      frame.a.x + frame.ux * along + frame.px * lateral,
      frame.a.elevationM + (frame.b.elevationM - frame.a.elevationM) * t
        + EXTERNAL_MESH_LIFT_M + MARKING_LIFT_M,
      frame.a.z + frame.uz * along + frame.pz * lateral,
    ];
  };
  const base = positions.length / 3;
  positions.push(
    ...vertex(alongMin, lateralMin),
    ...vertex(alongMin, lateralMax),
    ...vertex(alongMax, lateralMin),
    ...vertex(alongMax, lateralMax),
  );
  indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

function designatorGlyphs(ident) {
  return [...String(ident ?? '').toUpperCase()].filter(char => MARKING_FONT[char]).slice(0, 3);
}

function designatorCell(glyphCount, innerHalf) {
  const cell = Math.min(2.4, (2 * innerHalf - 2) / (4 * glyphCount - 1));
  return cell >= 0.8 ? cell : 0;
}

function addMarkingDesignator(positions, indices, frame, glyphs, cell, threshold, direction) {
  const pitch = 4 * cell;
  const centreAlong = threshold + direction * 85;
  glyphs.forEach((char, index) => {
    const rows = MARKING_FONT[char];
    const baseLateral = direction * (index - (glyphs.length - 1) / 2) * pitch;
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < rows[row].length; column++) {
        if (rows[row][column] !== '1') continue;
        const lateral = baseLateral + direction * (column - 1) * cell;
        const along = centreAlong + direction * ((rows.length - 1 - row) * cell);
        pushMarkingQuad(positions, indices, frame, along - cell / 2, along + cell / 2,
          lateral - cell / 2, lateral + cell / 2);
      }
    }
  });
}

function runwayMarkingsGeometry(descriptor) {
  const frame = runwayFrame(descriptor);
  if (!frame || !(descriptor.widthM > 8)) return null;
  const positions = [];
  const indices = [];
  const halfWidth = descriptor.widthM / 2;
  const edge = Math.min(1.2, halfWidth * 0.05);
  const innerHalf = halfWidth - 0.6 - edge;
  if (innerHalf <= 1) return null;

  pushMarkingQuad(positions, indices, frame, 0, frame.length,
    -halfWidth + 0.6, -halfWidth + 0.6 + edge);
  pushMarkingQuad(positions, indices, frame, 0, frame.length,
    halfWidth - 0.6 - edge, halfWidth - 0.6);

  const [first, second] = descriptor.ends;
  const start = thresholdAlong(frame, first);
  const end = thresholdAlong(frame, second);
  const usable = end - start;
  const glyphs = [designatorGlyphs(first.ident), designatorGlyphs(second.ident)];
  const cells = glyphs.map(list => list.length ? designatorCell(list.length, innerHalf) : 0);
  const reach = Math.max(40, ...cells.map(cell => cell ? 85 + 4 * cell + cell / 2 : 0)) + 5;
  const endsFit = usable > 2 * reach;

  if (endsFit) {
    const available = 2 * innerHalf - 2;
    const keyWidth = 1.8;
    const keyCount = Math.min(16, Math.floor(available / (keyWidth + 0.4)));
    if (keyCount >= 2) {
      const spacing = available / keyCount;
      for (const [threshold, direction] of [[start, 1], [end, -1]]) {
        for (let key = 0; key < keyCount; key++) {
          const lateral = (key - (keyCount - 1) / 2) * spacing;
          pushMarkingQuad(positions, indices, frame,
            threshold + direction * 10, threshold + direction * 40,
            lateral - keyWidth / 2, lateral + keyWidth / 2);
        }
      }
    }
    for (const [list, cell, threshold, direction] of [
      [glyphs[0], cells[0], start, 1], [glyphs[1], cells[1], end, -1],
    ]) {
      if (list.length && cell) addMarkingDesignator(positions, indices, frame, list, cell, threshold, direction);
    }
  }

  if (endsFit && usable > 700 && descriptor.widthM >= 16) {
    const blockHalf = Math.min(3, (innerHalf - 2) / 4);
    if (blockHalf >= 1.5) {
      const offset = Math.min(innerHalf * 0.55, innerHalf - 0.5 - blockHalf);
      for (const [threshold, direction] of [[start, 1], [end, -1]]) {
        const aim = threshold + direction * 300;
        for (const side of [-1, 1]) {
          const lateral = side * offset;
          pushMarkingQuad(positions, indices, frame, aim - 15, aim + 15,
            lateral - blockHalf, lateral + blockHalf);
        }
      }
    }
  }

  const centreStart = Math.min(start, end) + reach + 10;
  const centreEnd = Math.max(start, end) - reach - 10;
  for (let along = centreStart; along + 30 <= centreEnd; along += 50) {
    pushMarkingQuad(positions, indices, frame, along, along + 30, -0.9, 0.9);
  }

  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
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
    applyLogDepthOffset(material, 1);
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.name = `runway-${descriptor.id}`;
    ribbon.userData = { runwayId: descriptor.id, surface: descriptor.surface };
    group.add(ribbon);
    const markingGeometry = runwayMarkingsGeometry(descriptor);
    if (markingGeometry) {
      const markingMaterial = new THREE.MeshStandardMaterial({
        color: 0xf0f0e8,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      applyLogDepthOffset(markingMaterial, 2);
      const markings = new THREE.Mesh(markingGeometry, markingMaterial);
      markings.name = `runway-markings-${descriptor.id}`;
      markings.userData = { runwayId: descriptor.id, kind: 'markings' };
      group.add(markings);
    }

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

export function createExternalTaxiwayMesh(descriptors) {
  const group = new THREE.Group();
  group.name = 'external-airport-taxiways';
  group.dispose = () => disposeGroup(group);
  if (!Array.isArray(descriptors) || !descriptors.length) return group;

  for (const twy of descriptors) {
    const pts = twy.points;
    const halfWidth = twy.widthM / 2;
    const positions = [];
    const indices = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (!(len > EPSILON)) continue;
      const px = -dz / len * halfWidth;
      const pz = dx / len * halfWidth;
      const yA = (a[2] ?? 0) + EXTERNAL_MESH_LIFT_M;
      const yB = (b[2] ?? 0) + EXTERNAL_MESH_LIFT_M;

      const base = positions.length / 3;
      positions.push(
        a[0] + px, yA, a[1] + pz,
        a[0] - px, yA, a[1] - pz,
        b[0] + px, yB, b[1] + pz,
        b[0] - px, yB, b[1] - pz,
      );
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: surfaceColor(twy.surface),
        roughness: 0.92,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      applyLogDepthOffset(mat, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `taxiway-${twy.id}`;
      group.add(mesh);
    }
  }
  return group;
}

export function createExternalAirportFacilities(descriptors, fallbackElevation = 0) {
  const group = new THREE.Group();
  group.name = 'external-airport-facilities';
  group.dispose = () => disposeGroup(group);

  const gazeTargets = [];
  const colliders = [];

  for (const fac of descriptors) {
    const pos = fac.position;
    const baseElevation = pos[1] ?? fallbackElevation;

    if (fac.kind === 'tower') {
      const towerGroup = new THREE.Group();
      towerGroup.name = `tower-${fac.id}`;

      const totalH = fac.height;
      const cabH = fac.cabHeight;
      const shaftH = totalH - cabH;

      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.7 });
      const shaftGeo = new THREE.CylinderGeometry(fac.shaftRadius, fac.shaftRadius * 1.2, shaftH, 16);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.set(pos[0], baseElevation + shaftH / 2, pos[2]);
      towerGroup.add(shaft);

      const cabMat = new THREE.MeshStandardMaterial({ color: 0x1a365d, roughness: 0.2, metalness: 0.8 });
      const cabGeo = new THREE.CylinderGeometry(fac.cabRadius, fac.shaftRadius, cabH, 16);
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(pos[0], baseElevation + shaftH + cabH / 2, pos[2]);
      towerGroup.add(cab);

      const rotY = fac.rotationY ?? 0;
      if (rotY !== 0) {
        towerGroup.rotation.y = rotY;
      }

      group.add(towerGroup);
      gazeTargets.push({ object: towerGroup, kind: 'tower', name: fac.name });

      const col = fac.collision;
      const radius = col?.radius ?? fac.radius;
      const maxAlt = col?.maxAltitudeM ?? (baseElevation + totalH + 6);
      const minAlt = col?.minAltitudeM ?? baseElevation;
      colliders.push({
        id: fac.id,
        kind: 'tower',
        inside: (x, z, r = 0) => Math.hypot(x - pos[0], z - pos[2]) <= radius + r,
        minAltitudeM: minAlt,
        maxAltitudeM: maxAlt,
      });
    } else {
      const size = fac.size;
      const width = size[0];
      const height = size[1];
      const depth = size[2];
      const rotY = fac.rotationY ?? 0;

      const mat = new THREE.MeshStandardMaterial({
        color: fac.kind === 'terminal' ? 0x8fa3b8 : 0x7a8b9e,
        roughness: 0.6,
        metalness: 0.2,
      });
      const geo = new THREE.BoxGeometry(width, height, depth);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${fac.kind}-${fac.id}`;
      mesh.position.set(pos[0], baseElevation + height / 2, pos[2]);
      if (rotY !== 0) {
        mesh.rotation.y = rotY;
      }
      group.add(mesh);

      gazeTargets.push({ object: mesh, kind: fac.kind, name: fac.name });

      const col = fac.collision;
      const halfX = col?.halfX ?? width / 2;
      const halfZ = col?.halfZ ?? depth / 2;
      const maxAlt = col?.maxAltitudeM ?? (baseElevation + height + 3);
      const minAlt = col?.minAltitudeM ?? baseElevation;
      colliders.push({
        id: fac.id,
        kind: fac.kind,
        inside: (x, z, r = 0) => {
          let dx = x - pos[0];
          let dz = z - pos[2];
          if (rotY !== 0) {
            const cos = Math.cos(rotY);
            const sin = Math.sin(rotY);
            const lx = dx * cos - dz * sin;
            const lz = dx * sin + dz * cos;
            dx = lx;
            dz = lz;
          }
          return Math.abs(dx) <= halfX + r && Math.abs(dz) <= halfZ + r;
        },
        minAltitudeM: minAlt,
        maxAltitudeM: maxAlt,
      });
    }
  }

  const hasModeledBuilding = (x, z) => colliders.some(c => c.inside(x, z, 0));
  const checkCollision = (probes) => {
    if (!probes || !colliders.length) return false;
    for (const p of probes) {
      if (!p?.pos) continue;
      const radius = p.radius || 0;
      for (const col of colliders) {
        if (
          col.inside(p.pos.x, p.pos.z, radius) &&
          p.pos.y >= col.minAltitudeM - radius &&
          p.pos.y <= col.maxAltitudeM + radius
        ) {
          return { point: p.pos.clone(), part: p.desc ?? col.kind, id: col.id };
        }
      }
    }
    return false;
  };

  return {
    group,
    gazeTargets,
    hasModeledBuilding,
    checkCollision,
    dispose: () => disposeGroup(group),
  };
}

export function createExternalAirportLighting(descriptors, { apronLamps = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'external-airport-lighting';
  group.dispose = () => disposeGroup(group);

  const sources = [];
  const papiSystems = [];

  for (const descriptor of descriptors) {
    if (!descriptor.lighted && !descriptor.lighting) continue;
    const frame = runwayFrame(descriptor);
    if (!frame) continue;

    const length = frame.length;
    const halfWidth = descriptor.widthM / 2;
    const a = frame.a;
    const b = frame.b;
    const right = new THREE.Vector3(frame.px, 0, frame.pz);

    // Edge lights (spaced every 60m along both sides)
    const spacing = 60;
    const edgeCount = Math.ceil(length / spacing);
    const isLongRunway = length > 1200;

    for (let i = 0; i <= edgeCount; i++) {
      const t = i / edgeCount;
      const alongM = t * length;
      const isAmber = isLongRunway && (alongM < 600 || alongM > length - 600);
      const edgeColor = isAmber ? 0xffcc55 : 0xfff3db;
      const basePos = new THREE.Vector3(
        a.x + frame.ux * alongM,
        a.elevationM + (b.elevationM - a.elevationM) * t + EXTERNAL_MESH_LIFT_M + 0.35,
        a.z + frame.uz * alongM
      );

      for (const side of [-1, 1]) {
        const p = basePos.clone().addScaledVector(right, side * (halfWidth + 1.5));
        sources.push({
          position: p.toArray(),
          color: new THREE.Color(edgeColor).toArray(),
          intensity: 2.0,
        });
      }
    }

    // Threshold & End lights
    for (const [end, sign] of [
      [descriptor.ends[0], 1],
      [descriptor.ends[1], -1],
    ]) {
      if (!end) continue;
      const isDisplaced = end.displacedThresholdM > 0;
      const dirX = frame.ux * sign;
      const dirZ = frame.uz * sign;

      if (!isDisplaced) {
        // Standard threshold: bidirectional green/red at physical/threshold
        const endAlong = thresholdAlong(frame, end);
        const elevation = a.elevationM + (b.elevationM - a.elevationM) * (endAlong / length);

        for (let across = -halfWidth; across <= halfWidth; across += 4) {
          const p = new THREE.Vector3(
            a.x + frame.ux * endAlong + frame.px * across,
            elevation + EXTERNAL_MESH_LIFT_M + 0.35,
            a.z + frame.uz * endAlong + frame.pz * across
          );
          sources.push({
            position: p.toArray(),
            color: [1, 1, 1],
            endDirection: [dirX, 0, dirZ],
            intensity: 2.5,
          });
        }
      } else {
        // Displaced threshold: green lights at threshold, red end lights at physical
        const threshAlong = thresholdAlong(frame, end);
        const threshElev = a.elevationM + (b.elevationM - a.elevationM) * (threshAlong / length);
        for (let across = -halfWidth; across <= halfWidth; across += 4) {
          const p = new THREE.Vector3(
            a.x + frame.ux * threshAlong + frame.px * across,
            threshElev + EXTERNAL_MESH_LIFT_M + 0.35,
            a.z + frame.uz * threshAlong + frame.pz * across
          );
          sources.push({
            position: p.toArray(),
            color: [0.02, 1, 0.12],
            endDirection: [dirX, 1, dirZ],
            intensity: 2.5,
          });
        }

        const physAlong = thresholdAlong(frame, { threshold: end.physical });
        const physElev = a.elevationM + (b.elevationM - a.elevationM) * (physAlong / length);
        for (let across = -halfWidth; across <= halfWidth; across += 4) {
          const p = new THREE.Vector3(
            a.x + frame.ux * physAlong + frame.px * across,
            physElev + EXTERNAL_MESH_LIFT_M + 0.35,
            a.z + frame.uz * physAlong + frame.pz * across
          );
          sources.push({
            position: p.toArray(),
            color: [1, 0.05, 0.02],
            endDirection: [dirX, 2, dirZ],
            intensity: 2.5,
          });
        }
      }
    }

    // PAPI Systems
    const papiConfigs = descriptor.lighting?.papi ?? [];
    for (const papiCfg of papiConfigs) {
      const end = descriptor.ends.find(e => e.ident === papiCfg.endIdent) ?? descriptor.ends[0];
      const isFirst = end === descriptor.ends[0];
      const sign = isFirst ? 1 : -1;
      const thresholdM = thresholdAlong(frame, end);
      const touchdownM = thresholdM + sign * (papiCfg.touchdownDistanceM ?? 300);

      // Invert pilot's right vector on reciprocal end so 'left'/'right' is always relative to incoming approach
      const pilotRight = right.clone().multiplyScalar(sign);
      const sideMult = papiCfg.side === 'right' ? 1 : -1;
      const lateralVector = pilotRight.clone().multiplyScalar(sideMult);

      const lateralDist = halfWidth + (papiCfg.lateralOffsetM ?? 15);
      const elevation = a.elevationM + (b.elevationM - a.elevationM) * (touchdownM / length);

      const papiGroup = new THREE.Group();
      papiGroup.name = `papi-${descriptor.id}-${end.ident}`;
      const units = [];
      const boxGeo = new THREE.BoxGeometry(1.4, 0.7, 1.2);
      const boxMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.8 });
      const unitCount = papiCfg.units ?? 4;
      const unitSpacing = 3.8;

      const papiCenter = new THREE.Vector3(
        a.x + frame.ux * touchdownM,
        elevation + 0.4,
        a.z + frame.uz * touchdownM
      ).addScaledVector(lateralVector, lateralDist);

      for (let u = 0; u < unitCount; u++) {
        const unitPos = papiCenter.clone().addScaledVector(lateralVector, u * unitSpacing);
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.name = `papi-box-${descriptor.id}-${end.ident}-${u}`;
        box.position.copy(unitPos);

        const heading = Math.atan2(frame.ux * sign, frame.uz * sign) + Math.PI;
        box.rotation.y = heading;

        const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const lensGeo = new THREE.PlaneGeometry(0.8, 0.45);
        const lensMesh = new THREE.Mesh(lensGeo, lensMat);
        lensMesh.position.set(0, 0, 0.61);
        box.add(lensMesh);

        papiGroup.add(box);
        units.push({ box, lensMat, position: unitPos });
      }
      group.add(papiGroup);

      papiSystems.push({
        endIdent: end.ident,
        runwayId: descriptor.id,
        units,
        center: papiCenter,
        approachDir: new THREE.Vector3(-frame.ux * sign, 0, -frame.uz * sign),
        glideslopeDeg: papiCfg.glideslopeDeg ?? 3.0,
      });
    }

    // Approach Lighting System (ALS / MALSR)
    const alsConfigs = descriptor.lighting?.approachLighting ?? [];
    for (const alsCfg of alsConfigs) {
      const end = descriptor.ends.find(e => e.ident === alsCfg.endIdent) ?? descriptor.ends[0];
      const isFirst = end === descriptor.ends[0];
      const sign = isFirst ? -1 : 1;
      const startM = thresholdAlong(frame, end);
      const lengthM = alsCfg.lengthM ?? 750;
      const count = Math.floor(lengthM / 50);

      const alsGroup = new THREE.Group();
      alsGroup.name = `als-${descriptor.id}-${end.ident}`;
      const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6);
      const mastMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
      const lightGeo = new THREE.SphereGeometry(0.25, 8, 8);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

      for (let i = 1; i <= count; i++) {
        const distM = i * 50;
        const mastAlong = startM + sign * distM;
        const mastPos = new THREE.Vector3(
          a.x + frame.ux * mastAlong,
          a.elevationM + 1.25,
          a.z + frame.uz * mastAlong
        );
        const mast = new THREE.Mesh(mastGeo, mastMat);
        mast.position.copy(mastPos);
        alsGroup.add(mast);

        const light = new THREE.Mesh(lightGeo, lightMat);
        light.position.set(mastPos.x, mastPos.y + 1.35, mastPos.z);
        alsGroup.add(light);

        const crossbar = alsCfg.crossbars?.find(cb => Math.abs(cb.distanceM - distM) < 25);
        if (crossbar) {
          const cbWidth = crossbar.widthM ?? 16;
          const barMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, cbWidth),
            mastMat
          );
          barMesh.position.set(mastPos.x, mastPos.y + 1.25, mastPos.z);
          barMesh.rotation.y = Math.atan2(frame.ux, frame.uz);
          alsGroup.add(barMesh);

          const lightCount = crossbar.lights ?? 5;
          for (let b = 0; b < lightCount; b++) {
            const cbOffset = -cbWidth * 0.5 + (b / (lightCount - 1)) * cbWidth;
            const cbLight = new THREE.Mesh(lightGeo, lightMat);
            cbLight.position.set(
              mastPos.x + frame.px * cbOffset,
              mastPos.y + 1.35,
              mastPos.z + frame.pz * cbOffset
            );
            alsGroup.add(cbLight);
          }
        }
      }
      group.add(alsGroup);
    }
  }

  // Apron Lamps
  const lamps = [];
  for (const lamp of apronLamps) {
    const x = lamp.x ?? 0;
    const y = lamp.y ?? 0;
    const z = lamp.z ?? 0;
    const height = lamp.height ?? 20;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.3, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x596574, roughness: 0.8 })
    );
    pole.position.set(x, y + height / 2, z);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.3, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe4ddc9, emissive: 0xffd69a, emissiveIntensity: 0 })
    );
    head.position.set(x, y + height, z);

    const targetPos = lamp.target
      ? (Array.isArray(lamp.target) ? lamp.target : [lamp.target.x ?? x, lamp.target.y ?? y, lamp.target.z ?? z])
      : [x, y, z];

    const light = new THREE.SpotLight(0xffdfb0, 0, height * 6, Math.PI / 3, 0.7, 2);
    light.position.copy(head.position);
    light.target.position.fromArray(targetPos);

    group.add(pole, head, light, light.target);
    lamps.push({ light, head, maximum: height * height * 16 });
    sources.push({
      position: [x, y + height, z],
      color: [1.0, 0.87, 0.69],
      intensity: 1.5,
    });
  }

  let pointsMesh = null;
  let material = null;
  if (sources.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(sources.flatMap(s => s.position), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(sources.flatMap(s => s.color), 3));
    geometry.setAttribute('endDirection', new THREE.Float32BufferAttribute(sources.flatMap(s => s.endDirection ?? [0, 0, 0]), 3));
    geometry.setAttribute('sourceIntensity', new THREE.Float32BufferAttribute(sources.map(s => s.intensity ?? 1), 1));

    material = new THREE.ShaderMaterial({
      uniforms: { brightness: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 color;
        attribute vec3 endDirection;
        attribute float sourceIntensity;
        varying vec3 lightColor;
        varying float vIntensity;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.);
          vec4 mvPosition = viewMatrix * world;
          lightColor = color;
          vIntensity = sourceIntensity;
          if (length(endDirection) > .5) {
            float d = dot(cameraPosition - world.xyz, vec3(endDirection.x, 0., endDirection.z));
            if (endDirection.y > 1.5) {
              if (d <= 0.) vIntensity = 0.; else lightColor = vec3(1., .05, .02);
            } else if (endDirection.y > 0.5) {
              if (d > 0.) vIntensity = 0.; else lightColor = vec3(.02, 1., .12);
            } else {
              lightColor = d > 0. ? vec3(1., .05, .02) : vec3(.02, 1., .12);
            }
          }
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(2600. * sourceIntensity / max(1., -mvPosition.z), 4., 40.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float brightness;
        varying vec3 lightColor;
        varying float vIntensity;
        void main() {
          float radius = length(gl_PointCoord - .5) * 2.;
          if (radius > 1.) discard;
          #include <logdepthbuf_fragment>
          float glow = exp(-radius * radius * 2.5) * (1. - smoothstep(.75, 1., radius));
          gl_FragColor = vec4(lightColor * 4. * vIntensity, glow * brightness);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    pointsMesh = new THREE.Points(geometry, material);
    pointsMesh.name = 'airport-light-halos';
    group.add(pointsMesh);
  }

  const update = (sunHeight = 0, cameraPos = null) => {
    const dusk = nightLightLevel(sunHeight);
    if (material) {
      material.uniforms.brightness.value = Math.max(0.15, dusk);
    }
    for (const { light, head, maximum } of lamps) {
      light.intensity = maximum * dusk;
      head.material.emissiveIntensity = dusk * 2;
    }

    if (cameraPos && papiSystems.length > 0) {
      for (const papi of papiSystems) {
        const dx = cameraPos.x - papi.center.x;
        const dz = cameraPos.z - papi.center.z;
        const dy = cameraPos.y - papi.center.y;
        const distAlong = dx * papi.approachDir.x + dz * papi.approachDir.z;

        if (distAlong > 30) {
          const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(dy, distAlong));
          const gs = papi.glideslopeDeg;
          const thresholds = [gs - 0.5, gs - 0.2, gs + 0.2, gs + 0.5];
          papi.units.forEach((unit, idx) => {
            const isWhite = angleDeg >= thresholds[idx];
            unit.lensMat.color.setHex(isWhite ? 0xffffff : 0xff1a1a);
          });
        } else {
          papi.units.forEach((unit, idx) => {
            unit.lensMat.color.setHex(idx < 2 ? 0xffffff : 0xff1a1a);
          });
        }
      }
    }
  };

  return {
    group,
    papiSystems,
    lamps,
    update,
    dispose: () => disposeGroup(group),
  };
}

/** Terrain facade, runway mesh and airport API for one streamed airport. */
export function createExternalAirportRegion({ airport, baseOffset = [0, 0], outsideHeight, overrides, geoOrigin = null } = {}) {
  const code = airport?.ident ?? airport?.icao ?? airport?.iata ?? airport?.code;
  const resolvedOverrides = overrides ?? getAirportOverride(code);
  const terrain = new ExternalAirportSurface({
    airport,
    baseOffset,
    outsideHeight,
    overrides: resolvedOverrides,
    geoOrigin,
  });
  const offset = terrain.baseOffset;

  const group = createExternalAirportMesh(terrain.runways);
  group.name = `external-airport-${code ?? 'region'}`;

  const taxiwayGroup = createExternalTaxiwayMesh(terrain.taxiways);
  if (taxiwayGroup.children.length > 0) {
    group.add(taxiwayGroup);
  }

  const facilitiesResult = createExternalAirportFacilities(terrain.facilities, terrain.elevationM);
  if (facilitiesResult.group.children.length > 0) {
    group.add(facilitiesResult.group);
  }

  const lightingResult = createExternalAirportLighting(terrain.runways, {
    apronLamps: terrain.apronLamps,
    baseOffset: terrain.baseOffset,
  });
  if (lightingResult.group.children.length > 0) {
    group.add(lightingResult.group);
  }

  const airportFacade = {
    isLoaded: true,
    terrain,
    isOnRunway: (x, z) => terrain.isOnRunway(x, z),
    isOnTaxiway: (x, z) => terrain.isOnTaxiway(x, z),
    isRunwaySafetyArea: (x, z) => terrain.isRunwaySafetyArea(x, z),
    update(dt, position, time, options = {}) {
      lightingResult.update(options?.sunHeight ?? 0, options?.cameraPosition ?? position);
    },
    nightLighting: lightingResult,
    getGazeTargets() {
      return facilitiesResult.gazeTargets;
    },
    hasModeledBuilding(x, z) {
      return facilitiesResult.hasModeledBuilding(x, z);
    },
    checkBuildingCollision(probes) {
      return facilitiesResult.checkCollision(probes);
    },
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
