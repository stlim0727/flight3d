import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PbfWriter } from 'pbf';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import { buildGeographicGreenTile, GeographicGreenSpace } from '../src/environment/GeographicGreenSpace.js';

function tileData(layers) {
  const writer = new PbfWriter();
  for (const [name, features] of Object.entries(layers)) {
    writer.writeMessage(3, (_, layer) => {
      layer.writeStringField(1, name);
      layer.writeVarintField(15, 2);
      layer.writeVarintField(5, 4096);
      const keys = [];
      const values = [];
      const zigzag = value => (value << 1) ^ (value >> 31);
      for (const feature of features) {
        const tags = Object.entries(feature.properties).flatMap(([key, value]) => {
          let index = keys.indexOf(key);
          if (index < 0) { keys.push(key); index = keys.length - 1; }
          let valueIndex = values.indexOf(String(value));
          if (valueIndex < 0) { values.push(String(value)); valueIndex = values.length - 1; }
          return [index, valueIndex];
        });
        layer.writeMessage(2, (_, message) => {
          message.writeVarintField(3, 3);
          if (tags.length) message.writePackedVarint(2, tags);
          const commands = [];
          let px = 0;
          let py = 0;
          for (const ring of feature.rings ?? [feature.points]) {
            commands.push(9, zigzag(ring[0][0] - px), zigzag(ring[0][1] - py));
            px = ring[0][0];
            py = ring[0][1];
            commands.push(2 | ((ring.length - 1) << 3));
            for (const [x, y] of ring.slice(1)) {
              commands.push(zigzag(x - px), zigzag(y - py));
              px = x;
              py = y;
            }
            commands.push(15);
          }
          message.writePackedVarint(4, commands);
        }, null);
      }
      for (const key of keys) layer.writeStringField(3, key);
      for (const value of values) layer.writeMessage(4, (_, item) => item.writeStringField(1, value), null);
    }, null);
  }
  return writer.finish();
}

const square = [[100, 100], [300, 100], [300, 300], [100, 300]];
const tile = { x: 6973, y: 3175 };
const project = (latitude, longitude) => [(longitude - 126.44) * 100000, -(latitude - 37.46) * 100000];
const terrain = { getHeight: () => 44, isWater: () => false };
const data = () => tileData({
  land_use: [
    { properties: { class: 'park' }, points: square },
    { properties: { class: 'commercial' }, points: square.map(([x, y]) => [x + 500, y]) },
  ],
  land_cover: [{ properties: { class: 'forest' }, points: square.map(([x, y]) => [x + 1000, y]) }],
});

test('streams park and forest polygons but not commercial land use', () => {
  const geometry = buildGeographicGreenTile(data(), tile, project, terrain);
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count >= 8);
  const first = geometry.attributes.color;
  const expected = new THREE.Color(0x4a7a3a);
  assert.ok(Math.abs(first.getX(0) - expected.r) < 1e-6);
  assert.equal(first.count, geometry.attributes.position.count, 'one color per vertex, not per triangle index');
  const forest = new THREE.Color(0x3f6a33);
  assert.ok([...Array(first.count).keys()].some(i => Math.abs(first.getX(i) - forest.r) < 1e-6));
  geometry.dispose();
  assert.equal(buildGeographicGreenTile(data(), tile, project, { ...terrain, isWater: () => true }), null);
});

test('excludes polygons by center and keeps independent detail tiles', async () => {
  const archive = { getZxy: async () => ({ data: data() }) };
  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: (candidate, zoom) => zoom === 13 } };
  const origin = { latitude: 37.46, longitude: 126.44 };
  const frame = async (layer) => {
    for (let i = 0; i < 12; i++) {
      layer.update({ x: 0, y: 100, z: 0 });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  const excluded = new GeographicGreenSpace({ origin, project, terrain: surface, archive, exclude: () => true });
  await frame(excluded);
  assert.equal(excluded.tiles.size, 9);
  assert.ok([...excluded.tiles.values()].every(mesh => mesh === null));
  excluded.dispose();

  const live = new GeographicGreenSpace({ origin, project, terrain: surface, archive });
  await frame(live);
  assert.equal(live.tiles.size, 9);
  assert.equal(live.group.children.length, 9);
  live.dispose();
});

test('keeps every outer ring of a multipolygon', () => {
  const data = tileData({
    land_use: [{
      properties: { class: 'park' },
      rings: [square, square.map(([x, y]) => [x + 600, y])],
    }],
  });
  const geometry = buildGeographicGreenTile(data, tile, project, terrain);
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count >= 8);
  assert.equal(geometry.attributes.color.count, geometry.attributes.position.count);
  geometry.dispose();
});

test('subdivides green polygons when interior terrain rises above the boundary', () => {
  const { latitude, longitude } = tileToWgs84(tile.x + 200 / 4096, tile.y + 200 / 4096, 13);
  const [cx, cz] = project(latitude, longitude);
  const hill = { getHeight: (x, z) => Math.hypot(x - cx, z - cz) < 100 ? 60 : 44, isWater: () => false };
  const geometry = buildGeographicGreenTile(data(), tile, project, hill);
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count > 8, 'interior vertices must be added');
  const heights = [...geometry.attributes.position.array].filter((_, index) => index % 3 === 1);
  assert.ok(Math.max(...heights) > 59, 'interior hill must be sampled');
  geometry.dispose();
});

test('keeps a park whose outer-ring average falls in a water hole', () => {
  const { latitude, longitude } = tileToWgs84(tile.x + 200 / 4096, tile.y + 200 / 4096, 13);
  const [cx, cz] = project(latitude, longitude);
  const hole = [[150, 150], [150, 250], [250, 250], [250, 150]];
  const withHole = tileData({ land_use: [{ properties: { class: 'park' }, rings: [square, hole] }] });
  const wetHole = { getHeight: () => 44, isWater: (x, z) => Math.hypot(x - cx, z - cz) < 20 };
  const geometry = buildGeographicGreenTile(withHole, tile, project, wetHole);
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count >= 8);
  geometry.dispose();
});

test('keeps most of a flat park when a narrow exclusion crosses a large face centroid', () => {
  const park = tileData({ land_use: [{ properties: { class: 'park' }, points: square }] });
  const baseline = buildGeographicGreenTile(park, tile, project, terrain);
  const xs = baseline.attributes.position;
  const first = Array.from(baseline.index.array.slice(0, 3), index => xs.getX(index));
  const center = first.reduce((sum, x) => sum + x, 0) / 3;
  const excluded = x => Math.abs(x - center) < 5;
  const actual = buildGeographicGreenTile(park, tile, project, terrain, excluded);
  assert.ok(actual);
  const area = (geometry, verify) => {
    const { position } = geometry.attributes;
    const ids = geometry.index.array;
    let total = 0;
    for (let i = 0; i < ids.length; i += 3) {
      const [a, b, c] = ids.slice(i, i + 3);
      const [ax, bx, cx] = [a, b, c].map(id => position.getX(id));
      const [az, bz, cz] = [a, b, c].map(id => position.getZ(id));
      if (verify) assert.ok(!excluded((ax + bx + cx) / 3));
      total += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    return total;
  };
  const ratio = area(actual, true) / area(baseline, false);
  assert.ok(ratio > 0.8 && ratio < 1, `retained area ratio: ${ratio}`);
  baseline.dispose();
  actual.dispose();
});
