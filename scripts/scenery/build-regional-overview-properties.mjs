// The z12 archive omits height, floors and use. Join the two PoCs offline by
// MVT feature ID so a distant silhouette never needs a z14 network request.
import { writeFile } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { buildingArchiveUrl } from '../../src/geospatial/buildingArchive.js';
import { regionalBuildingBounds } from '../../src/geospatial/regionalBuildingStyle.js';
import { tileToWgs84, wgs84ToTile } from '../../src/geospatial/TileCoordinateSystem.js';

const archive = new PMTiles(buildingArchiveUrl);
async function features(z, x, y) {
  const response = await archive.getZxy(z, x, y);
  const layer = response && new VectorTile(new PbfReader(response.data)).layers.building;
  return Array.from({ length: layer?.length ?? 0 }, (_, i) => layer.feature(i));
}

const rows = new Map();
for (const [west, south, east, north] of regionalBuildingBounds) {
  const nw = wgs84ToTile(north, west, 12);
  const se = wgs84ToTile(south, east, 12);
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) {
      const ids = new Set();
      for (const feature of await features(12, x, y)) {
        const [left, top, right, bottom] = feature.bbox();
        const center = tileToWgs84(x + (left + right) / (2 * feature.extent),
          y + (top + bottom) / (2 * feature.extent), 12);
        if (center.longitude >= west && center.longitude <= east &&
            center.latitude >= south && center.latitude <= north) ids.add(feature.id);
      }
      for (let dx = 0; dx < 4; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          for (const { id, properties } of await features(14, x * 4 + dx, y * 4 + dy)) {
            if (!ids.has(id) || id == null) continue;
            const tags = Object.fromEntries(['height', 'num_floors', 'class', 'subtype', 'roof_color']
              .filter(key => properties[key] != null).map(key => [key, properties[key]]));
            if (Object.keys(tags).length) rows.set(String(id), tags);
          }
        }
      }
    }
  }
}
if (!rows.size) throw new Error('No matching overview attributes found');
const lines = [...rows.keys()].sort().map(id => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(rows.get(id)));
await writeFile(new URL('../../src/config/regionalOverviewProperties.json', import.meta.url),
  '{\n' + lines.join(',\n') + '\n}\n');
console.log('Wrote properties for', rows.size, 'overview features');
