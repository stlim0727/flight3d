import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AirportNightLighting, nightLightLevel } from '../src/environment/AirportNightLighting.js';
import { installInstrumentLighting } from '../src/aircraft/InstrumentLighting.js';
import { createRoomLightTexture } from '../src/environment/WindowRoomLighting.js';
import { createBuildingMaterials } from '../src/previews/incheonCityAssets.js';

const runway = { start: [0, 2805, 0], end: [447, 2867, -279], width: 30, spacing: 35 };

test('dusk lighting transitions continuously and returns to its daytime state', () => {
  assert.equal(nightLightLevel(-.2), 1);
  assert.equal(nightLightLevel(.2), 0);
  assert.ok(nightLightLevel(0) > 0 && nightLightLevel(0) < 1);
  let previous = 1;
  for (let height = -.1; height <= .08; height += .001) {
    const next = nightLightLevel(height);
    assert.ok(next <= previous && next >= 0);
    previous = next;
  }
});

test('runway lights follow the sloped centreline and both threshold rows have directional colours', () => {
  const parent = new THREE.Group();
  const lights = new AirportNightLighting(parent, [runway]);
  assert.equal(lights.group.parent, parent);
  const edges = lights.sources.filter(source => !source.endDirection);
  assert.equal(edges.length % 2, 0);
  for (let i = 0; i < edges.length; i += 2) {
    const a = new THREE.Vector3(...edges[i].position);
    const b = new THREE.Vector3(...edges[i + 1].position);
    assert.ok(Math.abs(a.distanceTo(b) - 32) < 1e-8);
    const fraction = i / (edges.length - 2);
    assert.ok(Math.abs(a.y - (2805 + 62 * fraction + .65)) < 1e-8);
  }
  const ends = lights.sources.filter(source => source.endDirection);
  assert.equal(ends.length, 22);
  assert.ok(new THREE.Vector3(...ends[0].endDirection).dot(new THREE.Vector3(...ends.at(-1).endDirection)) < -.99);
  assert.equal(lights.points.geometry.attributes.position.count, lights.sources.length);
  let realLights = 0;
  lights.group.traverse(node => { if (node.isLight) realLights++; });
  assert.equal(realLights, 0, 'Runway lamps must not create hundreds of shader lights');
});

test('night windows are isolated from shared assets, including late model loads; apron lamps illuminate pavement', () => {
  const parent = new THREE.Group();
  const lights = new AirportNightLighting(parent, [runway], [{ x: 25, y: 7, z: 45 }]);
  const material = new THREE.MeshStandardMaterial({ name: 'terminal-glass', emissive: 0x010203, emissiveIntensity: .1 });
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const b = new THREE.Mesh(a.geometry, material);
  root.add(a, b);
  lights.update(-.3);
  lights.illuminateWindows(root);
  assert.notEqual(a.material, material);
  assert.equal(a.material, b.material, 'Instanced/shared glazing keeps one lighting material');
  assert.equal(a.material.emissiveIntensity, .75);
  assert.equal(material.emissiveIntensity, .1);
  lights.illuminateWindows(root);
  assert.equal(lights.windows.size, 1);
  const { light, head } = lights.lamps[0];
  assert.ok(light.intensity > 0 && head.material.emissiveIntensity > 0);
  assert.equal(light.target.position.y, 7);
  assert.equal(light.castShadow, false);
  lights.update(.5);
  assert.equal(light.intensity, 0);
  assert.equal(a.material.emissiveIntensity, .1);
  assert.ok(a.material.emissive.equals(material.emissive));
  lights.update(-.3);
  assert.equal(a.material.emissiveIntensity, .75);
});

test('Incheon emission masks light windows without illuminating masonry or roofs', () => {
  const materials = createBuildingMaterials();
  for (const key of ['glass', 'masonry']) {
    const pixels = materials[key].emissiveMap.image.data;
    assert.ok(pixels.some((v, i) => i % 4 !== 3 && v === 255));
    assert.ok(pixels.some((v, i) => i % 4 !== 3 && v === 0));
    assert.equal(materials[key].emissiveIntensity, 0);
  }
  assert.equal(materials.roof.emissiveMap, null);
});

test('instrument flood follows sunset, crash power loss, reset and sunrise without moving its target', () => {
  const cockpit = { group: new THREE.Group() };
  let powered = true;
  const light = installInstrumentLighting(cockpit, { x: -.22, y: .72, z: -1.18 }, 0xffb46b, () => powered);
  const target = light.target.position.clone();
  const sync = height => cockpit.syncLighting({ sunPosition: new THREE.Vector3(0, height, 0) });
  sync(1); assert.equal(light.intensity, 0);
  sync(-1); assert.ok(light.intensity > 0);
  powered = false; sync(-1); assert.equal(light.intensity, 0);
  powered = true; sync(-1); assert.ok(light.intensity > 0);
  sync(1); assert.equal(light.intensity, 0);
  assert.ok(light.target.position.equals(target));
  assert.equal(light.parent, cockpit.group);
  assert.ok(light.distance < 2, 'Shielded flood must not illuminate terrain outside the aircraft');
});


test('occupied-room palette varies brightness, colour temperature and vacancy without flickering', () => {
  const a = createRoomLightTexture(), b = createRoomLightTexture();
  assert.deepEqual(a.image.data, b.image.data, 'Room occupancy must be stable across reloads');
  const rooms = Array.from({ length: a.image.width * a.image.height }, (_, i) =>
    Array.from(a.image.data.slice(i * 4, i * 4 + 3)));
  assert.ok(new Set(rooms.map(rgb => rgb.join(','))).size > 100);
  assert.ok(rooms.filter(rgb => Math.max(...rgb) < 20).length > rooms.length * .05);
  assert.ok(rooms.filter(([r, , b]) => r > b * 1.4).length > rooms.length * .2);
  assert.ok(rooms.filter(([r, , b]) => b > r).length > rooms.length * .1);
  assert.equal(a.minFilter, THREE.NearestFilter, 'Adjacent rooms must retain distinct light settings');
  a.dispose(); b.dispose();
});

test('apron flood aims at aircraft height and covers the stand without shadow-map cost', () => {
  const lights = new AirportNightLighting(new THREE.Group(), [], [{
    x: 30, y: 12, z: 275, height: 18, target: [30, 15, 225],
  }]);
  const { light, maximum } = lights.lamps[0];
  assert.deepEqual(light.target.position.toArray(), [30, 15, 225]);
  assert.ok(light.distance > light.position.distanceTo(light.target.position));
  assert.ok(maximum >= 18 * 18 * 10, 'Aircraft-height illumination needs more output than a downward street lamp');
  lights.update(-.3);
  assert.equal(light.intensity, maximum);
  lights.update(.3);
  assert.equal(light.intensity, 0);
});
