import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Mesh, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { buildLocalImageryGeometry, buildOpenTerrainTile, buildReducedTerrainGeometry, decodeTerrarium, OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';
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
  assert.equal(buildReducedTerrainGeometry(geometry), null);
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

test('reduced terrain preserves tile seams and the full-resolution collision surface', () => {
  const world = new OpenWorldTerrain({ origin });
  const raster = Float32Array.from({ length: 256 ** 2 }, (_, index) => 30 + index % 11);
  const full = buildOpenTerrainTile({
    x, y, raster, east: flat(80), south: flat(25), southeast: flat(90), project: world.project,
  }).geometry;
  const tile = { mesh: new Mesh(full), fullGeometry: full };
  world.tiles.set(`${x}/${y}`, tile);
  const point = tileToWgs84(x + .3, y + .4, 11);
  const xy = world.project(point.latitude, point.longitude);
  const sample = world.sample(...xy);
  assert.ok(sample);
  world.reducedGeometry = true;
  world.updateRenderGeometry(tile, `${x}/${y}`);
  const reduced = tile.mesh.geometry;
  assert.ok(reduced.index.count < full.index.count / 8);
  assert.equal(reduced.attributes.position, full.attributes.position);
  const used = new Set(reduced.index.array);
  for (let i = 0; i < 129; i++) {
    assert.ok(used.has(i) && used.has(128 * 129 + i));
    assert.ok(used.has(i * 129) && used.has(i * 129 + 128));
  }
  assert.deepEqual(world.sample(...xy), sample);
  world.detailedKey = `${x}/${y}`;
  world.updateRenderGeometry(tile, `${x}/${y}`);
  assert.equal(tile.mesh.geometry, full);
  world.reducedGeometry = false;
  world.updateRenderGeometry(tile, `${x}/${y}`);
  assert.equal(tile.mesh.geometry, full);
  world.dispose();
});

test('prioritizes visible imagery at cruise altitude and fades back to the base map', () => {
  const world = new OpenWorldTerrain({ origin });
  const camera = new PerspectiveCamera(55, 16 / 9, 1, 100000);
  camera.position.y = 4000;
  camera.lookAt(0, 0, -10000);
  const baseMap = { dispose() {} };
  let released = false;
  const detailMap = { dispose() { released = true; } };
  const key = `${x}/${y}`;
  const front = new Mesh(new BoxGeometry(12000, 100, 12000));
  front.position.z = -10000;
  front.material.map = baseMap;
  const behind = new Mesh(new BoxGeometry(4000, 100, 4000));
  behind.position.z = 10000;
  const detail = { map: { value: detailMap }, blend: { value: 0 } };
  world.tiles.set(key, { mesh: front, baseMap, detailMap, detail, detailLevel: 13, detailUpdatedAt: 0 });
  world.tiles.set(`${x + 1}/${y}`, { mesh: behind });
  world.updateImageryDetail(camera, 1080, 350);
  assert.equal(world.detailWanted.get(key), 13);
  assert.equal(world.detailWanted.has(`${x + 1}/${y}`), false);
  assert.equal(detail.blend.value, 1);
  camera.lookAt(0, 4000, 10000);
  world.updateImageryDetail(camera, 1080, 550);
  assert.equal(world.detailWanted.has(key), true);
  assert.equal(detail.blend.value, 1);
  world.updateImageryDetail(camera, 1080, 1250);
  world.updateImageryDetail(camera, 1080, 1450);
  assert.equal(world.detailWanted.has(key), false);
  assert.ok(detail.blend.value > 0 && detail.blend.value < 1);
  assert.equal(released, false);
  world.updateImageryDetail(camera, 1080, 1800);
  assert.equal(released, true);
  assert.equal(front.material.map, baseMap);
  world.dispose();
});

test('holds the high-detail slot when straight flight changes tile ranking', () => {
  const world = new OpenWorldTerrain({ origin });
  const camera = new PerspectiveCamera(55, 2, 1, 100000);
  camera.position.set(0, 4000, 0);
  camera.lookAt(0, 4000, -10000);
  const first = new Mesh(new BoxGeometry(5000, 100, 5000));
  const next = new Mesh(new BoxGeometry(8000, 100, 8000));
  first.position.set(-3000, 0, -10000);
  next.position.set(3000, 0, -18000);
  world.tiles.set('first', { mesh: first });
  world.tiles.set('next', { mesh: next });
  world.updateImageryDetail(camera, 1080, 200);
  assert.equal(world.detailWanted.get('first'), 13);
  assert.equal(world.detailWanted.get('next'), 12);

  camera.position.z = -6000;
  world.updateImageryDetail(camera, 1080, 400);
  // Both tiles are still visible. Reduce the first tile's projected size by
  // continuing forward past it, while keeping the heading fixed.
  camera.position.z = -12000;
  world.updateImageryDetail(camera, 1080, 600);
  assert.ok(world.tiles.get('next').imageryPriority > world.tiles.get('first').imageryPriority);
  assert.equal(world.detailWanted.get('first'), 13);
  assert.equal(world.detailWanted.get('next'), 12);
  world.updateImageryDetail(camera, 1080, 1500);
  assert.equal(world.detailWanted.get('first'), undefined);
  assert.equal(world.detailWanted.get('next'), 13);
  world.dispose();
});

test('upgrades z12 to z13 directly, then restores the base for a later fade-out', async () => {
  const key = `${x}/${y}`;
  const world = new OpenWorldTerrain({ origin, imageryCache: {
    getTileImage: async () => ({ width: 256, height: 256 }),
    dispose() {},
  } });
  const mesh = new Mesh(new BoxGeometry(4000, 100, 4000));
  let disposed = false;
  const previous = { dispose() { disposed = true; } };
  const baseMap = { dispose() {} };
  const detail = { map: { value: previous }, blend: { value: 1 } };
  const entry = { mesh, baseMap, detailMap: previous, detailLevel: 12, detail };
  mesh.material.map = baseMap;
  world.tiles.set(key, entry);
  world.detailWanted.set(key, 13);
  globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
  try {
    await world.loadImageryDetail(key, entry, 13);
    assert.equal(mesh.material.map, previous);
    assert.equal(detail.blend.value, 0);
    assert.equal(disposed, false);
    const camera = new PerspectiveCamera();
    const start = 1000;
    entry.detailUpdatedAt = start;
    world.nextImagerySelection = Infinity;
    world.updateImageryDetail(camera, 1080, start + 175);
    assert.equal(detail.blend.value, 0.5);
    assert.equal(mesh.material.map, previous);
    world.updateImageryDetail(camera, 1080, start + 350);
    assert.equal(detail.blend.value, 1);
    assert.equal(mesh.material.map, baseMap);
    assert.equal(disposed, true);
  } finally {
    delete globalThis.document;
    world.dispose();
  }
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

test('local terrain triangles keep their surface and use continuous tile UVs', () => {
  const source = {
    vertices: [
      [0, 10, 0, 4.5, 3.25, 0, 1, 0],
      [0, 10, 2, 4.5, 3.75, 0, 1, 0],
      [2, 20, 0, 5.5, 3.25, 0, 1, 0],
    ],
    triangles: [0, 1, 2],
  };
  const west = buildLocalImageryGeometry([source], 4, 3);
  const east = buildLocalImageryGeometry([source], 5, 3);
  const edge = (geometry, u) => {
    const { position, uv } = geometry.attributes;
    return Array.from({ length: uv.count }, (_, i) => i)
      .filter(i => uv.getX(i) === u)
      .map(i => [position.getX(i), position.getY(i), position.getZ(i), uv.getY(i)])
      .sort((a, b) => a[2] - b[2]);
  };
  assert.deepEqual(edge(west, 1), [[1, 15, 0, 0.75], [1, 15, 1, 0.5]]);
  assert.deepEqual(edge(west, 1), edge(east, 0));
  assert.equal(buildLocalImageryGeometry([source], 6, 3), null);
  west.dispose();
  east.dispose();
});
