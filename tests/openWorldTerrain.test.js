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
