import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedWorld, BASE_OFFSETS, REGION_EXTENTS } from '../src/world/UnifiedWorld.js';
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
  assert.equal(world.getHeight(1e6, 1e6), 0);
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
  assert.equal(world.isLoaded, true);
  world.setAnchor('lukla');
  assert.equal(world.isLoaded, false);
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
  facade.update(0.016, pos, 42, { quality: 'high', cameraPosition: pos });

  assert.equal(seen.length, 2);
  const incheon = seen.find(s => s.id === 'incheon');
  const jeju = seen.find(s => s.id === 'jeju');
  assert.equal(incheon.x, pos.x);
  assert.equal(jeju.x, 20);
  assert.equal(jeju.z, 30);
  assert.equal(jeju.cameraX, 20);
  assert.equal(jeju.quality, 'high');
  assert.equal(facade.controlTowerData.x, 1);
});
