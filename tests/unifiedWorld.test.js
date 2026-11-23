import test from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { UnifiedWorld, BASE_OFFSETS, REGION_EXTENTS, WORLD_REGIONS } from '../src/world/UnifiedWorld.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { createWorldAirportFacade } from '../src/world/WorldAirportFacade.js';
import { AIRPORT_ORIGINS, RUNWAY_THRESHOLDS, worldPositionToWgs84 } from '../src/geospatial/airportGeodesy.js';
import { wgs84ToLocal } from '../src/geospatial/TileCoordinateSystem.js';
import { APPROACH_DATA } from '../src/config/approachData.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { haversineDistanceM, initialBearingDeg } from '../src/geospatial/CorridorCoordinateSystem.js';

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

test('unmounted regions keep altitude and runway surfaces across anchor changes', () => {
  const { world, jeju } = makeWorld();
  const [jx, jz] = BASE_OFFSETS.jeju;
  assert.equal(world.setMounted('jeju', false), true);
  assert.equal(jeju.group.visible, false);
  assert.equal(world.isMounted('jeju'), false);
  assert.equal(world.regions.has('jeju'), true);
  assert.equal(world.getHeight(jx + 10, jz + 10), 36);
  assert.equal(world.isOnRunway(jx + 10, jz + 10), true);
  world.setAnchor('jeju');
  assert.equal(jeju.group.visible, false);
  assert.equal(jeju.group.position.x, 0);
  assert.equal(world.getHeight(10, 10), 36);
});

test('region distance is measured to the world-frame box in the active anchor frame', () => {
  const world = new UnifiedWorld('incheon');
  world.register('coastal', { ...fakeRegion(0), extent: REGION_EXTENTS.coastal });
  assert.equal(world.distanceToRegion('coastal', BASE_OFFSETS.coastal[0], BASE_OFFSETS.coastal[1]), 0);
  assert.ok(world.distanceToRegion('coastal', 0, 0) > 60000);
  world.setAnchor('coastal');
  assert.equal(world.distanceToRegion('coastal', 0, 0), 0);
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

test('region name key follows position, not the spawn anchor', () => {
  const world = new UnifiedWorld('incheon');
  world.register('incheon', {
    terrain: { getHeight: () => 7 },
    airport: {},
    extent: REGION_EXTENTS.incheon,
  });
  world.register('neon', {
    terrain: { getHeight: () => -14 },
    airport: {},
    extent: REGION_EXTENTS.neon,
  });
  assert.equal(world.regionNameKey(0, 0), 'incheon.airport');
  assert.equal(world.regionNameKey(BASE_OFFSETS.neon[0], BASE_OFFSETS.neon[1]), 'neon.metropolis');
  assert.equal(world.regionCode(0, 0), 'ICN');
  assert.equal(world.regionCode(BASE_OFFSETS.neon[0], BASE_OFFSETS.neon[1]), 'NEO');
  assert.equal(world.regionCode(1e6, 1e6), null);
  assert.equal(world.regionNameKey(1e6, 1e6), null);
});

test('destination info uses great-circle bearings to real runway thresholds', () => {
  const world = new UnifiedWorld('incheon');
  const info = world.destinationInfo(0, 0, 'jeju');
  assert.equal(info.id, 'jeju');
  assert.equal(info.code, 'CJU');
  assert.ok(info.bearingDeg > 170 && info.bearingDeg < 190);
  assert.ok(info.distanceNm > 200);
  assert.equal(info.synthetic, false);
  assert.equal(info.target, 'threshold');
  const expected = [
    BASE_OFFSETS.jeju[0] + APPROACH_DATA.jeju.threshold.x,
    BASE_OFFSETS.jeju[1] + APPROACH_DATA.jeju.threshold.z,
  ];
  assert.ok(Math.hypot(info.dx - expected[0], info.dz - expected[1]) < 1e-6);
  const synthetic = world.destinationInfo(0, 0, 'neon');
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.target, 'centre');
  assert.equal(world.destinationInfo(0, 0, 'unknown'), null);
  const fromJeju = world.destinationInfo(BASE_OFFSETS.jeju[0], BASE_OFFSETS.jeju[1], 'incheon');
  assert.ok(fromJeju.bearingDeg < 10 || fromJeju.bearingDeg > 350);
});

test('real threshold guidance and ND marker follow the active anchor', () => {
  const anchors = ['incheon', 'jeju', 'lukla'];
  for (const anchor of anchors) {
    for (const target of anchors) {
      if (anchor === target) continue;
      const info = new UnifiedWorld(anchor).destinationInfo(0, 0, target);
      const origin = AIRPORT_ORIGINS[anchor];
      const threshold = RUNWAY_THRESHOLDS[target];
      assert.equal(info.synthetic, false, `${anchor} -> ${target}`);
      assert.equal(info.target, 'threshold', `${anchor} -> ${target}`);
      assert.ok(Math.abs(info.distanceM - haversineDistanceM(
        origin.latitude, origin.longitude, threshold.latitude, threshold.longitude,
      )) < 0.5, `${anchor} -> ${target} distance`);
      assert.ok(Math.abs(info.bearingDeg - initialBearingDeg(
        origin.latitude, origin.longitude, threshold.latitude, threshold.longitude,
      )) < 1e-6, `${anchor} -> ${target} bearing`);
      const marker = [
        BASE_OFFSETS[target][0] - BASE_OFFSETS[anchor][0] + APPROACH_DATA[target].threshold.x,
        BASE_OFFSETS[target][1] - BASE_OFFSETS[anchor][1] + APPROACH_DATA[target].threshold.z,
      ];
      assert.ok(Math.hypot(info.dx - marker[0], info.dz - marker[1]) < 1e-6,
        `${anchor} -> ${target} rendered threshold marker`);
      const reverse = new UnifiedWorld(target).destinationInfo(0, 0, anchor);
      assert.equal(reverse.synthetic, false, `${target} -> ${anchor}`);
      assert.ok(Math.abs(reverse.distanceM - haversineDistanceM(
        AIRPORT_ORIGINS[target].latitude, AIRPORT_ORIGINS[target].longitude,
        RUNWAY_THRESHOLDS[anchor].latitude, RUNWAY_THRESHOLDS[anchor].longitude,
      )) < 0.5, `${target} -> ${anchor} distance`);
    }
    const synthetic = new UnifiedWorld(anchor).destinationInfo(0, 0, 'neon');
    assert.equal(synthetic.synthetic, true, `${anchor} -> neon`);
    assert.equal(synthetic.target, 'centre', `${anchor} -> neon`);
  }
});

test('streamed external airport registers as a dynamic region and reports preparation', () => {
  const { world } = makeWorld();
  const region = fakeRegion(18, [0, 0]);
  region.terrain.centre = { x: 0, z: 0 };
  world.registerDynamic('RKSS', { ...region, baseOffset: [30000, -2000] });
  assert.deepEqual(world.offsets.get('RKSS'), [30000, -2000]);
  assert.equal(world.getHeight(30000, -2000), 18);
  assert.equal(world.regionAt(30000, -2000).id, 'RKSS');
  world.setDynamicStatus('RKSS', { state: 'loading', code: 'RKSS' });
  const info = world.destinationInfo(0, 0, 'RKSS');
  assert.equal(info.code, 'RKSS');
  assert.equal(info.synthetic, true);
  assert.equal(info.prepare, 'loading');
  assert.ok(info.distanceM > 29000 && info.distanceM < 31000);

  world.setAnchor('jeju');
  assert.deepEqual(world.offsets.get('RKSS'), [
    30000 - BASE_OFFSETS.jeju[0], -2000 - BASE_OFFSETS.jeju[1],
  ]);
  assert.equal(world.unregister('RKSS'), true);
  assert.equal(world.regions.has('RKSS'), false);
  assert.equal(world.offsets.has('RKSS'), false);
  assert.equal(world.getHeight(30000, -2000), 36);
  assert.equal(world.unregister('RKSS'), false);
});

test('unmount keeps destination guidance and unknown codes never point at the origin', () => {
  const { world } = makeWorld();
  const region = fakeRegion(18, [0, 0]);
  world.registerDynamic('RKSS', { ...region, baseOffset: [30000, -2000] });
  world.unregister('RKSS');
  assert.equal(world.dynamicOffsets.has('RKSS'), false);
  assert.equal(world.destinationOffsets.has('RKSS'), true);
  const remembered = world.destinationInfo(0, 0, 'RKSS');
  assert.equal(remembered.target, 'centre');
  assert.ok(remembered.distanceM > 29000 && remembered.distanceM < 31000);

  const fresh = new UnifiedWorld();
  const unknown = fresh.destinationInfo(0, 0, 'RKSS');
  assert.equal(unknown.target, 'unknown');
  assert.equal(unknown.distanceM, null);
  assert.equal(unknown.bearingDeg, null);
  assert.equal(world.destinationInfo(0, 0, 'RKSU'), null);
  assert.deepEqual(world.incheonFrameToAnchor(30000, -2000), [30000, -2000]);
  world.setAnchor('jeju');
  assert.deepEqual(world.incheonFrameToAnchor(30000, -2000), [
    30000 - BASE_OFFSETS.jeju[0], -2000 - BASE_OFFSETS.jeju[1],
  ]);
});

test('Lukla uses its surveyed WGS84 origin in the world frame', () => {
  const expected = projectToLocal(AIRPORT_ORIGINS.lukla.latitude, AIRPORT_ORIGINS.lukla.longitude);
  assert.deepEqual([...BASE_OFFSETS.lukla], expected);
  const world = new UnifiedWorld('incheon');
  const info = world.destinationInfo(0, 0, 'lukla');
  assert.equal(info.id, 'lukla');
  assert.equal(info.code, 'LUK');
  assert.equal(info.synthetic, false);
  assert.equal(info.target, 'threshold');
  assert.ok(info.bearingDeg > 260 && info.bearingDeg < 270);
  assert.ok(info.distanceNm > 1000, 'Lukla should be far from Incheon in the real world frame');
  const expectedThreshold = [
    BASE_OFFSETS.lukla[0] + APPROACH_DATA.lukla.threshold.x,
    BASE_OFFSETS.lukla[1] + APPROACH_DATA.lukla.threshold.z,
  ];
  assert.ok(Math.hypot(info.dx - expectedThreshold[0], info.dz - expectedThreshold[1]) < 1e-6);
  const reprojected = wgs84ToLocal(
    RUNWAY_THRESHOLDS.lukla.latitude, RUNWAY_THRESHOLDS.lukla.longitude, AIRPORT_ORIGINS.incheon,
  );
  assert.ok(Math.hypot(info.dx - reprojected[0], info.dz - reprojected[1]) > 50,
    'do not use a separate tangent-plane projection for the rendered threshold marker');
});

// Anchor-local positions live on the Incheon tangent plane, translated by
// -BASE_OFFSETS[anchor]. One rendered world point must produce the same WGS84
// fix from every anchor, not only from the origin where both planes coincide.
const REAL_ANCHORS = ['incheon', 'jeju', 'lukla'];

function renderedThreshold(anchor, target) {
  return [
    BASE_OFFSETS[target][0] - BASE_OFFSETS[anchor][0] + APPROACH_DATA[target].threshold.x,
    BASE_OFFSETS[target][1] - BASE_OFFSETS[anchor][1] + APPROACH_DATA[target].threshold.z,
  ];
}

test('standing on a rendered real threshold reports near-zero distance from any anchor', () => {
  for (const anchor of REAL_ANCHORS) {
    for (const target of REAL_ANCHORS) {
      if (anchor === target) continue;
      const label = `${anchor} -> ${target}`;
      const marker = renderedThreshold(anchor, target);
      const info = new UnifiedWorld(anchor).destinationInfo(marker[0], marker[1], target);
      assert.equal(info.synthetic, false, label);
      assert.equal(info.target, 'threshold', label);
      assert.ok(Math.hypot(info.dx, info.dz) < 1e-6, `${label} rendered marker`);
      const routeM = haversineDistanceM(
        AIRPORT_ORIGINS[anchor].latitude, AIRPORT_ORIGINS[anchor].longitude,
        RUNWAY_THRESHOLDS[target].latitude, RUNWAY_THRESHOLDS[target].longitude,
      );
      assert.ok(info.distanceM < routeM * 1e-4,
        `${label} distance at rendered threshold: ${info.distanceM} m`);
    }
  }
});

test('mid-route guidance matches the Incheon-plane position from any anchor', () => {
  for (const anchor of REAL_ANCHORS) {
    for (const target of REAL_ANCHORS) {
      if (anchor === target) continue;
      const label = `${anchor} -> ${target}`;
      const marker = renderedThreshold(anchor, target);
      const mid = [marker[0] / 2, marker[1] / 2];
      const info = new UnifiedWorld(anchor).destinationInfo(mid[0], mid[1], target);
      const reference = worldPositionToWgs84(
        'incheon', mid[0] + BASE_OFFSETS[anchor][0], mid[1] + BASE_OFFSETS[anchor][1],
      );
      const threshold = RUNWAY_THRESHOLDS[target];
      assert.ok(Math.abs(info.distanceM - haversineDistanceM(
        reference.latitude, reference.longitude, threshold.latitude, threshold.longitude,
      )) < 1e-6, `${label} mid-route distance`);
      assert.ok(Math.abs(info.bearingDeg - initialBearingDeg(
        reference.latitude, reference.longitude, threshold.latitude, threshold.longitude,
      )) < 1e-6, `${label} mid-route bearing`);
      const full = haversineDistanceM(
        AIRPORT_ORIGINS[anchor].latitude, AIRPORT_ORIGINS[anchor].longitude,
        threshold.latitude, threshold.longitude,
      );
      assert.ok(Math.abs(info.distanceM - full / 2) < full * 0.06,
        `${label} half-route distance: ${info.distanceM} m`);
    }
  }
});

test('10 km offset guidance keeps the true bearing from any anchor', () => {
  for (const anchor of REAL_ANCHORS) {
    for (const target of REAL_ANCHORS) {
      if (anchor === target) continue;
      const label = `${anchor} -> ${target}`;
      const marker = renderedThreshold(anchor, target);
      const x = marker[0];
      const z = marker[1] + 10000; // 10 km south of the rendered threshold
      const info = new UnifiedWorld(anchor).destinationInfo(x, z, target);
      const reference = worldPositionToWgs84(
        'incheon', x + BASE_OFFSETS[anchor][0], z + BASE_OFFSETS[anchor][1],
      );
      const threshold = RUNWAY_THRESHOLDS[target];
      assert.ok(Math.abs(info.distanceM - haversineDistanceM(
        reference.latitude, reference.longitude, threshold.latitude, threshold.longitude,
      )) < 1e-6, `${label} 10 km distance`);
      assert.ok(Math.abs(info.bearingDeg - initialBearingDeg(
        reference.latitude, reference.longitude, threshold.latitude, threshold.longitude,
      )) < 1e-6, `${label} 10 km bearing`);
      assert.ok(Math.abs(info.distanceM - 10000) < 200,
        `${label} 10 km great-circle distance: ${info.distanceM} m`);
      // Incheon-plane grid convergence rotates "north" to ~339 deg at Lukla.
      const expected = target === 'lukla' ? 339.1 : 0;
      const error = Math.abs(((info.bearingDeg - expected + 540) % 360) - 180);
      assert.ok(error < 1, `${label} bearing ${info.bearingDeg} vs ${expected}`);
    }
  }
});

test('worldPositionToWgs84 has no frame for fictional anchors', () => {
  for (const id of ['coastal', 'neon', 'valley', 'unknown']) {
    assert.equal(worldPositionToWgs84(id, 100, 200), null, id);
  }
  assert.ok(worldPositionToWgs84('incheon', 0, 0));
});

test('custom tangent-plane origin isolates distant global flights from built-in regions and preserves WGS84', () => {
  const { world, incheon } = makeWorld();
  const chadOrigin = { latitude: 21.77655, longitude: 19.20233 };
  assert.equal(world.setCustomOrigin(chadOrigin), true);
  assert.equal(incheon.group.visible, false, 'built-in Incheon group is hidden under custom origin');
  assert.equal(world.regionAt(0, 0), null, 'built-in Incheon region does not claim (0, 0) in Chad');
  assert.ok(world.mesh && world.mesh !== incheon.group, 'custom origin uses its own open-world host group');

  const roundTrip = worldPositionToWgs84('incheon', 0, 0, world.customOrigin);
  assert.ok(Math.abs(roundTrip.latitude - chadOrigin.latitude) < 1e-6);
  assert.ok(Math.abs(roundTrip.longitude - chadOrigin.longitude) < 1e-6);

  const jfk = { latitude: 40.6413, longitude: -73.7781 };
  assert.equal(world.setCustomOrigin(jfk), true);
  const jfkWgs = worldPositionToWgs84('incheon', 0, 0, world.customOrigin);
  assert.ok(Math.abs(jfkWgs.latitude - jfk.latitude) < 1e-6, 'JFK does not fold across Incheon horizon');
  assert.ok(Math.abs(jfkWgs.longitude - jfk.longitude) < 1e-6);

  const dyn = fakeRegion(4, [0, 0]);
  world.registerDynamic('KJFK', { ...dyn, baseOffset: [0, 0] });
  assert.equal(world.regionAt(0, 0)?.id, 'KJFK', 'streamed airport resolves in custom origin frame');

  assert.equal(world.setCustomOrigin(null), true);
  assert.equal(incheon.group.visible, true, 'clearing custom origin restores Incheon group');
});
