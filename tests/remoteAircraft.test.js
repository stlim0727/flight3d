import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RemoteAircraft } from '../src/multiplayer/RemoteAircraft.js';
import { createRemoteAircraftModel, disposeRemoteModel } from '../src/multiplayer/RemoteAircraftModel.js';

function fixture() {
  let loaded;
  const scene = new THREE.Scene(), group = new THREE.Group();
  const calls = [], indicator = { hide() {}, update() {}, dispose() { this.disposed = true; } };
  const model = { group, ready: new Promise(resolve => { loaded = resolve; }),
    setCockpitMode(value) { calls.push(['cockpit', value]); }, update(dt, state) { calls.push(['animate', state]); } };
  const remote = new RemoteAircraft(scene, 'F16', { createModel(id) { assert.equal(id, 'F16'); return model; }, createIndicator: () => indicator });
  return { scene, remote, model, calls, indicator, loaded };
}
const sample = { p: [10, 20, 30], q: [0, 0, 0, 1], gear: .4, flaps: 25, epoch: 0, round: 1 };

test('remote pose and configuration are independent of model load and local cockpit', async () => {
  const f = fixture();
  f.remote.update(sample, 'Pilot', null, { showIndicator: false });
  assert.deepEqual(f.remote.group.position.toArray(), sample.p);
  assert.equal(f.remote.group.visible, true);
  const light = new THREE.PointLight(); f.model.group.add(light);
  f.loaded(); await f.remote.ready;
  assert.deepEqual(f.calls.at(-1), ['animate', { gearState: .4, flapDegree: 25 }]);
  assert.equal(light.visible, false);
  f.remote.update(null, 'Pilot', null);
  assert.equal(f.remote.group.visible, false);
  f.remote.update({ ...sample, epoch: 1, gear: 1, flaps: 0 }, 'Pilot', null, { showIndicator: false });
  assert.equal(f.remote.group.visible, true);
  assert.deepEqual(f.calls.at(-1), ['animate', { gearState: 1, flapDegree: 0 }]);
  f.remote.dispose();
});

test('leave during model load releases late resources without resurrecting aircraft', async () => {
  const f = fixture();
  f.remote.dispose(); f.remote.dispose();
  assert.equal(f.scene.children.length, 0);
  assert.equal(f.indicator.disposed, true);
  let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0;
  const geometry = new THREE.BoxGeometry(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  f.model.group.add(new THREE.Mesh(geometry, [material, material]), new THREE.Mesh(geometry, material));
  f.loaded(); await f.remote.ready;
  f.remote.update(sample, 'Pilot', null);
  assert.equal(f.scene.children.length, 0);
  assert.deepEqual([geometryDisposals, materialDisposals, textureDisposals], [1, 1, 1]);
});

test('737 and C172 use production exterior classes without cockpit instruments', () => {
  const boeing = createRemoteAircraftModel('B738'), cessna = createRemoteAircraftModel('C172');
  assert.equal(boeing.constructor.name, 'Boeing737');
  assert.equal(boeing.cockpit, null);
  assert.equal(cessna.constructor.name, 'Cessna172');
  assert.equal(cessna.instrumentLight, undefined);
  for (const model of [boeing, cessna]) {
    model.setCockpitMode(false); model.update(0, { gearState: 0, flapDegree: 20 });
    disposeRemoteModel(model.group);
  }
  assert.throws(() => createRemoteAircraftModel('unknown'));
});
