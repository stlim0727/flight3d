// Web Mercator raster tiles in the lobby map's 1024x1024 SVG space.
// The projection matches Esri/OSM tiles exactly, so markers and tiles align at any zoom.
import { MAP_HEIGHT, MAP_WIDTH } from './mapBrowser.js';

const MAX_ZOOM = 12;

/** Esri World Street Map serves unauthenticated tiles with road and place labels. */
export function mapTileUrl(zoom, tileX, tileY) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${tileY}/${tileX}`;
}

/** Tile zoom equals the viewBox halving level: one tile spans 256 CSS pixels. */
export function mapTileZoomFor(viewBoxWidth) {
  if (!Number.isFinite(viewBoxWidth) || viewBoxWidth <= 0) return 0;
  return Math.max(0, Math.min(MAX_ZOOM, Math.round(Math.log2(MAP_WIDTH / viewBoxWidth))));
}

/** Tiles covering a `x y width height` viewBox; x wraps into repeating worlds. */
export function tilesForViewBox(viewBox) {
  const values = String(viewBox).split(/\s+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return [];
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return [];
  const zoom = mapTileZoomFor(width);
  const worldTiles = 2 ** zoom;
  const firstX = Math.floor((x / MAP_WIDTH) * worldTiles);
  const lastX = Math.floor(((x + width) / MAP_WIDTH) * worldTiles);
  const firstY = Math.max(0, Math.min(worldTiles - 1, Math.floor((y / MAP_HEIGHT) * worldTiles)));
  const lastY = Math.max(0, Math.min(worldTiles - 1, Math.floor(((y + height) / MAP_HEIGHT) * worldTiles)));
  const tiles = [];
  const tileWidth = MAP_WIDTH / worldTiles;
  const tileHeight = MAP_HEIGHT / worldTiles;
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      const left = tileX * tileWidth;
      const top = tileY * tileHeight;
      if (left + tileWidth <= x || left >= x + width || top + tileHeight <= y || top >= y + height) continue;
      const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
      tiles.push({
        url: mapTileUrl(zoom, wrappedX, tileY),
        x: left, y: top, width: tileWidth, height: tileHeight,
        zoom, tileX: wrappedX, tileY,
      });
    }
  }
  return tiles;
}
