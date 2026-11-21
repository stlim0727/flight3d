import test from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { UnifiedWorld, BASE_OFFSETS, REGION_EXTENTS, WORLD_REGIONS } from '../src/world/UnifiedWorld.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { createWorldAirportFacade } from '../src/world/WorldAirportFacade.js';

function fakeRegion(height, runwayLocal = null) {
  const group = { position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, visible: false };
  return {
    group,
    extent: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
    terrain: { getHeight: () => height },
    airport: {
      isOnRunway: (x, z) => Boolean(runwayLocal && Math.abs(x - runwayLocal[0]) < 1 && Math.abs(z - runwayLocal[1]) < 1),
      isRunwaySafetyArea: (x, z) => Boolean(runwayLocal && Math.abs(x - runwayLocal[0]) < 60 && Math.abs(z - runwayLocal[1]) < 60),
    },
  };
}

function makeWorld(anchor = 'incheon') {
  const world = new UnifiedWorld(anchor);
  const incheon = fakeRegion(7, [0, 0]);
  const jeju = fakeRegion(36, [10, 10]);
  const lukla = fakeRegion(2836, [-10, -10]);
  world.register('incheon', incheon).register('jeju', jeju).register('lukla', lukla);
  return { world, incheon, jeju, lukla };
}

test('composite world dispatches ground height by position, not by selected airport', () => {
  const { world } = makeWorld();
  const [jx, jz] = BASE_OFFSETS.jeju;
  const [lx, lz] = BASE_OFFSETS.lukla;
  assert.equal(world.getHeight(0, 0), 7);
  assert.equal(world.getHeight(jx, jz), 36);
  assert.equal(world.getHeight(lx, lz), 2836);
  assert.equal(world.getHeight(1e6, 1e6), 7);
});

test('outside region extents the streamed DEM wins over the anchor surface', () => {
  const { world, incheon } = makeWorld();
  incheon.terrain.openWorld = { sample: () => ({ height: 1150 }) };
  assert.equal(world.getHeight(1e6, 1e6), 1150);
});

test('runway queries resolve in the region under the aircraft', () => {
  const { world } = makeWorld();
  const [jx, jz] = BASE_OFFSETS.jeju;
  assert.equal(world.isOnRunway(0, 0), true);
  assert.equal(world.isOnRunway(jx + 10, jz + 10), true);
  assert.equal(world.isRunwaySafetyArea(jx + 50, jz + 10), true);
  assert.equal(world.isOnRunway(jx, jz), false);
  assert.equal(world.isOnRunway(1e6, 1e6), false);
});

test('changing spawn anchor translates regions and rebases physical points', () => {
  const { world, incheon, jeju } = makeWorld();
  const [jx, jz] = BASE_OFFSETS.jeju;
  const runwayWorld = [jx + 10, jz + 10];
  assert.equal(world.getHeight(...runwayWorld), 36);

  // A new anchor is a new coordinate frame: the same physical runway is now
  // expressed in Jeju-local coordinates, not the old Incheon-frame position.
  assert.equal(world.setAnchor('jeju'), true);
  assert.equal(world.getHeight(10, 10), 36);
  assert.equal(world.isOnRunway(10, 10), true);
  assert.equal(incheon.group.position.x, -jx);
  assert.equal(incheon.group.position.z, -jz);
  assert.equal(jeju.group.position.x, 0);
  assert.equal(jeju.group.position.z, 0);
  assert.equal(incheon.group.visible && jeju.group.visible, true);
});

test('all registered regions stay mounted after anchor changes', () => {
  const { world, lukla } = makeWorld('jeju');
  assert.equal(world.regions.size, 3);
  const [jx, jz] = BASE_OFFSETS.jeju;
  const [lx, lz] = BASE_OFFSETS.lukla;
  assert.equal(lukla.group.position.x, lx - jx);
  assert.equal(lukla.group.position.z, lz - jz);
  assert.equal(world.setAnchor('lukla'), true);
  assert.equal(lukla.group.position.x, 0);
  assert.equal(lukla.group.position.z, 0);
  assert.equal(world.regions.size, 3);
});

test('readiness follows the spawn region DEM state', () => {
  const { world } = makeWorld();
  world.regions.get('lukla').terrain.isLoaded = false;
  world.regions.get('lukla').terrain.loadError = 'bad DEM';
  assert.equal(world.isLoaded, true);
  world.setAnchor('lukla');
  assert.equal(world.isLoaded, false);
  assert.equal(world.loadError, 'bad DEM');
  world.regions.get('lukla').terrain.isLoaded = true;
  assert.equal(world.isLoaded, true);
});

test('Jeju region covers the Chuja emergency strip', () => {
  const world = new UnifiedWorld('jeju');
  world.register('jeju', {
    terrain: { getHeight: () => 12 },
    airport: { isOnRunway: () => true },
    extent: REGION_EXTENTS.jeju,
  });
  assert.equal(world.regionAt(-18300, -50008)?.id, 'jeju');
  assert.equal(world.getHeight(-18300, -50008), 12);
  assert.equal(world.isOnRunway(-18300, -50008), true);
});

test('airport facade updates every region in its own local frame', () => {
  const world = new UnifiedWorld('incheon');
  const seen = [];
  const region = id => ({
    extent: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
    terrain: { getHeight: () => 0 },
    airport: {
      update: (dt, pos, time, options) => seen.push({
        id, x: pos.x, z: pos.z, cameraX: options.cameraPosition.x, quality: options.quality,
      }),
    },
  });
  world.register('incheon', region('incheon'));
  world.register('jeju', region('jeju'));
  const facade = createWorldAirportFacade(world, { controlTowerData: { x: 1 } });
  const pos = { x: BASE_OFFSETS.jeju[0] + 20, y: 100, z: BASE_OFFSETS.jeju[1] + 30 };
  const camera = { x: 777, y: 250, z: 888 };
  facade.update(0.016, pos, 42, { quality: 'high', cameraPosition: camera });

  assert.equal(seen.length, 2);
  const incheon = seen.find(s => s.id === 'incheon');
  const jeju = seen.find(s => s.id === 'jeju');
  assert.equal(incheon.x, pos.x);
  assert.equal(jeju.x, 20);
  assert.equal(jeju.z, 30);

  assert.equal(jeju.cameraX, camera.x - BASE_OFFSETS.jeju[0]);
  assert.equal(incheon.cameraX, camera.x);
  assert.equal(jeju.quality, 'high');
  assert.equal(facade.controlTowerData.x, 1);
});

test('surface contract forwards mesh, region and streaming layers to the anchor', () => {
  const world = new UnifiedWorld('incheon');
  const mesh = { add() {} };
  const region = { features: { features: [1] } };
  const terrain = { mesh, region, size: 12000, getHeight: () => 0 };
  world.register('incheon', { terrain, airport: {}, extent: REGION_EXTENTS.incheon });
  assert.equal(world.mesh, mesh);
  assert.equal(world.region, region);
  assert.equal(world.size, 12000);
  const geometry = { attributes: {} };
  const terrace = { attributes: {} };
  terrain.geometry = geometry;
  terrain.localTerraceGeometry = terrace;
  assert.equal(world.geometry, geometry);
  assert.equal(world.localTerraceGeometry, terrace);
  terrain.segments = 255;
  terrain.getNaturalHeight = () => 123;
  assert.equal(world.segments, 255);
  assert.equal(world.getNaturalHeight(0, 0), 123);
  const stream = { dispose() {} };
  world.openWorld = stream;
  assert.equal(terrain.openWorld, stream);
  world.setAnchor('jeju');
  assert.equal(world.region, undefined);
});

test('Incheon region covers Sihwa power plant and beach', () => {
  const world = new UnifiedWorld('incheon');
  world.register('incheon', {
    terrain: { getHeight: () => 12 }, airport: {}, extent: REGION_EXTENTS.incheon,
  });
  assert.equal(world.regionAt(13964, 14916)?.id, 'incheon');
  assert.equal(world.regionAt(10580, 17773)?.id, 'incheon');
});

test('facade exposes gaze targets and parked aircraft', () => {
  const world = new UnifiedWorld('incheon');
  const region = airport => ({ terrain: { getHeight: () => 0 }, airport, extent: REGION_EXTENTS.incheon });
  world.register('incheon', region({ getGazeTargets: () => [{ object: {}, kind: 'tower' }] }));
  world.register('jeju', region({ getGazeTargets: () => [{ object: {}, kind: 'terminal' }] }));
  const parked = { group: {} };
  const facade = createWorldAirportFacade(world, { parked });
  assert.equal(facade.getGazeTargets().length, 2);
  assert.equal(facade.parked, parked);
});

test('airport building collision checks every mounted region in world coordinates', () => {
  const detector = new CollisionDetector(null, null, null, null, null);
  const terminalData = { x: 10, z: 10, width: 10, depth: 10, y: 0, height: 20 };
  detector.airport = {
    airportRegions: [
      { airport: { terminalData }, offset: [0, 0] },
      { airport: { terminalData }, offset: [1000, 2000] },
    ],
  };
  const probes = [{ pos: new THREE.Vector3(1010, 5, 2010), radius: 1, desc: 'belly' }];
  const hit = detector.checkAirportBuildings(null, probes);
  assert.ok(hit);
  assert.equal(hit.point.x, 1010);
  assert.equal(hit.point.z, 2010);
});

test('Jeju offset uses the Incheon scenery projection origin', () => {
  assert.ok(Math.abs(BASE_OFFSETS.jeju[0] - 3530.6) < 5);
  assert.ok(Math.abs(BASE_OFFSETS.jeju[1] - 436430.79) < 5);
});

test('outside regions normals and water follow the streamed surface', () => {
  const { world, incheon } = makeWorld();
  incheon.terrain.openWorld = { sample: x => ({ height: 100 + x, water: true }) };
  const normal = world.getNormal(1e6, 1e6);
  assert.ok(normal.y < 1);
  assert.ok(normal.x < 0);
  assert.equal(world.getWaterLevel(1e6, 1e6), 100 + 1e6);
  incheon.terrain.openWorld.sample = () => ({ height: 5, water: false });
  assert.equal(world.getWaterLevel(1e6, 1e6), -10000);
});

test('facade excludes modeled buildings in translated regions', () => {
  const world = new UnifiedWorld('incheon');
  const airport = { hasModeledBuilding: (x, z) => x === 10 && z === 20 };
  world.register('incheon', { terrain: { getHeight: () => 0 }, airport, extent: REGION_EXTENTS.incheon });
  const facade = createWorldAirportFacade(world, {});
  const [jx, jz] = BASE_OFFSETS.jeju;
  assert.equal(facade.hasModeledBuilding(jx + 10, jz + 20), false);
  world.register('jeju', { terrain: { getHeight: () => 0 }, airport, extent: REGION_EXTENTS.jeju });
  assert.equal(facade.hasModeledBuilding(jx + 10, jz + 20), true);
});

test('every lobby airport has a distinct world slot', () => {
  assert.deepEqual([...WORLD_REGIONS].sort(), ['coastal', 'incheon', 'jeju', 'lukla', 'neon', 'valley']);
  const ids = [...WORLD_REGIONS];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [ax, az] = BASE_OFFSETS[ids[i]];
      const [bx, bz] = BASE_OFFSETS[ids[j]];
      assert.ok(Math.hypot(ax - bx, az - bz) > 50000, `${ids[i]}/${ids[j]} overlap`);
    }
  }
});

test('coastal and neon resolve at their world offsets', () => {
  const world = new UnifiedWorld('incheon');
  const region = (height) => ({
    terrain: { getHeight: () => height },
    airport: { isOnRunway: () => true },
    extent: REGION_EXTENTS.coastal,
  });
  world.register('coastal', region(12));
  world.register('neon', region(-14));
  assert.equal(world.getHeight(BASE_OFFSETS.coastal[0], BASE_OFFSETS.coastal[1]), 12);
  assert.equal(world.getHeight(BASE_OFFSETS.neon[0], BASE_OFFSETS.neon[1]), -14);
  assert.equal(world.isOnRunway(BASE_OFFSETS.neon[0], BASE_OFFSETS.neon[1]), true);
});

test('coastal local camera helper subtracts the region offset', () => {
  const world = new UnifiedWorld('incheon');
  const camera = world.coastalLocalCamera({ x: 1000, y: 500, z: -200 });
  assert.equal(camera.x, 1000 - BASE_OFFSETS.coastal[0]);
  assert.equal(camera.z, -200 - BASE_OFFSETS.coastal[1]);
});

test('facade forwards render-light limiting to registered airports', () => {
  const world = new UnifiedWorld('incheon');
  const seen = [];
  world.register('incheon', {
    terrain: { getHeight: () => 0 },
    airport: { updateRenderLights: (y, limit) => seen.push([y, limit]) },
    extent: REGION_EXTENTS.incheon,
  });
  const facade = createWorldAirportFacade(world, {});
  facade.updateRenderLights(700, true);
  assert.deepEqual(seen, [[700, true]]);
});

test('ship collision uses the world transform of a translated group', () => {
  const detector = new CollisionDetector(null, null, null, null, null);
  const group = new THREE.Group();
  group.position.set(1000, 0, 2000);
  const mesh = new THREE.Object3D();
  group.add(mesh);
  const scene = new THREE.Scene();
  scene.add(group);
  scene.updateMatrixWorld(true);
  detector.ships = { vessels: [{ mesh, length: 10, width: 4, height: 5 }], speedboats: [] };
  const probe = { pos: new THREE.Vector3(1000, 2, 2000), radius: 1, desc: 'belly' };
  assert.ok(detector.checkShips(probe.pos, [probe]));
});

test('persistent valley resolves at its world slot', () => {
  const world = new UnifiedWorld('incheon');
  const group = { position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, visible: false };
  const terrain = {
    getHeight: () => 2100,
    centerX: 0, centerZ: -12000, widthX: 18000, lengthZ: 34000,
  };
  world.register('valley', {
    terrain,
    group,
    mesh: null,
    extent: {
      minX: terrain.centerX - terrain.widthX / 2,
      maxX: terrain.centerX + terrain.widthX / 2,
      minZ: terrain.centerZ - terrain.lengthZ / 2,
      maxZ: terrain.centerZ + terrain.lengthZ / 2,
    },
  });
  const [vx, vz] = BASE_OFFSETS.valley;
  assert.equal(world.getHeight(vx, vz - 12000), 2100);
  assert.equal(group.visible, true);
});
