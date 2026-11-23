import test from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { installPresetSpawner } from '../src/core/PresetSpawner.js';
import { BASE_OFFSETS, REGION_EXTENTS, UnifiedWorld } from '../src/world/UnifiedWorld.js';

class Spawner {}
installPresetSpawner(Spawner);

function region(height, extent) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  return {
    group,
    mesh,
    extent,
    terrain: { getHeight: () => height },
    airport: { isOnRunway: () => false },
  };
}

function makeSpawner() {
  const scene = new THREE.Scene();
  const world = new UnifiedWorld('incheon');
  const incheon = region(7, REGION_EXTENTS.incheon);
  const jeju = region(36, REGION_EXTENTS.jeju);
  const coastal = region(0, REGION_EXTENTS.coastal);
  const valley = region(2100, REGION_EXTENTS.valley);
  world.register('incheon', incheon).register('jeju', jeju).register('coastal', coastal).register('valley', valley);
  scene.add(incheon.group, incheon.mesh, jeju.group, jeju.mesh, coastal.group, coastal.mesh, valley.group, valley.mesh);
  const foliage = { group: new THREE.Group(), treeData: [], buildingData: [] };
  const ships = { group: new THREE.Group(), vessels: [], speedboats: [] };
  scene.add(foliage.group, ships.group);
  const spawner = new Spawner();
  Object.assign(spawner, {
    scene,
    world,
    currentTerrain: world,
    position: new THREE.Vector3(0, 0, 0),
    linearVelocity: new THREE.Vector3(),
    telemetry: { onGround: false },
    activeAirport: 'incheon',
    foliage,
    ships,
    water: { mesh: new THREE.Object3D() },
  });
  return spawner;
}

test('distant base regions leave the scene while their surfaces stay registered', () => {
  const spawner = makeSpawner();
  const { world } = spawner;
  const jeju = world.regions.get('jeju');
  const probe = [BASE_OFFSETS.jeju[0] + 10, BASE_OFFSETS.jeju[1] + 10];

  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('jeju'), false);
  assert.equal(jeju.group.parent, null);
  assert.equal(jeju.mesh.parent, null);
  assert.equal(world.getHeight(...probe), 36);
  assert.equal(world.regions.has('jeju'), true);

  spawner.position.set(probe[0], 500, probe[1]);
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('jeju'), true);
  assert.equal(jeju.group.parent, spawner.scene);
  assert.equal(world.getHeight(...probe), 36);

  spawner.position.set(0, 500, 0);
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('jeju'), false);
  assert.equal(jeju.group.parent, null);
  assert.equal(world.getHeight(...probe), 36);
});

test('mount and unmount distances differ, and coastal props follow their region', () => {
  const spawner = makeSpawner();
  const { world } = spawner;
  const coastal = world.regions.get('coastal');

  // Start far away so coastal is unmounted before probing the hysteresis band.
  spawner.position.set(0, 0, 0);
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('coastal'), false);

  // 38 km from the coastal box: too far to load, close enough to keep a mount.
  spawner.position.set(-30000, 0, -60000);
  assert.equal(spawner.updateRegionMounting(), false);
  assert.equal(spawner.foliage.group.parent, null);
  assert.equal(spawner.ships.group.parent, null);

  // 18 km: inside the load radius.
  spawner.position.set(-50000, 0, -60000);
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('coastal'), true);
  assert.equal(coastal.group.parent, spawner.scene);
  assert.equal(spawner.foliage.group.parent, spawner.scene);
  assert.equal(spawner.ships.group.parent, spawner.scene);

  spawner.position.set(-30000, 0, -60000);
  assert.equal(spawner.updateRegionMounting(), false, 'hysteresis must keep the region mounted');
  assert.equal(world.isMounted('coastal'), true);

  spawner.position.set(0, 0, 0);
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('coastal'), false);
  assert.equal(spawner.foliage.group.parent, null);
  assert.equal(spawner.ships.group.parent, null);
});

test('re-registering a region keeps its unmounted state', () => {
  const spawner = makeSpawner();
  const { world } = spawner;
  assert.equal(spawner.updateRegionMounting(), true);
  assert.equal(world.isMounted('jeju'), false);
  world.register('jeju', region(36, REGION_EXTENTS.jeju));
  assert.equal(world.isMounted('jeju'), false);
});

test('mount updates leave a mission-owned terrain and collision environment alone', () => {
  const spawner = makeSpawner();
  const { world } = spawner;
  const generated = { region: 'generated-valley' };
  spawner.currentTerrain = generated;
  spawner.activeAirport = 'generated-valley';
  spawner.pilotArena = { active: true };
  let environmentSets = 0;
  spawner.collisionDetector = { setEnvironment() { environmentSets += 1; } };
  spawner.world.setMounted('valley', false);
  const before = world.regions.get('valley').group.visible;

  assert.equal(spawner.updateRegionMounting(), false);
  assert.equal(environmentSets, 0);
  assert.equal(world.regions.get('valley').group.visible, before);
  assert.equal(world.isMounted('valley'), false);
});

test('handed-off runway visibility follows the common region mount state', () => {
  const spawner = new Spawner();
  const legacy = { visible: true };
  spawner._handedOffRunways = { VNLK: [legacy] };
  spawner.airportStreamer = { regionFor: () => null };
  spawner.syncLegacyRunwayHandoff();
  assert.equal(legacy.visible, true, 'legacy runway returns when common region unmounts');
  spawner.airportStreamer.regionFor = () => ({ airport: {} });
  spawner.syncLegacyRunwayHandoff();
  assert.equal(legacy.visible, false, 'legacy runway hides when common region is back');
});
