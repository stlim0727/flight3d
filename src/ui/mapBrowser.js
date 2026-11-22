// Equirectangular helpers for the lobby's compact Korea map. Pure: no DOM.
export const MAP_WIDTH = 320;
export const MAP_HEIGHT = 180;
const BOUNDS = Object.freeze({ west: 124, east: 132, south: 33, north: 39 });

export function projectToMap(latitude, longitude) {
  if (![latitude, longitude].every(Number.isFinite)) return null;
  const x = ((longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * MAP_WIDTH;
  const y = ((BOUNDS.north - latitude) / (BOUNDS.north - BOUNDS.south)) * MAP_HEIGHT;
  if (![x, y].every(Number.isFinite) || x < 0 || x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return null;
  return { x, y };
}

export function mapCoordinates(x, y) {
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > MAP_WIDTH || y > MAP_HEIGHT) return null;
  return {
    latitude: BOUNDS.north - (y / MAP_HEIGHT) * (BOUNDS.north - BOUNDS.south),
    longitude: BOUNDS.west + (x / MAP_WIDTH) * (BOUNDS.east - BOUNDS.west),
  };
}

/** Return a viewBox centred on a place, clamped to the map bounds. */
export function mapViewBoxFor(latitude, longitude, zoom = 2) {
  const point = projectToMap(latitude, longitude);
  if (!point) return `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`;
  const factor = Number.isFinite(zoom) && zoom >= 1 ? Math.min(zoom, 4) : 2;
  const width = MAP_WIDTH / factor;
  const height = MAP_HEIGHT / factor;
  const x = Math.max(0, Math.min(MAP_WIDTH - width, point.x - width / 2));
  const y = Math.max(0, Math.min(MAP_HEIGHT - height, point.y - height / 2));
  return `${x} ${y} ${width} ${height}`;
}
