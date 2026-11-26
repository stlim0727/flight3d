import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PbfWriter } from 'pbf';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import { bridgeSpan, buildGeographicRoadTile, GeographicRoads, roadLamps, roadWidth } from '../src/environment/GeographicRoads.js';

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

test('drapes major surface roads and skips tunnels, mixed spans and minor classes', () => {
  const data = segmentTile([
    { properties: { class: 'primary' }, points: [[100, 100], [200, 100], [300, 120]] },
    { properties: { class: 'trunk', subtype: 'road' }, points: [[400, 100], [500, 100]] },
    { properties: { class: 'secondary', road_flags: '[{"values":["is_tunnel"]}]' }, points: [[600, 100], [700, 100]] },
    { properties: { class: 'secondary', road_flags: '[{"between":[0.2,0.8],"values":["is_bridge"]}]' }, points: [[600, 200], [700, 200]] },
    { properties: { class: 'residential' }, points: [[600, 400], [700, 400]] },
  ]);
  const geometry = buildGeographicRoadTile(data, tile, project, terrain);
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y - 44.35) < 1e-3);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 44.35) < 1e-3);
  assert.ok(geometry.attributes.position.count >= 10);
  const width = Math.hypot(
    geometry.attributes.position.getX(0) - geometry.attributes.position.getX(1),
    geometry.attributes.position.getZ(0) - geometry.attributes.position.getZ(1),
  );
  assert.ok(Math.abs(width - 22) < 1e-4, `primary default width, got ${width}`);
  assert.ok(geometry.attributes.normal.getY(0) > 0.9, 'flat road triangles must face upward');
  geometry.dispose();
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
  const full = buildGeographicRoadTile(data, tile, project, terrain);
  assert.ok(buildGeographicRoadTile(data, tile, project, wet).attributes.position.count < full.attributes.position.count);
  full.dispose();
  assert.equal(buildGeographicRoadTile(data, tile, project, terrain, () => true), null);
  const bounded = { ...terrain, size: 10 };
  assert.equal(buildGeographicRoadTile(data, tile, project, bounded), null);
});

test('samples terrain height at each ribbon edge', () => {
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [600, 100]] }]);
  const sloped = { getHeight: (x, z) => 44 + z * 0.01, isWater: () => false };
  const geometry = buildGeographicRoadTile(data, tile, project, sloped);
  assert.ok(geometry);
  const left = geometry.attributes.position.getY(0);
  const right = geometry.attributes.position.getY(1);
  assert.ok(Math.abs(left - right) > 0.1, `edges should differ on a slope, got ${left} vs ${right}`);
  geometry.dispose();
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
  assert.equal(live.group.children.filter(child => child.isMesh && !child.isInstancedMesh).length, 9);
  for (const mesh of live.tiles.values()) assert.equal(mesh.material, live.material);
  live.dispose();
});

test('places paired lamps at class spacing with class-width offset', () => {
  const points = [{ x: 0, z: 0 }, { x: 120, z: 0 }, { x: 240, z: 0 }];
  const lamps = roadLamps(points, 16, () => 10, 30);
  assert.equal(lamps.length, 16);
  assert.ok(lamps.every(lamp => lamp.y === 10));
  assert.ok(Math.abs(Math.abs(lamps[0].z - lamps[1].z) - 18.4) < 1e-6);
  assert.deepEqual(roadLamps(points, 16, () => 10, undefined), []);
});

test('gates lamps by night and altitude, deduplicates positions and caps near instances', async () => {
  const localProject = (latitude, longitude) => [(longitude - 126.44) * 100000, -(latitude - 37.46) * 100000];
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [600, 100]] }]);
  const archive = { getZxy: async () => ({ data }) };
  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: () => true } };
  const position = { x: 0, y: 100, z: 0 };
  const roads = new GeographicRoads({ origin: { latitude: 37.46, longitude: 126.44 }, project: localProject, terrain: surface, archive });
  roads.update(position, position, 0.5);
  assert.equal(roads.lampPoints.visible, false);
  assert.equal(roads.lampMesh.visible, false);
  for (let frame = 0; frame < 12; frame++) {
    roads.update(position, position, -0.2);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.ok(roads.lamps.size > 0);
  assert.ok(roads.nearLamps.length > 0);
  assert.ok(roads.lampPointsMaterial.opacity > 0.5);
  assert.equal(roads.lampMesh.count, roads.nearLamps.length);
  const before = roads.nearLamps.length;
  const [firstKey] = roads.lamps.keys();
  roads.lamps.set(`duplicate/${firstKey}`, roads.lamps.get(firstKey));
  roads.lightsDirty = true;
  roads.update(position, position, -0.2);
  assert.equal(roads.nearLamps.length, before);

  const mid = { ...position, y: 2300 };
  roads.update(mid, mid, -0.2);
  assert.equal(roads.lampPoints.visible, true);
  assert.equal(roads.lampMesh.visible, false);
  const colors = roads.lampPoints.geometry.attributes.color;
  assert.ok(roads.farLamps.length > 0);
  assert.equal(colors.array[3], 1, 'near lamps stay visible as points when the instanced mesh is altitude-hidden');
  roads.nearLampSet = new Set();
  roads.update(position, position, -0.2);
  const nearIndex = roads.farLamps.findIndex(lamp => Math.hypot(position.x - lamp.x, position.z - lamp.z) < 1600);
  assert.ok(nearIndex >= 0);
  assert.equal(colors.array[nearIndex * 4 + 3], 1, 'lamps excluded by the instance cap remain visible as points');
  const high = { ...position, y: 6000 };
  roads.update(high, high, -0.2);
  assert.equal(roads.lampPoints.visible, false);
  roads.dispose();
});

test('classifies only whole-segment bridges and honors evidenced height', () => {
  assert.equal(bridgeSpan({ road_flags: '[{"values":["is_bridge"]}]' }).deck, true);
  assert.equal(bridgeSpan({ road_flags: '[{"values":["is_bridge"]}]' }).evidenced, false);
  assert.equal(bridgeSpan({ road_flags: '[{"between":[0.2,0.8],"values":["is_bridge"]}]' }).skip, true);
  assert.equal(bridgeSpan({ road_flags: '[{"values":["is_tunnel"]}]' }).skip, true);
  assert.equal(bridgeSpan({ level_rules: '[{"value":-1}]' }).skip, true);
  const evidenced = bridgeSpan({ road_flags: '[{"values":["is_bridge"]}]', height: '52' });
  assert.equal(evidenced.evidenced, true);
  assert.equal(evidenced.height, 52);
  assert.equal(bridgeSpan({ road_flags: '[{"values":["is_link"]}]' }).skip, false);
  assert.equal(bridgeSpan({ level_rules: '[{"value":0}]' }).skip, false);
});

test('renders bridge decks above the surface and collides only where height is evidenced', async () => {
  const bridge = (height) => segmentTile([{
    properties: { class: 'primary', road_flags: '[{"values":["is_bridge"]}]', ...(height ? { height } : {}) },
    points: [[100, 100], [600, 100]],
  }]);
  const decks = [];
  const geometry = buildGeographicRoadTile(bridge(null), tile, project, terrain, () => false, null, null, decks);
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y - 52.35) < 1e-3);
  assert.equal(decks.length, 1);
  assert.equal(decks[0].evidenced, false);
  const lamps = [];
  buildGeographicRoadTile(bridge(null), tile, project, terrain, () => false, lamps, null, []);
  assert.equal(lamps.length, 0);
  geometry.dispose();

  const overWater = buildGeographicRoadTile(bridge(null), tile, project,
    { getHeight: () => 0, isWater: () => true }, () => false, null, null, []);
  assert.ok(overWater, 'whole-segment bridge must survive a water centerline');
  overWater.dispose();

  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: () => true } };
  const origin = { latitude: 37.46, longitude: 126.44 };
  const position = { x: 0, y: 100, z: 0 };
  const probe = point => [{ pos: new THREE.Vector3(point.x, point.y, point.z), radius: 2, desc: 'bridge deck' }];
  const unverified = new GeographicRoads({ origin, project, terrain: surface, archive: { getZxy: async () => ({ data: bridge(null) }) } });
  for (let i = 0; i < 12; i++) {
    unverified.update(position, position, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(unverified.checkBridgeCollision(probe({ x: 0, y: 100, z: 0 })), null);
  unverified.dispose();

  const verified = new GeographicRoads({ origin, project, terrain: surface, archive: { getZxy: async () => ({ data: bridge('44') }) } });
  for (let i = 0; i < 12; i++) {
    verified.update(position, position, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const deck = [...verified.bridges.values()].flat().find(candidate => candidate.evidenced);
  const hit = verified.checkBridgeCollision(probe({ x: deck.points[0].x, y: deck.height, z: deck.points[0].z }));
  assert.ok(hit);
  assert.equal(hit.part, 'bridge deck');
  verified.dispose();
});

test('retries a failed tile and reloads after cache eviction', async () => {
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [600, 100]] }]);
  let offline = true;
  const archive = {
    getZxy: async () => {
      if (offline) throw new Error('tile unavailable');
      return { data };
    },
  };
  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: () => true } };
  const origin = { latitude: 37.46, longitude: 126.44 };
  const position = { x: 0, y: 100, z: 0 };
  const roads = new GeographicRoads({ origin, project, terrain: surface, archive });
  roads.update(position);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(roads.retryAt.size > 0);
  assert.equal(roads.tiles.size, 0);
  offline = false;
  for (const key of roads.retryAt.keys()) roads.retryAt.set(key, 0);
  for (let i = 0; i < 12; i++) {
    roads.update(position);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(roads.tiles.size, 9);
  roads.update({ x: 300000, y: 100, z: 0 });
  assert.equal(roads.tiles.size, 0);
  for (let i = 0; i < 12; i++) {
    roads.update(position);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(roads.tiles.size, 9);
  roads.dispose();
});

test('densifies a surface road so an interior hill is not buried', () => {
  const { latitude, longitude } = tileToWgs84(tile.x + 350 / 4096, tile.y + 100 / 4096, 13);
  const [midX] = project(latitude, longitude);
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [600, 100]] }]);
  const hill = { getHeight: (x) => Math.abs(x - midX) < 60 ? 60 : 44, isWater: () => false };
  const geometry = buildGeographicRoadTile(data, tile, project, hill);
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count > 4, 'lengthwise samples must be inserted');
  const heights = [...geometry.attributes.position.array].filter((_, index) => index % 3 === 1);
  assert.ok(Math.max(...heights) > 59, 'interior hill must be sampled');
  geometry.dispose();
});

test('splits a long road around an interior water or runway strip', () => {
  const data = segmentTile([{ properties: { class: 'primary' }, points: [[100, 100], [300, 100]] }]);
  const { latitude, longitude } = tileToWgs84(tile.x + 200 / 4096, tile.y + 100 / 4096, 13);
  const [center] = project(latitude, longitude);
  const blocked = x => Math.abs(x - center) < 25;
  for (const [surface, exclude] of [[{ ...terrain, isWater: blocked }, undefined], [terrain, blocked]]) {
    const lamps = [];
    const geometry = buildGeographicRoadTile(data, tile, project, surface, exclude, lamps);
    assert.ok(geometry);
    const { position } = geometry.attributes;
    const indices = geometry.index.array;
    const sides = new Set();
    for (let i = 0; i < indices.length; i += 3) {
      const xs = Array.from(indices.slice(i, i + 3), index => position.getX(index));
      assert.ok(xs.every(x => !blocked(x)));
      assert.ok(xs.every(x => x < center) || xs.every(x => x > center));
      sides.add(Math.sign(xs[0] - center));
    }
    assert.equal(sides.size, 2);
    assert.ok(lamps.length > 0 && lamps.every(lamp => !blocked(lamp.x)));
    geometry.dispose();
  }
});

test('GeographicRoads updates quality defines and toggles lamp visibility', () => {
  const origin = { latitude: 37.46, longitude: 126.44 };
  const surface = { ...terrain, isLoaded: true, openWorld: { readyForTile: () => true } };
  const roads = new GeographicRoads({ origin, project, terrain: surface, quality: 'balanced' });
  assert.equal(roads.material.defines.QUALITY_ULTRALOW, 0);
  assert.equal(roads.material.defines.QUALITY_PERFORMANCE, 0);
  assert.equal(roads.material.defines.QUALITY_FAST, 0);
  assert.equal(roads.lampMesh.visible, true);
  assert.equal(roads.lampPoints.visible, true);

  roads.setQuality('performance');
  assert.equal(roads.material.defines.QUALITY_ULTRALOW, 0);
  assert.equal(roads.material.defines.QUALITY_PERFORMANCE, 1);
  assert.equal(roads.material.defines.QUALITY_FAST, 1);
  assert.equal(roads.lampMesh.visible, true);

  roads.setQuality('ultraLow');
  assert.equal(roads.material.defines.QUALITY_ULTRALOW, 1);
  assert.equal(roads.material.defines.QUALITY_PERFORMANCE, 0);
  assert.equal(roads.material.defines.QUALITY_FAST, 1);
  assert.equal(roads.lampMesh.visible, false);
  assert.equal(roads.lampPoints.visible, false);

  roads.dispose();
});
