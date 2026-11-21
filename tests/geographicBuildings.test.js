import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PbfWriter } from 'pbf';
import { buildGeographicBuildingTile, geographicBuildingHeight, GeographicBuildings } from '../src/environment/GeographicBuildings.js';

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
