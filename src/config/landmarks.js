import { SIM_CONFIG } from './simConfig.js';
import { NEON_RIVER, bridgeToWorld } from './neonRiver.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';
import landmarkPlaces from './landmarkPlaces.json' with { type: 'json' };

// The label sits above its anchor so the pin tip stays on the point.
export const LANDMARK_LABEL_OFFSET_M = 12;

/** Default catalog: add rows to landmarkPlaces.json; no per-place code is needed. */
export const LANDMARK_PLACES = Object.freeze(landmarkPlaces.places.map(place => Object.freeze({ ...place })));

// One projector per geographic scene; every catalog row goes through the same path.
const geographicProjections = Object.freeze({
  incheon: projectToLocal,
  jeju: (latitude, longitude) => wgs84ToLocal(latitude, longitude, JEJU_ORIGIN),
});

const bridgeNames = {
  cable: ['사장교', 'Cable Bridge'],
  arch: ['아치교', 'Arch Bridge'],
  light: ['라이트 브리지', 'Light Bridge'],
};

/** Accept any catalog row shape and drop rows that cannot be placed on the map. */
export function normalizeLandmarkPlaces(places = LANDMARK_PLACES) {
  const records = [];
  for (const place of places) {
    if (!place) continue;
    const { latitude, longitude, names = {}, kind, kinds } = place;
    if (![latitude, longitude].every(Number.isFinite)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const id = place.id ?? names.en ?? names.ko ?? place.en ?? place.ko;
    if (!id) continue;
    const ko = names.ko ?? place.ko ?? names.en ?? place.en ?? id;
    const en = names.en ?? place.en ?? names.ko ?? place.ko ?? id;
    const elevationM = Number.isFinite(place.elevationM) ? place.elevationM : place.height;
    records.push({
      id, names: { ko, en }, ko, en, latitude, longitude,
      height: Number.isFinite(elevationM) ? elevationM : undefined,
      kinds: Array.isArray(kinds) ? kinds.filter(item => typeof item === 'string')
        : (typeof kind === 'string' ? [kind] : []),
    });
  }
  return records;
}

/** Locale lookup with graceful fallbacks, including local-coordinate records. */
export function landmarkName(record, language) {
  if (!record) return '';
  return record.names?.[language] ?? record[language] ?? record.en ?? record.ko ?? record.id ?? '';
}

/** Choose named places by real 3D distance to the camera, optionally by category. */
export function nearestLandmarks(records, origin, { limit = 5, maxDistanceM = 45000, kinds } = {}) {
  const wanted = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const maxSquared = maxDistanceM * maxDistanceM;
  const candidates = [];
  for (const record of records) {
    if (wanted && !record.kinds?.some(kind => wanted.has(kind))) continue;
    const dx = record.x - origin.x;
    const dy = record.height + LANDMARK_LABEL_OFFSET_M - origin.y;
    const dz = record.z - origin.z;
    const squared = dx * dx + dy * dy + dz * dz;
    if (!Number.isFinite(squared) || squared > maxSquared) continue;
    candidates.push({ record, distance: Math.sqrt(squared) });
  }
  candidates.sort((a, b) => a.distance - b.distance
    || String(a.record.id).localeCompare(String(b.record.id)));
  return Number.isFinite(limit) ? candidates.slice(0, Math.max(0, limit)) : candidates;
}

function geographicLandmarks(records, project, terrain) {
  return records.map(({ latitude, longitude, ...landmark }) => {
    const [x, z] = project(latitude, longitude);
    const ground = terrain?.getHeight?.(x, z);
    return { ...landmark, x, z,
      height: Number.isFinite(landmark.height) ? landmark.height
        : (Number.isFinite(ground) ? ground : 0) };
  });
}

export function landmarksForMap(map, terrain, airport, places = LANDMARK_PLACES) {
  const project = geographicProjections[map];
  if (project) return geographicLandmarks(normalizeLandmarkPlaces(places), project, terrain);
  if (map === 'neon') return NEON_RIVER.bridges.map(bridge => {
    const [x, z] = bridgeToWorld(bridge, 0);
    const [ko, en] = bridgeNames[bridge.id];
    return { ko, en, x, z, height: bridge.top + (bridge.rise ?? 0) + 7 };
  });
  if (map === 'lukla') {
    const tower = airport?.controlTowerData;
    return [
      { ko: '루클라 공항', en: 'Lukla Airport', x: 0, z: 0, height: 2855 },
      ...(tower ? [{ ko: '루클라 관제탑', en: 'Lukla Control Tower', x: tower.x, z: tower.z, height: tower.y + tower.height }] : []),
    ];
  }
  if (map === 'coastal') {
    const { x, y, z } = SIM_CONFIG.airport.runwayCenter;
    return [{ ko: '해안 공항', en: 'Coastal Airport', x, z, height: y + 18 }];
  }
  if (map === 'valley') {
    const finish = terrain?.terrain?.centerline?.at(-1);
    return finish ? [{ ko: '계곡 코스 종점', en: 'Valley Course Finish', x: finish.x, z: finish.z,
      height: terrain.getHeight(finish.x, finish.z) + 20 }] : [];
  }
  return [];
}
