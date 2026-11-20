import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, Raycaster, Vector3 } from 'three';
import { buildOpenTerrainTile, decodeTerrarium, OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';

const origin = { latitude: 37.55, longitude: 126.98 };
const x = 1746, y = 793;
const flat = height => new Float32Array(256 ** 2).fill(height);

test('decodes signed Terrarium heights with sub-meter precision', () => {
  assert.deepEqual([...decodeTerrarium(Uint8Array.from([128, 13, 128, 255, 127, 246, 0, 255]))], [13.5, -10]);
});

test('samples the rendered triangles and honors mapped water and the airport exclusion', () => {
  const protectedAreas = [[-30, -30, 30, 30]];
  const world = new OpenWorldTerrain({ origin, protectedAreas });
  const raster = Float32Array.from({ length: 256 ** 2 }, (_, i) => 40 + (i % 256) / 2 + Math.floor(i / 256) / 4);
  const water = new Uint8ClampedArray(256 ** 2 * 4);
  const u = 0.54, v = 0.41;
  water[(Math.floor(v * 256) * 256 + Math.floor(u * 256)) * 4 + 3] = 255;
  const { geometry } = buildOpenTerrainTile({
    x, y, raster, east: flat(35), south: flat(35), southeast: flat(35),
    water, project: world.project, protectedAreas,
  });
  const mesh = new Mesh(geometry);
  world.tiles.set(`${x}/${y}`, { mesh, water });
  const { latitude, longitude } = tileToWgs84(x + u, y + v, 11);
  const [px, pz] = world.project(latitude, longitude);
  const hit = new Raycaster(new Vector3(px, 1000, pz), new Vector3(0, -1, 0)).intersectObject(mesh)[0];
  assert.ok(hit);
  const result = world.sample(px, pz);
  assert.equal(result.water, true);
  assert.ok(Math.abs(result.height - hit.point.y) < 0.01);
  assert.equal(world.sample(0, 0), undefined);
  assert.equal(world.readyAt(0, 0), true);
  assert.equal(new Raycaster(new Vector3(0, 1000, 0), new Vector3(0, -1, 0)).intersectObject(mesh).length, 0);
  world.dispose();
});

test('neighbor tiles share the same edge heights', () => {
  const world = new OpenWorldTerrain({ origin });
  const raster = flat(30), east = flat(80), south = flat(25), southeast = flat(90);
  const left = buildOpenTerrainTile({ x, y, raster, east, south, southeast, project: world.project }).geometry;
  const right = buildOpenTerrainTile({
    x: x + 1, y, raster: east, east: flat(70), south: southeast, southeast: flat(50), project: world.project,
  }).geometry;
  for (let row = 0; row < 129; row++) {
    const a = new Vector3().fromBufferAttribute(left.attributes.position, row * 129 + 128);
    const b = new Vector3().fromBufferAttribute(right.attributes.position, row * 129);
    assert.deepEqual(a.toArray(), b.toArray());
  }
  left.dispose();
  right.dispose();
  world.dispose();
});

test('keeps detailed imagery local and falls back to the base map when climbing', () => {
  const world = new OpenWorldTerrain({ origin });
  const mesh = new Mesh();
  const baseMap = { dispose() {} };
  let released = false;
  const detailMap = { dispose() { released = true; } };
  const key = `${x}/${y}`;
  world.tiles.set(key, { mesh, baseMap, detailMap, detailLevel: 13 });
  world.updateImageryDetail({ x, y }, 600);
  assert.equal(world.detailWanted.get(key), 13);
  assert.equal(world.detailWanted.get(`${x + 1}/${y}`), 12);
  assert.equal(released, false);
  world.updateImageryDetail({ x, y }, 4000);
  assert.equal(world.detailWanted.size, 0);
  assert.equal(released, true);
  assert.equal(mesh.material.map, baseMap);
  world.dispose();
});

test('building tiles crossing the Incheon scenery edge wait for their DEM parent', () => {
  const world = new OpenWorldTerrain({
    origin: { latitude: 37.448, longitude: 126.455 },
    protectedAreas: [[-25000, -25000, 25000, 25000]],
  });
  const crossing = { x: 13959, y: 6351 };
  const center = tileToWgs84(crossing.x + 0.5, crossing.y + 0.5, 14);
  assert.equal(world.readyAt(...world.project(center.latitude, center.longitude)), true);
  assert.equal(world.readyForTile(crossing, 14), false);
  assert.equal(world.readyForTile({ x: crossing.x - 2, y: crossing.y }, 14), true);
  world.tiles.set('1744/793', { mesh: new Mesh() });
  assert.equal(world.readyForTile(crossing, 14), true);
  world.dispose();
});

test('refreshes failed imagery and water without rebuilding the terrain tile', async () => {
  let imageAttempts = 0, waterAttempts = 0;
  const image = { width: 256, height: 256 };
  const imageryCache = { getTileImage: async () => ++imageAttempts === 1 ? null : image, dispose() {} };
  const world = new OpenWorldTerrain({ origin, imageryCache });
  const mesh = new Mesh();
  mesh.geometry.setIndex([0, 1, 2]);
  const key = `${x}/${y}`;
  const entry = { mesh, waterRetryAt: 0, baseMap: null };
  const mask = new Uint8Array(256 * 256 * 4);
  world.fetchWater = async () => ++waterAttempts === 1 ? undefined : mask;
  world.tiles.set(key, entry);
  world.wanted = [{ x, y, key }];

  world.updateTileResources();
  await Promise.all([world.pendingImagery, world.pendingWater]);
  assert.equal(entry.baseMap, null);
  assert.equal(entry.water, undefined);
  world.updateTileResources();
  assert.equal(imageAttempts, 1);
  assert.equal(waterAttempts, 1);

  entry.imageryRetryAt = entry.waterRetryAt = 0;
  world.updateTileResources();
  await Promise.all([world.pendingImagery, world.pendingWater]);
  assert.equal(world.tiles.get(key).mesh, mesh);
  assert.equal(mesh.material.map.image, image);
  assert.equal(entry.water, mask);
  assert.equal(imageAttempts, 2);
  assert.equal(waterAttempts, 2);
  world.dispose();
});

test('repairs isolated coastal DEM extremes while preserving steep connected terrain', async () => {
  const raster = flat(20);
  // The decimated 3×3 neighborhood of a real coastal DEM spike near Jeju.
  const patch = [[16, 34, 118], [177, -1076, 787], [0, 0, 0]];
  for (let row = 0; row < patch.length; row++) {
    for (let col = 0; col < patch[row].length; col++) {
      raster[(242 + row * 2) * 256 + 34 + col * 2] = patch[row][col];
    }
  }
  for (let row = 20; row <= 30; row++) {
    for (let col = 20; col <= 30; col++) raster[row * 256 + col] = 900;
  }
  // A steep plane crosses the northwest corner. The in-tile neighbors
  // alone would all vote to flatten its valid 2000 m corner.
  for (let row = 0; row <= 8; row++) {
    for (let col = 0; col <= 8; col++) raster[row * 256 + col] = 2000 - 100 * (row + col);
  }
  const rgba = new Uint8ClampedArray(256 ** 2 * 4);
  for (const [index, height] of raster.entries()) {
    const encoded = height + 32768;
    rgba.set([encoded >> 8, encoded & 255, 0, 255], index * 4);
  }
  const world = new OpenWorldTerrain({ origin, elevationCache: {
    getTileImage: async () => ({ width: 256, height: 256 }),
    dispose() {},
  } });
  globalThis.document = { createElement: () => ({ getContext: () => ({
    drawImage() {},
    getImageData: () => ({ data: rgba }),
  }) }) };
  try {
    const repaired = await world.raster(x, y);
    assert.equal(repaired[244 * 256 + 36], 25);
    assert.equal(repaired[244 * 256 + 38], 20);
    assert.equal(repaired[20 * 256 + 20], 900);
    assert.equal(repaired[0], 2000);
    assert.equal(repaired[2 * 256 + 2], 1600);
  } finally {
    delete globalThis.document;
    world.dispose();
  }
});
