// Web Mercator raster tiles placed in the lobby map's equirectangular SVG space.
// Tiles are decorative: the local coastline and markers stay authoritative.
import { MAP_BOUNDS, MAP_HEIGHT, MAP_WIDTH } from './mapBrowser.js';

const MIN_ZOOM = 4;
const MAX_ZOOM = 9;

/** Esri World Street Map serves unauthenticated tiles with road and place labels. */
export function mapTileUrl(zoom, tileX, tileY) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${tileY}/${tileX}`;
}
/** Choose the tile zoom whose native pixels best match the on-screen viewBox. */
export function mapTileZoomFor(viewBoxWidth) {
  if (!Number.isFinite(viewBoxWidth) || viewBoxWidth <= 0) return 6;
  const zoom = 6 + Math.round(Math.log2(Math.max(MAP_WIDTH / viewBoxWidth, 1 / 4)));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const longitudeToTileX = (longitude, zoom) => ((longitude + 180) / 360) * 2 ** zoom;
const latitudeToTileY = (latitude, zoom) => {
  // Clamp to Web Mercator's usable latitude before taking the sine logarithm.
  const limited = clamp(latitude, -85.0511, 85.0511) * Math.PI / 180;
  return (0.5 - Math.log((1 + Math.sin(limited)) / (1 - Math.sin(limited))) / (4 * Math.PI)) * 2 ** zoom;
};
const tileXToLongitude = (tileX, zoom) => (tileX / 2 ** zoom) * 360 - 180;
const tileYToLatitude = (tileY, zoom) => Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / 2 ** zoom))) * 180 / Math.PI;
const mapX = longitude => ((longitude - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * MAP_WIDTH;
const mapY = latitude => ((MAP_BOUNDS.north - latitude) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * MAP_HEIGHT;

/** Tiles covering a `x y width height` viewBox, positioned in map coordinates. */
export function tilesForViewBox(viewBox) {
  const values = String(viewBox).split(/\s+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return [];
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return [];
  const west = MAP_BOUNDS.west + (x / MAP_WIDTH) * (MAP_BOUNDS.east - MAP_BOUNDS.west);
  const east = MAP_BOUNDS.west + ((x + width) / MAP_WIDTH) * (MAP_BOUNDS.east - MAP_BOUNDS.west);
  const north = MAP_BOUNDS.north - (y / MAP_HEIGHT) * (MAP_BOUNDS.north - MAP_BOUNDS.south);
  const south = MAP_BOUNDS.north - ((y + height) / MAP_HEIGHT) * (MAP_BOUNDS.north - MAP_BOUNDS.south);
  const zoom = mapTileZoomFor(width);
  const worldTiles = 2 ** zoom;
  const firstX = clamp(Math.floor(longitudeToTileX(west, zoom)), 0, worldTiles - 1);
  const lastX = clamp(Math.floor(longitudeToTileX(east, zoom)), 0, worldTiles - 1);
  const firstY = clamp(Math.floor(latitudeToTileY(north, zoom)), 0, worldTiles - 1);
  const lastY = clamp(Math.floor(latitudeToTileY(south, zoom)), 0, worldTiles - 1);
  const tiles = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const left = mapX(tileXToLongitude(tileX, zoom));
      const right = mapX(tileXToLongitude(tileX + 1, zoom));
      const top = mapY(tileYToLatitude(tileY, zoom));
      const bottom = mapY(tileYToLatitude(tileY + 1, zoom));
      if (right <= x || left >= x + width || bottom <= y || top >= y + height) continue;
      tiles.push({
        url: mapTileUrl(zoom, tileX, tileY),
        x: left, y: top, width: right - left, height: bottom - top,
        zoom, tileX, tileY,
      });
    }
  }
  return tiles;
}
