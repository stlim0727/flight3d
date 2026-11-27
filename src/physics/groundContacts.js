// Implementation lives in the independently versioned flightsim-core package.
import {
  BODY_CONTACTS,
  BODY_SUPPORT_POINTS,
  C172_BODY_SUPPORT_POINTS,
} from '@stlim0727/flightsim-core/physics/groundContacts.js';

export {
  BODY_CONTACTS,
  BODY_SUPPORT_POINTS,
  C172_BODY_SUPPORT_POINTS,
};

const VALID_BODY_IDS = new Set(BODY_CONTACTS.map(point => point.id));
const NORMALIZED_SUPPORT_SETS = new WeakSet([BODY_SUPPORT_POINTS, C172_BODY_SUPPORT_POINTS]);
const NORMALIZED_SUPPORT_CACHE = new WeakMap();

function extractPosition(value) {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) {
    return [value[0], value[1], value[2]];
  }
  if (value && typeof value === 'object' && [value.x, value.y, value.z].every(Number.isFinite)) {
    return [value.x, value.y, value.z];
  }
  return null;
}

/** Build scaled canonical body support points for an aircraft lacking explicit hull patches. */
export function defaultBodySupportPoints({ wingspanM = 11, lengthM = 8, cgGroundHeightM = 1.3 } = {}) {
  const halfSpan = Math.max(2, Number.isFinite(wingspanM) && wingspanM > 0 ? wingspanM * 0.5 : 5.5);
  const halfLength = Math.max(2, Number.isFinite(lengthM) && lengthM > 0 ? lengthM * 0.5 : 4);
  const clearance = Number.isFinite(cgGroundHeightM) && cgGroundHeightM > 0 ? cgGroundHeightM : 1.3;
  const bellyY = -Math.max(0.25, Math.min(clearance * 0.45, clearance - 0.55));
  const noseY = bellyY * 0.85;
  const tailY = Math.max(0.2, Math.abs(bellyY) * 0.6);
  const wingY = Math.max(0.2, Math.abs(bellyY) * 0.8);
  const engineX = Math.min(1.5, halfSpan * 0.25);

  const result = Object.freeze([
    ['engineL', [-engineX, noseY, -halfLength * 0.55]],
    ['engineR', [engineX, noseY, -halfLength * 0.55]],
    ['belly', [0, bellyY, 0]],
    ['nose', [0, noseY, -halfLength * 0.85]],
    ['tail', [0, tailY, halfLength * 0.9]],
    ['wingL', [-halfSpan, wingY, -halfLength * 0.08]],
    ['wingR', [halfSpan, wingY, -halfLength * 0.08]],
  ].map(([id, position], index) => Object.freeze({
    id,
    key: `${id}:${index}`,
    position: Object.freeze(position),
    weight: 1,
  })));
  NORMALIZED_SUPPORT_SETS.add(result);
  return result;
}

/**
 * Normalize array or keyed-map `bodySupportPoints` into LandingGear's canonical
 * `{ id, key, position: [x, y, z], weight }[]` format with valid BODY_CONTACTS IDs.
 */
export function normalizeBodySupportPoints(raw, fallback = BODY_SUPPORT_POINTS) {
  let rawEntries;
  if (Array.isArray(raw)) {
    rawEntries = raw.map(item => ({
      rawId: item?.id,
      position: extractPosition(item?.position ?? item),
      key: item?.key,
      weight: item?.weight,
    }));
  } else if (raw && typeof raw === 'object') {
    rawEntries = Object.entries(raw).map(([mapKey, value]) => ({
      rawId: value?.id ?? mapKey,
      position: extractPosition(value?.position ?? value),
      key: value?.key,
      weight: value?.weight,
    }));
  } else {
    return fallback;
  }

  const valid = rawEntries.filter(entry => entry.position !== null);
  if (valid.length === 0) return fallback;

  const counts = new Map();
  const mapped = valid.map(entry => {
    const id = VALID_BODY_IDS.has(entry.rawId) ? entry.rawId : 'belly';
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return { ...entry, id };
  });

  const result = Object.freeze(mapped.map((entry, index) => Object.freeze({
    id: entry.id,
    key: typeof entry.key === 'string' && entry.key ? entry.key : `${entry.id}:${index}`,
    position: Object.freeze(entry.position),
    weight: Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 1 / counts.get(entry.id),
  })));
  NORMALIZED_SUPPORT_SETS.add(result);
  return result;
}

/** O(1) allocation-free support-point resolver for the 120 Hz physics substep. */
export function resolveBodySupportPoints(raw, fallback = BODY_SUPPORT_POINTS) {
  if (!raw || typeof raw !== 'object') return fallback;
  if (NORMALIZED_SUPPORT_SETS.has(raw)) return raw;
  const cached = NORMALIZED_SUPPORT_CACHE.get(raw);
  if (cached && cached.fallback === fallback) return cached.result;
  const result = normalizeBodySupportPoints(raw, fallback);
  NORMALIZED_SUPPORT_CACHE.set(raw, { fallback, result });
  return result;
}
