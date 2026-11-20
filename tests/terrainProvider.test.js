import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { OpenWorldTerrain, buildOpenTerrainTile } from '../src/environment/OpenWorldTerrain.js';
import { JejuFlightSurface } from '../src/geospatial/JejuFlightSurface.js';
import { tileToWgs84 } from '../src/geospatial/TileCoordinateSystem.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { installPhysicsIntegrator } from '../src/core/PhysicsIntegrator.js';
import {
  analyticTerrainProvider, assertTerrainProviderContract, createGroundHeightQuery, createGroundSurfaceQueries,
  openWorldTerrainProvider, resolveGroundHeight,
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

test('ground height query matches terrain?.getHeight?.() ?? 0 without an override', () => {
  const terrain = { getHeight: (x, z) => x + z };
  let current = terrain;
  const query = createGroundHeightQuery({ getTerrain: () => current });
  assert.equal(query(3, 4), 7);
  current = {};
  assert.equal(query(3, 4), 0);
  current = null;
  assert.equal(query(3, 4), 0);
  current = { getHeight: () => undefined };
  assert.equal(query(1, 1), 0);
});

test('ground height query prefers a ready override and follows terrain swaps', () => {
  let terrain = { getHeight: () => 10 };
  let override = null;
  const query = createGroundHeightQuery({ getTerrain: () => terrain, getOverride: () => override });
  assert.equal(query(0, 0), 10);
  override = { isReady: x => x < 100, getHeight: () => 55 };
  assert.equal(query(0, 0), 55);
  assert.equal(query(200, 0), 10); // override not ready there
  override = { isReady: () => true, getHeight: () => null };
  assert.equal(query(0, 0), 10); // unknown height never reaches physics
  terrain = { getHeight: () => 20 };
  override = null;
  assert.equal(query(0, 0), 20);
});

test('createGroundSurfaceQueries pairs height and normal from the active surface', () => {
  const flatNormal = new Vector3(0, 1, 0);
  const slopedTerrainNormal = new Vector3(0.2, 0.98, 0).normalize();
  let terrain = { getHeight: () => 12, getNormal: () => slopedTerrainNormal };
  let override = null;
  const { getGroundHeight, getGroundNormal } = createGroundSurfaceQueries({
    getTerrain: () => terrain,
    getOverride: () => override,
  });

  // No override -> uses currentTerrain height and Vector3 normal (and null when omitted).
  assert.equal(getGroundHeight(0, 0), 12);
  assert.equal(getGroundNormal(0, 0), slopedTerrainNormal);
  assert.equal(getGroundNormal(0, 0).isVector3, true);
  terrain = { getHeight: () => 8 };
  assert.equal(getGroundNormal(0, 0), null);

  // Ready override with plain { x, y, z } normal -> returns override height and a THREE.Vector3.
  terrain = { getHeight: () => 12, getNormal: () => slopedTerrainNormal };
  const plainNormal = { x: -0.1176 / Math.hypot(-0.1176, 1, 0), y: 1 / Math.hypot(-0.1176, 1, 0), z: 0 };
  override = {
    isReady: x => x < 100,
    getHeight: x => (x < 100 ? 42 : null),
    getNormal: () => plainNormal,
  };
  assert.equal(getGroundHeight(0, 0), 42);
  const n = getGroundNormal(0, 0);
  assert.equal(n.isVector3, true);
  assert.ok(Math.abs(n.x - plainNormal.x) < 1e-9);
  assert.ok(Math.abs(n.y - plainNormal.y) < 1e-9);
  assert.equal(n.z, 0);

  // Unready override -> both height and normal fall back to currentTerrain.
  assert.equal(getGroundHeight(200, 0), 12);
  assert.equal(getGroundNormal(200, 0), slopedTerrainNormal);

  // Misbehaving override (isReady === true, getHeight === null) -> both fall back to currentTerrain.
  override = { isReady: () => true, getHeight: () => null, getNormal: () => plainNormal };
  assert.equal(getGroundHeight(0, 0), 12);
  assert.equal(getGroundNormal(0, 0), slopedTerrainNormal);

  // Ready override with finite height and null/omitted normal -> does NOT leak currentTerrain's slope.
  override = { isReady: () => true, getHeight: () => 50, getNormal: () => null };
  assert.equal(getGroundHeight(0, 0), 50);
  assert.equal(getGroundNormal(0, 0), null);
  override = { isReady: () => true, getHeight: () => 51 };
  assert.equal(getGroundHeight(0, 0), 51);
  assert.equal(getGroundNormal(0, 0), null);
  assert.equal(flatNormal.isVector3, true);
});

test('LandingGear uses sloped override normal over flat currentTerrain without throwing on body contact', () => {
  const grade = 0.1176;
  const len = Math.hypot(-grade, 1, 0);
  const slopedPlainNormal = { x: -grade / len, y: 1 / len, z: 0 };
  const flatTerrain = { getHeight: () => 0, getNormal: () => new Vector3(0, 1, 0) };
  const slopedOverride = {
    isReady: () => true,
    getHeight: x => x * grade,
    getNormal: () => slopedPlainNormal,
  };
  const { getGroundHeight, getGroundNormal } = createGroundSurfaceQueries({
    getTerrain: () => flatTerrain,
    getOverride: () => slopedOverride,
  });

  const pose = y => {
    const mesh = new Object3D();
    mesh.position.set(0, y, 0);
    mesh.quaternion.setFromEuler(new Euler(Math.atan(grade), -Math.PI / 2, 0, 'YXZ'));
    mesh.updateMatrixWorld(true);
    return mesh;
  };

  for (const tangent of [false, true]) {
    const gear = new LandingGear();
    const velocity = new Vector3(65, tangent ? 65 * grade : 0, 0);
    const result = gear.update(1 / 120, pose(3.75), velocity, new Vector3(), getGroundHeight, getGroundNormal);
    assert.equal(result.onGround, true);
    if (tangent) assert.equal(result.failure, null, 'Following the overridden grade is safe');
    else assert.ok(result.failure && result.failure.sinkRate > 7.5, 'Level flight strikes the overridden uphill slope');
  }

  // Body contact probes query getGroundNormal directly and call .lengthSq() on the result.
  const bodyGear = new LandingGear();
  const bodyResult = bodyGear.update(
    1 / 120,
    pose(0.5),
    new Vector3(65, 0, 0),
    new Vector3(),
    getGroundHeight,
    getGroundNormal
  );
  assert.equal(bodyResult.onGround, true);
  assert.ok(bodyResult.bodyContacts.length > 0);
});

test('PhysicsIntegrator pairs getGroundHeight and getGroundNormal across integratePhysics and resolveBodyPenetration', () => {
  class Harness {}
  installPhysicsIntegrator(Harness);

  const flatTerrain = { getHeight: () => 0, getNormal: () => new Vector3(0, 1, 0) };
  const overrideNormal = { x: -0.2, y: 0.98, z: 0 };
  const slopedOverride = {
    isReady: () => true,
    getHeight: () => 55,
    getNormal: () => overrideNormal,
  };

  const penetrationCalls = [];
  const integrateCalls = [];
  const sim = new Harness();
  sim.currentTerrain = flatTerrain;
  sim.terrainProviderOverride = slopedOverride;
  sim.aircraft = { group: new Object3D(), useGltf: false };
  sim.position = new Vector3();
  sim.quaternion = new Quaternion();
  sim.linearVelocity = new Vector3();
  sim.angularVelocity = new Vector3();
  sim.gear = {};
  sim.isCrashed = true;
  sim._physicsCore = {
    resolveBodyPenetration(hFn, nFn) {
      penetrationCalls.push({ h: hFn(10, 20), n: nFn(10, 20) });
    },
    integrateSubstep(_dt, _inputs, environment) {
      integrateCalls.push({
        h: environment.getGroundHeight(10, 20),
        n: environment.getGroundNormal(10, 20),
      });
    },
  };

  // Calling resolveBodyPenetration() BEFORE integratePhysics() must still use paired override queries.
  sim.resolveBodyPenetration();
  assert.equal(penetrationCalls.length, 1);
  assert.equal(penetrationCalls[0].h, 55);
  assert.equal(penetrationCalls[0].n.isVector3, true);
  assert.ok(Math.abs(penetrationCalls[0].n.x - overrideNormal.x) < 1e-9);
  assert.ok(Math.abs(penetrationCalls[0].n.y - overrideNormal.y) < 1e-9);

  // Calling integratePhysics() passes paired override queries through environment.
  sim.integratePhysics(1 / 120);
  assert.equal(integrateCalls.length, 1);
  assert.equal(integrateCalls[0].h, 55);
  assert.equal(integrateCalls[0].n.isVector3, true);
  assert.ok(Math.abs(integrateCalls[0].n.x - overrideNormal.x) < 1e-9);
  assert.ok(Math.abs(integrateCalls[0].n.y - overrideNormal.y) < 1e-9);
});
