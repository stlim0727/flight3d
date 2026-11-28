import { Color } from 'three';

// Inclusive WGS84 PoC bounds. Heights are visual estimates in metres.
const neutral = [['#aaa7a1', 3], ['#888b89', 2]];
const regions = [
  {
    bounds: [126.61, 37.36, 126.68, 37.42], // Songdo
    general: { height: [6, 15], colors: neutral, shape: 'flat' },
    uses: {
      apartments: { height: [48, 96], colors: neutral, shape: 'flat' },
      warehouse: { height: [5, 12], colors: [['#8597a3', 3], ['#a6a6a2', 2]], shape: 'flat' },
    },
  },
  {
    bounds: [126.919, 33.454, 126.94, 33.476], // Seongsan-ri village, Jeju
    general: { height: [4, 10], colors: neutral, shape: 'flat' },
    uses: {
      house: { height: [3.2, 7], colors: [['#427aaf', 4], ['#56835d', 4], ['#bb7049', 2]], shape: 'hipped' },
    },
  },
];
export const regionalBuildingBounds = regions.map(region => region.bounds);
const shapes = new Set([
  'flat', 'gabled', 'hipped', 'half_hipped', 'pyramidal', 'gambrel', 'mansard',
  'dome', 'onion', 'round', 'skillion', 'saltbox', 'sawtooth', 'spherical',
]);

function mappedColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(ch => ch + ch).join('');
  return Object.hasOwn(Color.NAMES, color) ? '#' + Color.NAMES[color].toString(16).padStart(6, '0') : null;
}

// FNV-1a with a final avalanche to decorrelate neighbouring numeric IDs.
function fraction(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return ((hash ^ (hash >>> 13)) >>> 0) / 0x100000000;
}

function weightedColor(colors, roll) {
  let remaining = roll * colors.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [color, weight] of colors) {
    remaining -= weight;
    if (remaining < 0) return color;
  }
}

// Pass the canonical building location (not a clipped tile centroid).
// A null roofColor leaves the existing roof material tint intact.
export function resolveBuildingStyle({ latitude, longitude, id, properties = {} }) {
  const region = Number.isFinite(latitude) && Number.isFinite(longitude)
    && regions.find(({ bounds: [west, south, east, north] }) =>
      longitude >= west && longitude <= east && latitude >= south && latitude <= north);
  const use = [properties.class, properties.subtype].find(key => region && Object.hasOwn(region.uses, key));
  const profile = region && (use ? region.uses[use] : region.general);
  const key = id ?? properties.id;
  const seed = key == null || key === '' ? `geo:${latitude},${longitude}` : `id:${key}`;
  const { height, num_floors: floors, roof_shape: shape } = properties;
  let heightM;
  if (Number.isFinite(height) && height > 0 && height <= 1500) heightM = height;
  else if (Number.isFinite(floors) && floors > 0 && floors <= 300) heightM = floors * 3.2;
  else if (profile) {
    const [min, max] = profile.height;
    heightM = min + fraction(seed + '/height') * (max - min);
  } else heightM = 9;
  return {
    heightM,
    roofColor: mappedColor(properties.roof_color) ?? (profile ? weightedColor(profile.colors, fraction(seed + '/color')) : null),
    roofShape: shapes.has(shape) ? shape : (profile?.shape ?? 'flat'),
  };
}
