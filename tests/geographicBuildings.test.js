import assert from 'node:assert/strict';
import test from 'node:test';
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
    archive: { getZxy: async (_zoom, x, y) => x === 8192 && y === 8192 ? { data: buildingTile() } : undefined },
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
    archive: { getZxy: async () => ({ data: buildingTile() }) },
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
    archive: { getZxy: async () => ({ data: buildingTile() }) },
  });
  overlapping.update(new Vector3(85, 50, 140));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlapping.group.children.length, 0, 'a footprint corner enters the safety area');
  overlapping.dispose();
});

test('fades facade windows and streams coarse lights only around a high night camera', async () => {
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
  assert.deepEqual(zooms, []);
  layer.update(cruise, cruise, -0.5);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(layer.material.emissiveIntensity > 0);
  assert.deepEqual(zooms, [12]);
  assert.equal(layer.group.children[0]?.isPoints, true);
  assert.equal(layer.tiles.size, 0);
  assert.equal(layer.checkCollision([{ pos: cruise, radius: 10 }]), null);
  layer.update(cruise, cruise, 0.5);
  assert.equal(layer.group.children.length, 0);
  assert.equal(layer.lightTiles.size, 0);
  layer.dispose();
});
