import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PMTiles } from 'pmtiles';
import { ATLAS_ZOOM, atlasOnSheet, decodeAtlasTile } from '../src/geospatial/regionalAtlas.js';
import { wgs84ToTile } from '../src/geospatial/TileCoordinateSystem.js';
import { chartRunwayBoxes, layoutAtlasNames, overlaps } from '../src/ui/regionalChartNames.js';

const file = await readFile(new URL('../public/data/regional-chart/atlas.pmtiles', import.meta.url));
const archive = new PMTiles({
  getKey: () => 'test-chart',
  getBytes: async (start, length) => ({ data: Uint8Array.from(file.subarray(start, start + length)).buffer }),
});

async function around(lat, lon) {
  const tile = wgs84ToTile(lat, lon, ATLAS_ZOOM);
  const result = await archive.getZxy(tile.zoom, tile.x, tile.y);
  return decodeAtlasTile(result?.data, tile);
}

test('shipped chart tiles preserve city coordinates, provinces and border lines', async () => {
  for (const [lat, lon, city, province] of [
    [37.478, 126.640, 'Incheon', 'Incheon'], [35.982, 126.716, 'Gunsan', 'Jeonbuk State'],
    [34.807, 126.396, 'Mokpo', 'South Jeolla'], [33.510, 126.522, 'Jeju', 'Jeju'],
    [27.688, 86.731, 'Lukla', 'Koshi'], [40.714, -74.006, 'New York', 'New York'],
  ]) {
    const features = await around(lat, lon);
    const town = features.find(f => f.kind === 'cities' && f.en.startsWith(city));
    assert.ok(town, city);
    const point = town.lines[0][0];
    assert.ok(Math.abs(point.latitude - lat) < .03 && Math.abs(point.longitude - lon) < .03, city);
    assert.ok(features.some(f => f.kind === 'regions' && f.en === province && f.ko), province);
    if (province !== 'Jeju') assert.ok(features.some(f => f.kind === 'borders'), province);
  }
});

test('open ocean has no manufactured labels or boundaries', async () => {
  assert.deepEqual(await around(0, -145), []);
});

test('a sheet crossing the date line retains only its two neighbouring strips', () => {
  const features = [-179.9, 0, 179.9].map(lon => ({ bounds: { west: lon, east: lon, north: 1, south: 0 } }));
  assert.deepEqual(atlasOnSheet(features, { west: 179.5, east: -179.5, north: 2, south: -1 }),
    [features[0], features[2]]);
});

test('a city beside the airport gets space on a portrait sheet with a movable province label', () => {
  const runway = chartRunwayBoxes([{ from: [137, 184], to: [158, 176], widthM: 45 }], xy => xy, 155);
  const reserved = [...runway, { x: 148, y: 165, halfWidth: 24, halfHeight: 10 }];
  const aircraft = { x: 194, y: 180, halfWidth: 13, halfHeight: 13 };
  const ctx = { measureText: text => ({ width: text.length * 12 }), isPointInPath: (_path, _x, y) => y >= 174 };
  const atlas = { cities: [{ ko: '제주시', x: 165, y: 180 }], regions: new Map([['jeju', { ko: '제주특별자치도' }]]) };
  const names = layoutAtlasNames(atlas, { ctx, width: 388, height: 361, language: 'ko', reserved, aircraft });
  assert.deepEqual(names.map(n => n.text), ['제주시', '제주특별자치도']);
  assert.ok(names.every(n => [aircraft, ...reserved].every(b => !overlaps(n, b))));
  assert.equal(overlaps(...names), false);
});

test('runway reservations cover the whole diagonal without blocking its unused corners', () => {
  const boxes = chartRunwayBoxes([{ from: [20, 10], to: [100, 90], widthM: 40 }], xy => xy, 10);
  const occupied = (x, y) => boxes.some(b => overlaps(b, { x, y, halfWidth: 1, halfHeight: 1 }));
  assert.ok(occupied(20, 10) && occupied(55, 45) && occupied(100, 90));
  assert.equal(occupied(25, 85), false);
});
