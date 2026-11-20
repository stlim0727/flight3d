import { SIM_CONFIG } from './simConfig.js';
import { NEON_RIVER, bridgeToWorld } from './neonRiver.js';
import { JEJU_ORIGIN } from '../geospatial/CorridorCoordinateSystem.js';
import { wgs84ToLocal } from '../geospatial/TileCoordinateSystem.js';
import { projectToLocal } from '../geospatial/incheon.js';
import landmarkPlaces from './landmarkPlaces.json' with { type: 'json' };

// The label sits above its anchor so the pin tip stays on the point.
export const LANDMARK_LABEL_OFFSET_M = 12;
export const LANDMARK_IMPORTANCE_LEVELS = 5;

const clampImportance = value => Number.isFinite(value)
  ? Math.min(LANDMARK_IMPORTANCE_LEVELS, Math.max(1, Math.round(value)))
  : LANDMARK_IMPORTANCE_LEVELS;

/** Higher importance levels are visible from proportionally farther away. */
export function landmarkRangeM(record, maxDistanceM = 45000) {
  return maxDistanceM * clampImportance(record?.importance) / LANDMARK_IMPORTANCE_LEVELS;
}

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
    const record = {
      id, names: { ko, en }, ko, en, latitude, longitude,
      height: Number.isFinite(elevationM) ? elevationM : undefined,
      importance: clampImportance(place.importance),
      kinds: Array.isArray(kinds) ? kinds.filter(item => typeof item === 'string')
        : (typeof kind === 'string' ? [kind] : []),
    };
    if (Number.isFinite(place.prominence)) record.prominence = Math.min(1, Math.max(0, place.prominence));
    if (typeof place.wikidata === 'string' && place.wikidata) record.wikidata = place.wikidata;
    if (typeof place.groundRelative === 'boolean') record.groundRelative = place.groundRelative;
    if (Number.isFinite(place.heightOffsetM)) record.heightOffsetM = place.heightOffsetM;
    if (Number.isFinite(place.elevationM)) record.elevationM = place.elevationM;
    if (typeof place.streamed === 'boolean') record.streamed = place.streamed;
    if (typeof place.clipped === 'boolean') record.clipped = place.clipped;
    records.push(record);
  }
  return records;
}

/** Resolve label anchor altitude in world meters, updating dynamically with streamed terrain. */
export function resolveLandmarkHeight(record, terrain) {
  if (!record) return 0;
  if (!record.groundRelative && Number.isFinite(record.height)) return record.height;
  const ground = terrain?.getHeight?.(record.x, record.z);
  const base = Number.isFinite(ground) ? ground : 0;
  const offset = Number.isFinite(record.heightOffsetM) ? record.heightOffsetM : 0;
  return Number.isFinite(record.elevationM) ? Math.max(record.elevationM, base + offset) : base + offset;
}

/** Prominence-weighted priority score so major landmarks outrank minor nearby POIs. */
export function landmarkPriorityScore(record, distanceM = 0) {
  const importance = clampImportance(record?.importance);
  const prominence = Number.isFinite(record?.prominence) ? Math.min(1, Math.max(0, record.prominence)) : 0.5;
  const distance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  return (2.4 ** (importance - 1)) * (0.85 + 0.3 * prominence) / (distance / 1000 + 1.5);
}

/** Locale lookup with graceful fallbacks, including local-coordinate records. */
export function landmarkName(record, language) {
  if (!record) return '';
  return record.names?.[language] ?? record[language] ?? record.en ?? record.ko ?? record.id ?? '';
}

/** Choose named places by prominence-weighted priority within their visible range. */
export function nearestLandmarks(records, origin, { limit = 5, maxDistanceM = 45000, kinds, terrain } = {}) {
  const wanted = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const candidates = [];
  for (const record of records) {
    if (wanted && !record.kinds?.some(kind => wanted.has(kind))) continue;
    const dx = record.x - origin.x;
    const dy = resolveLandmarkHeight(record, terrain) + LANDMARK_LABEL_OFFSET_M - origin.y;
    const dz = record.z - origin.z;
    const squared = dx * dx + dy * dy + dz * dz;
    if (!Number.isFinite(squared) || squared > landmarkRangeM(record, maxDistanceM) ** 2) continue;
    const distance = Math.sqrt(squared);
    candidates.push({ record, distance, score: landmarkPriorityScore(record, distance) });
  }
  candidates.sort((a, b) => b.score - a.score
    || a.distance - b.distance
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
  const project = geographicProjections[map]
    ?? (places !== LANDMARK_PLACES && Number.isFinite(terrain?.origin?.latitude) && Number.isFinite(terrain?.origin?.longitude)
      ? (latitude, longitude) => wgs84ToLocal(latitude, longitude, terrain.origin)
      : null);
  if (project) return geographicLandmarks(normalizeLandmarkPlaces(places), project, terrain);
  if (map === 'neon') return NEON_RIVER.bridges.map(bridge => {
    const [x, z] = bridgeToWorld(bridge, 0);
    const [ko, en] = bridgeNames[bridge.id];
    return { ko, en, x, z, height: bridge.top + (bridge.rise ?? 0) + 7, kinds: ['bridge'] };
  });
  if (map === 'lukla') {
    const tower = airport?.controlTowerData;
    return [
      { ko: '루클라 공항', en: 'Lukla Airport', x: 0, z: 0, height: 2855, kinds: ['airport'] },
      ...(tower ? [{ ko: '루클라 관제탑', en: 'Lukla Control Tower', x: tower.x, z: tower.z, height: tower.y + tower.height, kinds: ['tower'] }] : []),
    ];
  }
  if (map === 'coastal') {
    const { x, y, z } = SIM_CONFIG.airport.runwayCenter;
    return [{ ko: '해안 공항', en: 'Coastal Airport', x, z, height: y + 18, kinds: ['airport'] }];
  }
  if (map === 'valley') {
    const finish = terrain?.terrain?.centerline?.at(-1);
    return finish ? [{ ko: '계곡 코스 종점', en: 'Valley Course Finish', x: finish.x, z: finish.z,
      height: terrain.getHeight(finish.x, finish.z) + 20, kinds: ['attraction'] }] : [];
  }
  return [];
}
