import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { tileToWgs84 } from './TileCoordinateSystem.js';

export const ATLAS_ZOOM = 7;
export const regionalAtlas = new PMTiles(`${import.meta.env?.BASE_URL ?? '/'}data/regional-chart/atlas.pmtiles`);

/** Decode once per tile. Keep WGS84 so every sheet uses the aircraft's projection. */
export function decodeAtlasTile(data, tile) {
  const features = [];
  if (!data) return features;
  const { layers } = new VectorTile(new PbfReader(data));
  for (const [kind, layer] of Object.entries(layers)) {
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
      const lines = feature.loadGeometry().map(line => line.map(({ x, y }) => {
        const point = tileToWgs84(tile.x + x / feature.extent, tile.y + y / feature.extent, tile.zoom);
        bounds.west = Math.min(bounds.west, point.longitude);
        bounds.east = Math.max(bounds.east, point.longitude);
        bounds.south = Math.min(bounds.south, point.latitude);
        bounds.north = Math.max(bounds.north, point.latitude);
        return point;
      }));
      features.push({ kind, ...feature.properties, lines, bounds });
    }
  }
  return features;
}

/** Cull whole features before projecting vertices or testing region label anchors. */
export function atlasOnSheet(features, { north, south, east, west }) {
  return features.filter(({ bounds: b }) => b.north >= south && b.south <= north &&
    (west > east ? b.east >= west || b.west <= east : b.east >= west && b.west <= east));
}
