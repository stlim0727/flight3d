import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh } from 'three';
import { OpenWorldTerrain, buildOpenTerrainTile } from '../src/environment/OpenWorldTerrain.js';
import { JejuFlightSurface } from '../src/geospatial/JejuFlightSurface.js';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import {
  analyticTerrainProvider, assertTerrainProviderContract, openWorldTerrainProvider, resolveGroundHeight,
} from '../src/environment/TerrainProvider.js';

const origin = { latitude: 37.55, longitude: 126.98 };
const x = 1746, y = 793;
const flat = h => new Float32Array(256 ** 2).fill(h);

function loadedWorld(protectedAreas = []) {
  const world = new OpenWorldTerrain({ origin, protectedAreas });
  const { geometry } = buildOpenTerrainTile({
    x, y, raster: flat(40), east: flat(40), south: flat(40), southeast: flat(40),
    water: new Uint8ClampedArray(256 ** 2 * 4), project: world.project, protectedAreas,
  });
  world.tiles.set(`${x}/${y}`, { mesh: new Mesh(geometry), water: new Uint8ClampedArray(256 ** 2 * 4) });
  const { latitude, longitude } = tileToWgs84(x + 0.5, y + 0.5, 11);
  const [px, pz] = world.project(latitude, longitude);
  return { world, px, pz };
}

test('analytic provider satisfies the contract', () => {
  const provider = analyticTerrainProvider(new JejuFlightSurface());
  assert.equal(assertTerrainProviderContract(provider, [[0, 0], [5000, 8000], [3741, 16591]]), true);
  assert.equal(provider.isReady(0, 0), true);
  assert.ok(Math.abs(provider.getHeight(0, 0) - 36) < 1e-9);
});

test('analytic provider rejects objects without getHeight', () => {
  assert.throws(() => analyticTerrainProvider({}), TypeError);
});

test('open-world provider is not ready until its tile loads and satisfies the contract', () => {
  const empty = openWorldTerrainProvider(new OpenWorldTerrain({ origin }));
  assert.equal(empty.getHeight(0, 0), null);
  assert.equal(empty.isReady(0, 0), false);
  assertTerrainProviderContract(empty, [[0, 0]]);

  const { world, px, pz } = loadedWorld();
  const provider = openWorldTerrainProvider(world);
  assert.equal(provider.isReady(px, pz), true);
  assert.ok(Math.abs(provider.getHeight(px, pz) - 40) < 0.5);
  assertTerrainProviderContract(provider, [[px, pz]]);
  provider.dispose();
});

test('protected areas are never authoritative for the open-world provider', () => {
  const { world, px, pz } = loadedWorld([[-1e6, -1e6, 1e6, 1e6]]);
  const provider = openWorldTerrainProvider(world);
  assert.equal(provider.isReady(px, pz), false);
  assert.equal(provider.getHeight(px, pz), null);
  provider.dispose();
});

test('providers are interchangeable behind resolveGroundHeight', () => {
  const { world, px, pz } = loadedWorld();
  const streamed = openWorldTerrainProvider(world);
  const analytic = analyticTerrainProvider(new JejuFlightSurface());
  let active = streamed;
  const ground = resolveGroundHeight(() => active, () => -45);
  assert.ok(Math.abs(ground(px, pz) - 40) < 0.5);
  assert.equal(ground(5e5, 5e5), -45); // unloaded area falls back
  active = analytic; // swap at runtime
  assert.ok(Math.abs(ground(0, 0) - 36) < 1e-9);
  active = null;
  assert.equal(ground(px, pz), -45);
  streamed.dispose();
});

test('contract check flags a provider whose isReady promises an unknown height', () => {
  const bad = { kind: 'x', getHeight: () => null, getNormal: () => null, isReady: () => true, update() {}, dispose() {} };
  assert.throws(() => assertTerrainProviderContract(bad), /isReady/);
});
