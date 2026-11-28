import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PbfWriter } from 'pbf';
import {
  BUILDING_DETAIL_TIERS,
  buildGeographicBuildingTiers,
  buildGeographicBuildingTile,
  classifyBuildingTier,
  geographicBuildingHeight,
  GeographicBuildings,
  maxBuildingTierForAgl,
} from '../src/environment/GeographicBuildings.js';

function buildingTile() {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'building');
    layer.writeVarintField(15, 2);
    layer.writeVarintField(5, 4096);
    layer.writeMessage(2, (_, feature) => {
      feature.writeVarintField(3, 3);
      // A clockwise square crosses the left boundary.
      feature.writePackedVarint(4, [9, 199, 200, 26, 800, 0, 0, 800, 799, 0, 15]);
    }, null);
  }, null);
  return writer.finish();
}

test('uses source heights, floors, and the shared default in order', () => {
  assert.equal(geographicBuildingHeight({ height: 36, num_floors: 7 }), 36);
  assert.ok(Math.abs(geographicBuildingHeight({ height: -1, num_floors: 7 }) - 22.4) < 1e-9);
  assert.equal(geographicBuildingHeight({ height: 0, num_floors: 0 }), 9);
});

test('clips building roofs to the tile and anchors meshes to the flight surface', () => {
  const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
  const tile = { x: 8192, y: 8192 };
  const terrain = { getHeight: () => 44 };
  const data = buildingTile();
  const geometry = buildGeographicBuildingTile(data, tile, project, terrain);
  assert.ok(geometry);
  geometry.computeBoundingBox();
  assert.equal(geometry.boundingBox.min.x, 0);
  assert.equal(geometry.boundingBox.min.y, 44);
  assert.equal(geometry.boundingBox.max.y, 53);
  assert.equal(geometry.attributes.normal.getY(0), 1);
  assert.equal(buildGeographicBuildingTile(data, tile, project, terrain, () => true), null);
  assert.equal(buildGeographicBuildingTile(data, tile, project, { ...terrain, isWater: () => true }), null);
  geometry.dispose();
});

test('facade UVs select atlas tiles and roofs use the roof tile', () => {
  const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
  const geometry = buildGeographicBuildingTile(
    buildingTile(), { x: 8192, y: 8192 }, project, { getHeight: () => 44 },
  );
  assert.ok(geometry);
  const { uv } = geometry.attributes;
  assert.equal(uv.count, geometry.attributes.position.count);
  // The fixture has two roof triangles, then four wall quads.
  for (let i = 0; i < 6; i++) {
    assert.ok(uv.getX(i) > 0.5 && uv.getY(i) > 0.5, `roof vertex ${i}`);
  }
  for (let i = 6; i < uv.count; i++) {
    assert.ok([0.25, 0.75].includes(uv.getX(i)), `facade u ${i}`);
    assert.ok([0.25, 0.75].includes(uv.getY(i)), `facade v ${i}`);
  }
  geometry.dispose();
});

test('streamed buildings share the facade atlas and dispose it', () => {
  const layer = new GeographicBuildings({
    archive: { getZxy: async () => null }, terrain: { getHeight: () => 0 }, project: () => [0, 0],
    origin: { latitude: 37.5, longitude: 127 },
  });
  assert.ok(layer.material.map?.isDataTexture);
  assert.equal(layer.material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(layer.material.emissiveMap, layer.atlas.emissiveMap);
  assert.equal(typeof layer.material.onBeforeCompile, 'function');
  const emissive = layer.atlas.emissiveMap.image.data;
  let brightest = 0;
  for (let i = 0; i < emissive.length; i += 4) {
    brightest = Math.max(brightest, emissive[i], emissive[i + 1], emissive[i + 2]);
  }
  assert.ok(brightest > 200, 'close-range window mask is too dim');
  layer.update({ x: 0, y: 100, z: 0 }, { x: 0, y: 100, z: 0 }, -1, 1 / 60);
  assert.ok(layer.material.color.r < 0.2, 'night albedo should fade out');
  layer.dispose();
});

test('disposal aborts pending tile fetches and ignores their late results', async () => {
  let complete;
  const archive = {
    getZxy: (_zoom, _x, _y, signal) => new Promise(resolve => {
      complete = () => {
        assert.equal(signal.aborted, true);
        resolve({ data: buildingTile() });
      };
    }),
  };
  const layer = new GeographicBuildings({ archive, terrain: {}, project: () => [0, 0] });
  const load = layer.load({ key: '8192/8192', x: 8192, y: 8192 });
  layer.dispose();
  complete();
  await load;
  assert.equal(layer.group.children.length, 0);
  assert.equal(layer.tiles.size, 0);
});

test('loaded footprints collide by aircraft position regardless of camera position', async () => {
  const { Vector3, Quaternion } = await import('three');
  const { CollisionDetector } = await import('../src/physics/CollisionDetector.js');
  const terrain = { getHeight: () => 44, getNormal: () => new Vector3(0, 1, 0) };
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain,
    archive: { getZxy: async (zoom, x, y) => zoom === 14 && x === 8192 && y === 8192 ? { data: buildingTile() } : undefined },
  });
  terrain.geographicBuildingLayer = layer;
  const position = new Vector3(85, 50, 140);
  const distantCamera = new Vector3(30000, 100, 30000);
  const probe = { pos: position, radius: 1 };
  layer.update(position, distantCamera);
  assert.equal(layer.checkCollision([probe]), null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.checkCollision([probe]).point.equals(position), true);
  assert.equal(layer.checkCollision([{ ...probe, pos: new Vector3(85, 54.1, 140) }]), null);

  const detector = new CollisionDetector(terrain, null);
  const result = detector.checkCollision(position, new Quaternion(), new Vector3(0, 0, -70), 0, 0, 0);
  assert.equal(result?.type, 'BUILDING');

  // The tile remains visible to the old camera but no longer participates in collision.
  layer.update(distantCamera, position);
  assert.equal(layer.group.children.length, 1);
  assert.equal(layer.checkCollision([probe]), null);
  layer.update(distantCamera);
  assert.equal(layer.group.children.length, 0);
  layer.dispose();
  assert.equal(terrain.geographicBuildingLayer, undefined);
});

test('protects runway safety areas from streamed footprints and probe collisions', async () => {
  const { Vector3 } = await import('three');
  const terrain = { getHeight: () => 44 };
  const protectedPoint = (x, z) => x > 84 && x < 86 && z > 139 && z < 141;
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain,
    isRunwaySafetyArea: protectedPoint,
    archive: { getZxy: async zoom => zoom === 14 ? { data: buildingTile() } : undefined },
  });
  layer.update(new Vector3(85, 50, 140));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layer.group.children.length, 1, 'building vertices and center are outside the protected point');
  assert.equal(layer.checkCollision([{ pos: new Vector3(85, 50, 140), radius: 1 }]), null);
  assert.ok(layer.checkCollision([{ pos: new Vector3(90, 50, 140), radius: 1 }]));
  layer.dispose();

  const overlapping = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain,
    isRunwaySafetyArea: (x, z) => x < 1 && z > 200,
    archive: { getZxy: async zoom => zoom === 14 ? { data: buildingTile() } : undefined },
  });
  overlapping.update(new Vector3(85, 50, 140));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlapping.group.children.length, 0, 'a footprint corner enters the safety area');
  overlapping.dispose();
});

test('shares overview tiles between daytime silhouettes and night lights', async () => {
  const { Vector3 } = await import('three');
  const zooms = [];
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain: { getHeight: () => 44 },
    archive: { getZxy: async zoom => {
      zooms.push(zoom);
      return { data: buildingTile() };
    } },
  });
  const cruise = new Vector3(85, 10000, 140);
  layer.update(cruise, cruise, 0.5);
  assert.equal(layer.material.emissiveIntensity, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(zooms, [12]);
  const points = layer.group.children.find(child => child.isPoints);
  const silhouettes = layer.group.children.find(child => child.isMesh);
  assert.equal(points.visible, false);
  assert.equal(silhouettes.visible, true);
  layer.update(cruise, cruise, -0.5);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(layer.material.emissiveIntensity > 0);
  assert.equal(points.visible, true);
  assert.equal(silhouettes.visible, false);
  assert.equal(layer.overviewTiles.get('2048/2048').points, points);
  assert.equal(layer.tiles.size, 0);
  assert.equal(layer.checkCollision([{ pos: cruise, radius: 10 }]), null);
  const above = cruise.clone().setY(16000);
  layer.update(above, above, 0.5);
  assert.equal(layer.group.children.length, 0);
  assert.equal(layer.overviewTiles.size, 0);
  layer.dispose();
});

test('keeps city lights during descent until matching details are ready and close', async () => {
  const { Vector3 } = await import('three');
  let finishDetail;
  const data = buildingTile();
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain: { getHeight: () => 44 },
    archive: { getZxy: (zoom, x, y) => {
      if (zoom === 12) return Promise.resolve(x === 2048 && y === 2048 ? { data } : undefined);
      if (x === 8192 && y === 8192) return new Promise(resolve => { finishDetail = resolve; });
      return Promise.resolve(undefined);
    } },
  });
  const cruise = new Vector3(85, 10000, 140);
  layer.update(cruise, cruise, -0.5);
  await new Promise(resolve => setImmediate(resolve));
  const points = layer.group.children.find(child => child.isPoints);
  const opacity = () => points.geometry.attributes.color.getW(0);
  assert.equal(opacity(), 1);

  const middle = new Vector3(85, 1800, 140);
  layer.update(middle, middle, -0.5);
  assert.equal(layer.lightMaterial.opacity, 0.9);
  assert.equal(opacity(), 1);
  finishDetail({ data });
  await new Promise(resolve => setImmediate(resolve));
  layer.update(middle, middle, -0.5, 0.25);
  assert.ok(opacity() > 0.5 && opacity() < 1, 'overlap after the fine tile arrives');

  const close = new Vector3(85, 200, 140);
  for (let i = 0; i < 120; i++) layer.update(close, close, -0.5);
  assert.equal(opacity(), 0);
  layer.retainTiles([]);
  layer.update(close, close, -0.5);
  assert.equal(opacity(), 1, 'coarse glow returns immediately when the detail goes away');
  layer.dispose();
});

test('keeps daytime silhouettes until nearby detail is ready, then fades them', async () => {
  const { Vector3 } = await import('three');
  let finishDetail;
  const data = buildingTile();
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project: (latitude, longitude) => [longitude * 100000, -latitude * 100000],
    terrain: { getHeight: () => 44 },
    archive: { getZxy: (zoom, x, y) => {
      if (zoom === 12) return Promise.resolve(x === 2048 && y === 2048 ? { data } : undefined);
      if (x === 8192 && y === 8192) return new Promise(resolve => { finishDetail = resolve; });
      return Promise.resolve(undefined);
    } },
  });
  const high = new Vector3(85, 5000, 140);
  layer.update(high);
  await new Promise(resolve => setImmediate(resolve));
  const proxy = layer.overviewTiles.get('2048/2048').silhouettes;
  const opacity = () => proxy.geometry.attributes.color.getW(0);
  const low = new Vector3(85, 200, 140);
  layer.update(low);
  assert.equal(opacity(), 1);
  finishDetail({ data });
  await new Promise(resolve => setImmediate(resolve));
  layer.update(low, low, 1, 0.25);
  assert.ok(opacity() > 0 && opacity() < 1);
  for (let i = 0; i < 120; i++) layer.update(low);
  assert.equal(opacity(), 0);
  layer.retainTiles([]);
  layer.update(low);
  assert.equal(opacity(), 1);
  layer.dispose();
});

test('building detail distances step down with quality and restore the full scene', () => {
  const buildings = new GeographicBuildings({
    origin: { latitude: 37.5, longitude: 127 },
    terrain: { getHeight: () => 0 },
  });
  const aircraft = new THREE.Vector3(0, 300, 0);
  const camera = new THREE.Vector3(20, 300, 0);
  const makeTile = offset => {
    const geometry = new THREE.BoxGeometry(20, 40, 20);
    geometry.translate(offset, 20, 0);
    geometry.computeBoundingBox();
    return { mesh: new THREE.Mesh(geometry, buildings.material) };
  };
  const tiles = buildings.tilesNear(aircraft);
  const center = makeTile(0), border = makeTile(150), middle = makeTile(500), far = makeTile(850);
  buildings.tiles.set(tiles[0].key, center);
  buildings.tiles.set(tiles[1].key, border);
  buildings.tiles.set(tiles[2].key, middle);
  buildings.tiles.set(tiles[3].key, far);
  buildings.retryAt = new Map(tiles.map(tile => [tile.key, Infinity]));
  buildings.overviewRetryAt = Infinity;
  buildings.update(aircraft, camera, 1, 1 / 60, 'ultraLow');
  assert.deepEqual([center, border, middle, far].map(tile => tile.mesh.visible), [true, true, false, false]);
  assert.equal(buildings.silhouetteMaterial.opacity, 0);
  assert.equal(buildings.tiles.size, 4);
  buildings.update(aircraft, camera, 1, 1 / 60, 'performance');
  assert.deepEqual([center, border, middle, far].map(tile => tile.mesh.visible), [true, true, true, false]);
  assert.equal(buildings.silhouetteMaterial.opacity, 1);
  buildings.update(aircraft, camera, 1, 1 / 60, 'balanced');
  assert.ok([center, border, middle, far].every(tile => tile.mesh.visible));
  assert.equal(buildings.silhouetteMaterial.opacity, 1);
  buildings.dispose();
});

function encodeZigZag(n) {
  return (n << 1) ^ (n >> 31);
}

function squareGeometryCommands(x, y, size) {
  return [
    9, encodeZigZag(x), encodeZigZag(y),
    (3 << 3) | 2,
    encodeZigZag(size), encodeZigZag(0),
    encodeZigZag(0), encodeZigZag(size),
    encodeZigZag(-size), encodeZigZag(0),
    15,
  ];
}

function tieredBuildingTile() {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'building');
    layer.writeVarintField(15, 2);
    layer.writeVarintField(5, 4096);
    layer.writeStringField(3, 'height');
    layer.writeMessage(4, (_, value) => value.writeDoubleField(3, 40), null);
    layer.writeMessage(4, (_, value) => value.writeDoubleField(3, 15), null);
    layer.writeMessage(4, (_, value) => value.writeDoubleField(3, 6), null);
    // Tier 0 (major): 40 m tall
    layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, 0]);
      feature.writeVarintField(3, 3);
      feature.writePackedVarint(4, squareGeometryCommands(100, 100, 40));
    }, null);
    // Tier 1 (medium): 15 m tall, ~15x15 m footprint (~225 m^2)
    layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, 1]);
      feature.writeVarintField(3, 3);
      feature.writePackedVarint(4, squareGeometryCommands(400, 100, 26));
    }, null);
    // Tier 2 (minor): 6 m tall, ~7x7 m footprint (~49 m^2)
    layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, 2]);
      feature.writeVarintField(3, 3);
      feature.writePackedVarint(4, squareGeometryCommands(700, 100, 12));
    }, null);
  }, null);
  return writer.finish();
}

test('classifies building tiers by height and footprint area and maps AGL bands', () => {
  assert.equal(BUILDING_DETAIL_TIERS.length, 3);
  assert.equal(classifyBuildingTier(25, 20), 0);
  assert.equal(classifyBuildingTier(8, 1200), 0);
  assert.equal(classifyBuildingTier(12, 50), 1);
  assert.equal(classifyBuildingTier(8, 250), 1);
  assert.equal(classifyBuildingTier(9, 80), 2);

  assert.equal(maxBuildingTierForAgl(3600), -1);
  assert.equal(maxBuildingTierForAgl(3048), 0); // 10,000 ft: major only
  assert.equal(maxBuildingTierForAgl(1200), 1); // medium + major
  assert.equal(maxBuildingTierForAgl(400), 2); // all 3 tiers
});

test('splits tile buildings into three tiers and respects minTier/maxTier bounds', () => {
  const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
  const tile = { x: 8192, y: 8192 };
  const terrain = { getHeight: () => 44 };
  const data = tieredBuildingTile();

  const all = buildGeographicBuildingTiers(data, tile, project, terrain);
  assert.deepEqual(all.counts, [1, 1, 1]);
  assert.ok(all.geometries.every(Boolean));
  all.geometries.forEach(geometry => geometry.dispose());

  const majorOnly = buildGeographicBuildingTiers(data, tile, project, terrain, () => false, null, [], {
    minTier: 0, maxTier: 0,
  });
  assert.deepEqual(majorOnly.counts, [1, 0, 0]);
  assert.ok(majorOnly.geometries[0]);
  assert.equal(majorOnly.geometries[1], null);
  assert.equal(majorOnly.geometries[2], null);
  majorOnly.geometries[0].dispose();
});

test('lazily upgrades building tiers on descent without refetching and hides minor tiers when climbing', async () => {
  const { Vector3 } = await import('three');
  let fetchCount = 0;
  const data = tieredBuildingTile();
  const project = (latitude, longitude) => [longitude * 100000, -latitude * 100000];
  const terrain = { getHeight: () => 44 };
  const layer = new GeographicBuildings({
    origin: { latitude: 0, longitude: 0 },
    project,
    terrain,
    archive: {
      getZxy: async (zoom, x, y) => {
        if (zoom !== 14 || x !== 8192 || y !== 8192) return undefined;
        fetchCount++;
        return { data };
      },
    },
  });

  // At 10,000 ft (~3,048 m AGL): only Tier 0 (major) is built and visible.
  const cruise = new Vector3(100, 3092, 100);
  layer.update(cruise, cruise, 1, 1 / 60);
  await new Promise(resolve => setImmediate(resolve));
  layer.update(cruise, cruise, 1, 1 / 60);
  assert.equal(fetchCount, 1);
  const entry = layer.tiles.get('8192/8192');
  assert.equal(entry.builtMaxTier, 0);
  assert.ok(entry.rawData);
  assert.ok(entry.tiers[0]?.visible);
  assert.equal(entry.tiers[1], null);
  assert.equal(entry.tiers[2], null);
  assert.equal(layer.tierMaterials[1].opacity, 0);
  assert.equal(layer.tierMaterials[2].opacity, 0);

  // Descend into Tier 1 fade band (~1,350 m AGL): lazily upgrades Tier 1 without refetching.
  const approach = new Vector3(100, 1394, 100);
  layer.update(approach, approach, 1, 1 / 60);
  assert.equal(fetchCount, 1);
  assert.equal(entry.builtMaxTier, 1);
  assert.ok(entry.rawData);
  assert.ok(entry.tiers[1]?.visible);
  assert.equal(entry.tiers[2], null);
  assert.ok(layer.tierMaterials[1].opacity > 0 && layer.tierMaterials[1].opacity < 1);
  assert.equal(layer.tierMaterials[2].opacity, 0);

  // Descend into Tier 2 fade band (~525 m AGL): lazily upgrades Tier 2, frees rawData, enables collision.
  const low = new Vector3(100, 569, 100);
  layer.update(low, low, 1, 1 / 60);
  assert.equal(fetchCount, 1);
  assert.equal(entry.builtMaxTier, 2);
  assert.equal(entry.rawData, null);
  assert.ok(entry.tiers[2]?.visible);
  assert.ok(layer.tierMaterials[2].opacity > 0 && layer.tierMaterials[2].opacity < 1);

  const minorBox = entry.tiers[2].geometry.boundingBox;
  const minorCenter = new Vector3(
    (minorBox.min.x + minorBox.max.x) / 2,
    47,
    (minorBox.min.z + minorBox.max.z) / 2,
  );
  assert.ok(layer.checkCollision([{ pos: minorCenter, radius: 1 }]), 'upgraded minor tier participates in collision');

  // Climb back to 2,500 m AGL: medium and minor meshes hide while major stays visible.
  const climb = new Vector3(100, 2544, 100);
  layer.update(climb, climb, 1, 1 / 60);
  assert.equal(entry.tiers[0].visible, true);
  assert.equal(entry.tiers[1].visible, false);
  assert.equal(entry.tiers[2].visible, false);
  layer.dispose();
});
