import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Airport } from '../src/environment/Airport.js';
import { createAirportBuildings, validateAirportKit } from '../src/environment/AirportBuildings.js';

const bytes = await readFile(new URL('../public/models/airport/airport-kit.glb', import.meta.url));
const kit = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
class TestAirport extends Airport {
  buildRunway() {} // Canvas decals are unrelated to model placement.
  loadBuildings() { return Promise.resolve(false); }
}

test('real exterior kit has reusable meshes, shared materials and cheaper distant levels', () => {
  validateAirportKit(kit);
  assert.throws(() => validateAirportKit(new T.Group()), /missing TowerNear/);
  const airport = new TestAirport();
  const buildings = createAirportBuildings(kit, airport);
  assert.equal(buildings.lods.length, 14);
  const bays = buildings.lods.filter(lod => lod.name === 'TerminalBay');
  assert.strictEqual(bays[0].children[0].children[0].geometry, bays[1].children[0].children[0].geometry);
  assert.strictEqual(bays[0].children[0].children[0].material, bays[1].children[0].children[0].material);
  const triangles = object => {
    let count = 0; object.traverse(n => { if (n.isMesh) count += n.geometry.index.count / 3; }); return count;
  };
  const camera = new T.PerspectiveCamera();
  for (const lod of buildings.lods) {
    assert.ok(triangles(lod.children[0]) > triangles(lod.children[1]), lod.name);
    lod.updateMatrixWorld(true);
    const origin = lod.getWorldPosition(new T.Vector3());
    for (const [distance, level] of [[10, 0], [4000, 1], [10, 0]]) {
      camera.position.copy(origin).add(new T.Vector3(0, 0, distance)); camera.updateMatrixWorld(true); lod.update(camera);
      assert.equal(lod.getCurrentLevel(), level);
      assert.equal(lod.children.filter(n => n.visible).length, 1);
    }
  }
});

test('world bounds match tower cylinder, building AABBs and runway clearance', () => {
  const airport = new TestAirport(), buildings = createAirportBuildings(kit, airport);
  buildings.group.updateMatrixWorld(true);
  const t = airport.controlTowerData;
  const bounds = new T.Box3().setFromObject(buildings.tower);
  assert.ok(bounds.min.y >= t.y && bounds.max.y <= t.y + t.height);
  assert.ok(bounds.min.x >= t.x - t.radius && bounds.max.x <= t.x + t.radius);
  assert.ok(bounds.min.z >= t.z - t.radius && bounds.max.z <= t.z + t.radius);
  const hangars = buildings.lods.filter(n => n.name === 'Hangar');
  for (const [i, lod] of hangars.entries()) {
    const h = airport.hangarsData[i], b = new T.Box3().setFromObject(lod);
    assert.ok(Math.abs(b.min.x - (h.x - h.width / 2)) < .01);
    assert.ok(Math.abs(b.max.y - (h.y + h.height)) < .01);
    assert.ok(b.min.z >= h.z - h.depth / 2 - .2 && b.max.z <= h.z + h.depth / 2 + .2);
  }
  for (const lod of buildings.lods.filter(n => n.name === 'TerminalBay')) {
    const b = new T.Box3().setFromObject(lod), term = airport.terminalData;
    assert.ok(b.min.x >= term.x - term.width / 2 && b.max.x <= term.x + term.width / 2);
    assert.ok(b.max.y <= term.y + term.height);
  }
  assert.ok(new T.Box3().setFromObject(buildings.group).min.z > 170, 'clear of parallel taxiway and runway');
  // Existing world tower camera sits in the cab, with clear outward view.
  const ray = new T.Raycaster(new T.Vector3(120, 78, 280), new T.Vector3(-1, 0, 0), 0, 20);
  assert.equal(ray.intersectObject(buildings.tower, true).length, 0);
  ray.ray.direction.copy(new T.Vector3(-1250, 12, 0).sub(ray.ray.origin).normalize());
  assert.equal(ray.intersectObject(buildings.tower, true).length, 0, 'runway threshold sightline');
});

test('GLB failure leaves no buildings; success binds animation only once', async () => {
  const airport = new TestAirport();
  assert.equal(airport.towerGroup, null);
  assert.equal(airport.terminalGroup, null);
  assert.equal(airport.radarDish, null);
  assert.deepEqual(airport.beaconLights, []);
  assert.equal(airport.group.getObjectByName('airport-buildings-glb'), undefined);
  const error = console.error; console.error = () => {};
  try {
    assert.equal(await Airport.prototype.loadBuildings.call(airport, async () => { throw Error('offline'); }), false);
    assert.ok(airport.buildingsError instanceof Error);
    assert.equal(await Airport.prototype.loadBuildings.call(airport, async () => new T.Group()), false);
  } finally { console.error = error; }
  assert.equal(airport.towerGroup, null);
  assert.equal(airport.terminalGroup, null);
  assert.equal(airport.radarDish, null);
  assert.deepEqual(airport.beaconLights, []);
  assert.equal(airport.buildings, undefined);
  assert.equal(airport.group.getObjectByName('airport-buildings-glb'), undefined);
  assert.equal(await Airport.prototype.loadBuildings.call(airport, async () => kit), true);
  const buildings = airport.buildings;
  assert.equal(buildings.group.parent, airport.group);
  assert.equal(airport.towerGroup, buildings.tower);
  assert.equal(airport.beaconLights.length, 1);
  const radar = airport.radarDish;
  for (const dt of [.5, 0, .5]) airport.update(dt);
  assert.ok(Math.abs(radar.rotation.y - 1.8) < 1e-8);
  assert.equal(radar.position.y, 72.5);
  assert.equal(airport.beaconLights[0].parent.name, 'Beacon');
  assert.equal(airport.beaconLights[0].parent.position.y, 83);
});

test('tower-only placement omits terminal, bridges and hangars', () => {
  const airport = new TestAirport();
  const buildings = createAirportBuildings(kit, airport, { terminal: false });
  assert.deepEqual(buildings.lods.map(lod => lod.name), ['Tower']);
  assert.strictEqual(buildings.tower.parent, buildings.group);
  assert.strictEqual(buildings.radar.parent, buildings.tower);
  assert.strictEqual(buildings.beacon.parent.parent, buildings.tower);
  assert.deepEqual(buildings.tower.position.toArray(), [
    airport.controlTowerData.x, airport.controlTowerData.y, airport.controlTowerData.z
  ]);
});
