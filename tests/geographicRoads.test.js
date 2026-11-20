import assert from 'node:assert/strict';
import test from 'node:test';
import { PbfWriter } from 'pbf';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import { buildGeographicRoadTile, GeographicRoads, roadWidth } from '../src/environment/GeographicRoads.js';

function segmentTile(features) {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'segment');
    layer.writeVarintField(15, 2);
    layer.writeVarintField(5, 4096);
    const keys = [];
    const values = [];
    const keyIndex = key => {
      let index = keys.indexOf(key);
      if (index < 0) { keys.push(key); index = keys.length - 1; }
      return index;
    };
    const valueIndex = value => {
      const text = String(value);
      let index = values.indexOf(text);
      if (index < 0) { values.push(text); index = values.length - 1; }
      return index;
    };
    const zigzag = value => (value << 1) ^ (value >> 31);
    for (const feature of features) {
      const tags = Object.entries(feature.properties).flatMap(([key, value]) => [keyIndex(key), valueIndex(value)]);
      layer.writeMessage(2, (_, message) => {
        message.writeVarintField(3, 2);
        if (tags.length) message.writePackedVarint(2, tags);
        const points = feature.points;
        const commands = [9, zigzag(points[0][0]), zigzag(points[0][1])];
        let [px, py] = points[0];
        if (points.length > 1) {
          commands.push(2 | ((points.length - 1) << 3));
          for (const [x, y] of points.slice(1)) {
            commands.push(zigzag(x - px), zigzag(y - py));
            px = x;
            py = y;
          }
        }
        message.writePackedVarint(4, commands);
      }, null);
    }
    for (const key of keys) layer.writeStringField(3, key);
    for (const value of values) layer.writeMessage(4, (_, message) => message.writeStringField(1, value), null);
  }, null);
  return writer.finish();
}

const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
const terrain = { getHeight: () => 44, isWater: () => false };
const tile = { x: 8192, y: 8192 };

test('uses grade widths unless a usable width rule is present', () => {
  assert.equal(roadWidth({ class: 'primary' }), 22);
  assert.equal(roadWidth({ class: 'tertiary' }), 12);
  assert.equal(roadWidth({ class: 'unknown' }), 12);
  assert.equal(roadWidth({ class: 'primary', width_rules: '[{"value":18.5}]' }), 18.5);
  assert.equal(roadWidth({ class: 'primary', width_rules: '[{"value":-4}]' }), 22);
  assert.equal(roadWidth({ class: 'primary', width_rules: 'not json' }), 22);
});

test('drapes major roads on the surface and skips bridges, tunnels and minor classes', () => {
  const data = segmentTile([
    { properties: { class: 'primary' }, points: [[100, 100], [200, 100], [300, 120]] },
    { properties: { class: 'trunk', subtype: 'road' }, points: [[400, 100], [500, 100]] },
    { properties: { class: 'secondary', road_flags: '[{"values":["is_bridge"]}]' }, points: [[600, 100], [700, 100]] },
    { properties: { class: 'secondary', road_flags: '[{"values":["is_tunnel"]}]' }, points: [[600, 200], [700, 200]] },
    { properties: { class: 'secondary', level_rules: '[{"value":1}]' }, points: [[600, 300], [700, 300]] },
    { properties: { class: 'residential' }, points: [[600, 400], [700, 400]] },
  ]);
  const geometry = buildGeographicRoadTile(data, tile, project, terrain);
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y - 44.35) < 1e-3);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 44.35) < 1e-3);
  // Two runs: three vertices (six ribbon vertices) and two vertices (four).
  assert.equal(geometry.attributes.position.count, 10);
  const width = Math.hypot(
    geometry.attributes.position.getX(0) - geometry.attributes.position.getX(1),
    geometry.attributes.position.getZ(0) - geometry.attributes.position.getZ(1),
  );
  assert.ok(Math.abs(width - 22) < 1e-4, `primary default width, got ${width}`);
  const trunkWidth = Math.hypot(
    geometry.attributes.position.getX(6) - geometry.attributes.position.getX(7),
    geometry.attributes.position.getZ(6) - geometry.attributes.position.getZ(7),
  );
  assert.ok(Math.abs(trunkWidth - 30) < 1e-4, `trunk default width, got ${trunkWidth}`);
  geometry.dispose();

  const bridgeOnly = segmentTile([
    { properties: { class: 'primary', road_flags: '[{"values":["is_bridge"]}]' }, points: [[100, 100], [200, 100]] },
  ]);
  assert.equal(buildGeographicRoadTile(bridgeOnly, tile, project, terrain), null);
});

test('omits water, excluded and off-map sections without dropping the whole tile', () => {
  const data = segmentTile([
    { properties: { class: 'primary' }, points: [[100, 100], [200, 100], [300, 100], [400, 100]] },
  ]);
  const at = value => {
    const { latitude, longitude } = tileToWgs84(tile.x + value / 4096, tile.y + 0.5, 13);
    return project(latitude, longitude)[0];
  };
  const split = (at(200) + at(300)) / 2;
  const wet = { ...terrain, isWater: x => x > split };
  const wetGeometry = buildGeographicRoadTile(data, tile, project, wet);
  assert.ok(wetGeometry);
  assert.equal(wetGeometry.attributes.position.count, 4);
  assert.equal(buildGeographicRoadTile(data, tile, project, terrain, () => true), null);
  const bounded = { ...terrain, size: 10 };
  assert.equal(buildGeographicRoadTile(data, tile, project, bounded), null);
});

test('streams and disposes road tiles, ignoring late responses after abort', async () => {
  let resolveFetch;
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [200, 100]] }]);
  const archive = {
    getZxy: async () => new Promise(resolve => { resolveFetch = resolve; }),
  };
  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: () => true } };
  const roads = new GeographicRoads({ origin: { latitude: 37.46, longitude: 126.44 }, project, terrain: surface, archive });
  roads.update({ x: 0, y: 100, z: 0 });
  assert.ok(roads.pending);
  roads.dispose();
  resolveFetch({ data });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(roads.tiles.size, 0);
  assert.equal(roads.group.children.length, 0);
  assert.equal(roads.pending, null);

  const ready = { getZxy: async () => ({ data }) };
  const live = new GeographicRoads({ origin: { latitude: 37.46, longitude: 126.44 }, project, terrain: surface, archive: ready });
  for (let frame = 0; frame < 12; frame++) {
    live.update({ x: 0, y: 100, z: 0 });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(live.tiles.size, 9);
  assert.equal(live.group.children.length, 9);
  for (const mesh of live.tiles.values()) assert.equal(mesh.material, live.material);
  live.dispose();
});
