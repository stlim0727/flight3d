// Web Mercator helpers for the lobby's global map. Pure: no DOM.
export const MAP_WIDTH = 1024;
export const MAP_HEIGHT = 1024;
export const MAP_BOUNDS = Object.freeze({ west: -180, east: 180, south: -85.0511, north: 85.0511 });
const MAX_LATITUDE = MAP_BOUNDS.north;

export function projectToMap(latitude, longitude) {
  if (![latitude, longitude].every(Number.isFinite) || longitude < MAP_BOUNDS.west || longitude > MAP_BOUNDS.east) return null;
  const x = ((longitude - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * MAP_WIDTH;
  const limited = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const sine = Math.sin(limited * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * MAP_HEIGHT;
  if (![x, y].every(Number.isFinite) || x < 0 || x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return null;
  return { x, y };
}

export function mapCoordinates(x, y) {
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > MAP_WIDTH || y > MAP_HEIGHT) return null;
  const longitude = MAP_BOUNDS.west + (x / MAP_WIDTH) * (MAP_BOUNDS.east - MAP_BOUNDS.west);
  const latitude = Math.atan(Math.sinh(Math.PI - (y / MAP_HEIGHT) * 2 * Math.PI)) * 180 / Math.PI;
  return { latitude, longitude };
}

/** Return a viewBox centred on a place at a tile zoom level, clamped to the world. */
export function mapViewBoxFor(latitude, longitude, zoom = 6) {
  const point = projectToMap(latitude, longitude);
  if (!point) return `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`;
  const level = Number.isFinite(zoom) ? Math.max(0, Math.min(12, Math.round(zoom))) : 6;
  const width = MAP_WIDTH / 2 ** level;
  const height = MAP_HEIGHT / 2 ** level;
  const x = Math.max(0, Math.min(MAP_WIDTH - width, point.x - width / 2));
  const y = Math.max(0, Math.min(MAP_HEIGHT - height, point.y - height / 2));
  return `${x} ${y} ${width} ${height}`;
}

/** Grow a viewBox to match the displayed map's aspect ratio without leaving the bounds. */
export function fitMapViewBoxToAspect(viewBox, aspect) {
  const values = String(viewBox).split(/\s+/).map(Number);
  const [x, y, width, height] = values;
  if (values.length !== 4 || ![x, y, width, height, aspect].every(Number.isFinite)
    || width <= 0 || height <= 0 || aspect <= 0) return viewBox;
  let nextWidth;
  let nextHeight;
  if (width / height > aspect) {
    nextHeight = Math.min(MAP_HEIGHT, width / aspect);
    nextWidth = Math.min(MAP_WIDTH, nextHeight * aspect);
    nextHeight = nextWidth / aspect;
  } else {
    nextWidth = Math.min(MAP_WIDTH, height * aspect);
    nextHeight = Math.min(MAP_HEIGHT, nextWidth / aspect);
    nextWidth = nextHeight * aspect;
  }
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const nextX = Math.max(0, Math.min(MAP_WIDTH - nextWidth, centerX - nextWidth / 2));
  const nextY = Math.max(0, Math.min(MAP_HEIGHT - nextHeight, centerY - nextHeight / 2));
  return `${nextX.toFixed(2)} ${nextY.toFixed(2)} ${nextWidth.toFixed(2)} ${nextHeight.toFixed(2)}`;
}
