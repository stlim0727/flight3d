import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FoliageAndCities } from '../src/environment/FoliageAndCities.js';
import { cityWindowIntensity } from '../src/environment/CityBuildingAssets.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

test('city archetypes preserve placement envelopes and switch instance detail by distance', () => {
  let seed = 12345;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const city = new FoliageAndCities({ getHeight: () => 25 }, random);

  assert.ok(city.buildingData.length > 400);
  assert.equal(city.cityArchetypes.length, 6);
  assert.equal(city.cityArchetypes.reduce((n, a) => n + a.near.count + a.far.count, 0), city.buildingData.length);
  for (const data of city.buildingData) {
    assert.ok(Math.abs(data.x) >= 2200 + data.width / 2 || Math.abs(data.z) >= 420 + data.depth / 2,
      'rotated footprint stays out of the runway exclusion zone');
    assert.ok(Math.abs(data.width - (Math.abs(Math.cos(data.rotationY)) * data.localWidth +
      Math.abs(Math.sin(data.rotationY)) * data.localDepth)) < 1e-8);
  }
  for (const { records, near } of city.cityArchetypes) {
    assert.ok(records.length > 0);
    near.geometry.computeBoundingBox();
    const sample = records[0];
    const bounds = near.geometry.boundingBox.clone().applyMatrix4(sample.matrix);
    const data = city.buildingData.find(b => b.x === sample.x && b.z === sample.z);
    assert.ok(Math.abs(bounds.min.x - (data.x - data.width / 2)) < 1e-5);
    assert.ok(Math.abs(bounds.max.z - (data.z + data.depth / 2)) < 1e-5);
    assert.ok(Math.abs(bounds.min.y - data.visualY) < 1e-5);
    assert.ok(Math.abs(bounds.max.y - (data.y + data.height)) < 1e-5);
  }

  const sample = city.cityArchetypes[0].records[0];
  city.updateCityLod(new THREE.Vector3(sample.x, sample.y + 60, sample.z));
  assert.ok(city.cityArchetypes[0].near.count > 0);
  assert.equal(city.cityArchetypes.reduce((n, a) => n + a.near.count + a.far.count, 0), city.buildingData.length);
  city.updateCityLod(new THREE.Vector3(0, 10000, 0));
  assert.equal(city.cityArchetypes.reduce((n, a) => n + a.near.count, 0), 0);

  city.setTimeOfDay(12);
  assert.equal(city.cityAssets.nearMaterial.emissiveIntensity, 0);
  city.setTimeOfDay(23);
  assert.equal(city.cityAssets.nearMaterial.emissiveIntensity, cityWindowIntensity(23));
  assert.ok(city.cityAssets.nearMaterial.emissiveIntensity <= 0.75);
  const mask = city.cityAssets.atlas.emissiveMap.image.data;
  assert.ok(mask.some(value => value > 0), 'some windows must glow at night');
  assert.ok(mask.some(value => value === 0), 'unlit panes and walls must remain dark');

  for (const archetype of [0, 1, 2]) {
    const building = city.buildingData.find(item => item.archetype === archetype && item.height > 60);
    const detector = new CollisionDetector(null, null, { treeData: [], buildingData: [building] }, null, null);
    const inside = [{ pos: new THREE.Vector3(building.x, building.y + building.height / 2, building.z), radius: 0, desc: 'test' }];
    const above = [{ pos: new THREE.Vector3(building.x, building.y + building.height + 1, building.z), radius: 0, desc: 'test' }];
    assert.ok(detector.checkCityBuildings(inside[0].pos, inside), `archetype ${archetype} must collide`);
    assert.equal(detector.checkCityBuildings(above[0].pos, above), null, `archetype ${archetype} must clear above the roof`);
  }
});

test('rotated city footprint is included in collision broadphase and probe check', () => {
  const building = { x: 500, y: 20, z: 500, width: 50, height: 80, depth: 20, rotationY: Math.PI / 2 };
  const detector = new CollisionDetector(null, null, { treeData: [], buildingData: [building] }, null, null);
  const probe = (x, y, z) => [{ pos: new THREE.Vector3(x, y, z), radius: 0, desc: 'test' }];
  assert.ok(detector.checkCityBuildings(new THREE.Vector3(524, 60, 500), probe(524, 60, 500)));
  assert.equal(detector.checkCityBuildings(new THREE.Vector3(526, 60, 500), probe(526, 60, 500)), null);
  assert.equal(detector.checkCityBuildings(new THREE.Vector3(500, 101, 500), probe(500, 101, 500)), null);
});

test('district lots leave road clearance, exclude trees and keep collision envelopes', () => {
  const city = new FoliageAndCities({ getHeight: () => 25 }, () => .5);
  const district = city.buildingData.filter(b => b.district === 'south');
  assert.equal(district.length, 110);
  for (const b of district) {
    assert.ok(b.width <= 44 && b.depth <= 44);
    for (const other of district) if (other !== b) {
      assert.ok(Math.abs(b.x - other.x) >= 60 || Math.abs(b.z - other.z) >= 60);
    }
    assert.ok(!city.treeData.some(t => Math.abs(t.x - b.x) < 30 && Math.abs(t.z - b.z) < 30));
  }
  const road = city.group.getObjectByName('district-roads');
  assert.ok(road.geometry.attributes.position.count > 0);
  const positions = road.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) assert.ok(Math.abs(positions.getY(i) - 25.12) < 1e-4);
});

test('actual GLB kit fits the collision envelope and contains detailed facades', async () => {
  const { readFile } = await import('node:fs/promises');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const bytes = await readFile(new URL('../public/models/city/district-kit.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (let i = 0; i < 3; i++) {
    const mesh = gltf.scene.getObjectByName(`District${i}`);
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox;
    assert.ok(Math.abs(min.x + .5) < 1e-6 && Math.abs(max.x - .5) < 1e-6);
    assert.ok(Math.abs(min.y) < 1e-6 && Math.abs(max.y - 1) < 1e-6);
    assert.ok(min.z >= -.500001 && max.z <= .500001);
    assert.ok(mesh.geometry.attributes.position.count > 300);
    assert.ok(mesh.material.vertexColors);
  }
});

test('sloped lots have foundations and far LOD covering the same collision volume', () => {
  const terrain = { getHeight: (x, z) => 30 + x * .02 + z * .01 };
  const city = new FoliageAndCities(terrain, () => .5);
  const b = city.buildingData.find(b => b.archetype >= 3);
  const batch = city.cityArchetypes[b.archetype];
  const record = batch.records.find(r => r.x === b.x && r.z === b.z);
  const foundation = city.cityFoundations.geometry;
  foundation.computeBoundingBox();
  const bounds = foundation.boundingBox.clone().applyMatrix4(record.foundationMatrix);
  assert.ok(Math.abs(bounds.min.y - b.y) < 1e-5);
  assert.ok(Math.abs(bounds.max.y - b.visualY) < 1e-5);
  assert.ok(b.visualY > b.y);
  const far = batch.far.geometry; far.computeBoundingBox();
  const farBounds = far.boundingBox.clone().applyMatrix4(record.farMatrix);
  assert.ok(Math.abs(farBounds.min.y - b.y) < 1e-5);
  assert.ok(Math.abs(farBounds.max.y - (b.y + b.height)) < 1e-5);
  city.updateCityLod(new THREE.Vector3(b.x, b.y + 60, b.z));
  assert.ok(city.cityFoundations.count > 0);
  city.updateCityLod(new THREE.Vector3(0, 10000, 0));
  assert.equal(city.cityFoundations.count, 0);
});

test('default constructor uses a deterministic PRNG producing repeatable building placements', () => {
  const terrain = { getHeight: () => 25 };
  const city1 = new FoliageAndCities(terrain);
  const city2 = new FoliageAndCities(terrain);
  assert.equal(city1.buildingData.length, city2.buildingData.length);
  for (let i = 0; i < city1.buildingData.length; i++) {
    const b1 = city1.buildingData[i], b2 = city2.buildingData[i];
    assert.equal(b1.x, b2.x);
    assert.equal(b1.z, b2.z);
    assert.equal(b1.height, b2.height);
  }
});
