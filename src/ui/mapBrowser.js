// Equirectangular helpers for the lobby's Korea map. Pure: no DOM.
export const MAP_WIDTH = 320;
export const MAP_HEIGHT = 240;
export const MAP_BOUNDS = Object.freeze({ west: 124, east: 132, south: 33, north: 39 });

export function projectToMap(latitude, longitude) {
  if (![latitude, longitude].every(Number.isFinite)) return null;
  const x = ((longitude - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * MAP_WIDTH;
  const y = ((MAP_BOUNDS.north - latitude) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * MAP_HEIGHT;
  if (![x, y].every(Number.isFinite) || x < 0 || x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return null;
  return { x, y };
}

export function mapCoordinates(x, y) {
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > MAP_WIDTH || y > MAP_HEIGHT) return null;
  return {
    latitude: MAP_BOUNDS.north - (y / MAP_HEIGHT) * (MAP_BOUNDS.north - MAP_BOUNDS.south),
    longitude: MAP_BOUNDS.west + (x / MAP_WIDTH) * (MAP_BOUNDS.east - MAP_BOUNDS.west),
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
