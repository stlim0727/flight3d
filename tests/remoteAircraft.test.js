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

test('remote aircraft crash triggers explosion, remote audio, breakup and persists on respawn', async () => {
  const scene = new THREE.Scene();
  const explosionCalls = [];
  const audioCalls = [];
  const breakupCalls = [];
  const explosionSystem = {
    spawnExplosion(crashResult, vel) { explosionCalls.push({ crashResult, vel }); }
  };
  const audio = {
    playRemoteExplosion(dist, isWater) { audioCalls.push({ dist, isWater }); }
  };
  const breakup = {
    prepare(m) { breakupCalls.push(['prepare', m]); },
    spawn(m, vel) { breakupCalls.push(['spawn', m, vel]); },
    update(dt, t, wl) { breakupCalls.push(['update', dt, t, wl]); },
    clear(opts) { breakupCalls.push(['clear', opts]); },
    disposePrepared() { breakupCalls.push(['disposePrepared']); }
  };
  const terrain = {
    getHeight(x, z) { return 0; },
    getWaterLevel(x, z) { return 0; }
  };
  const indicator = { hideCalls: 0, hide() { this.hideCalls++; }, update() {} };
  const model = { group: new THREE.Group(), ready: Promise.resolve(), setCockpitMode() {}, update() {} };
  const remote = new RemoteAircraft(scene, 'F16', {
    createModel: () => model,
    createIndicator: () => indicator,
    createBreakup: () => breakup,
    explosionSystem,
    audio,
    terrain
  });
  await remote.ready;

  // 1. Initial flying sample
  const flightSample = { p: [100, 50, 200], q: [0, 0, 0, 1], v: [50, -5, 10], gear: 0, flaps: 0, crashed: false };
  remote.update(flightSample, 'Ghost', null, { localPosition: new THREE.Vector3(0, 50, 0) });
  assert.equal(remote.group.visible, true);
  assert.equal(explosionCalls.length, 0);

  // 2. Crash sample on land
  const crashSample = { p: [150, 20, 250], q: [0, 0, 0, 1], v: [60, -20, 15], gear: 0, flaps: 0, crashed: true };
  remote.update(crashSample, 'Ghost', null, { localPosition: new THREE.Vector3(0, 50, 0) });
  assert.equal(remote.group.visible, false);
  assert.equal(explosionCalls.length, 1);
  assert.equal(explosionCalls[0].crashResult.type, 'TERRAIN');
  assert.equal(audioCalls.length, 1);
  assert.equal(audioCalls[0].isWater, false);
  assert.ok(audioCalls[0].dist > 0);
  assert.equal(breakupCalls.some(c => c[0] === 'spawn'), true);
  assert.ok(indicator.hideCalls > 0);

  // 3. Stays crashed
  remote.update(crashSample, 'Ghost', null);
  assert.equal(explosionCalls.length, 1, 'Explosion should only fire once per crash event');

  // 4. Respawn (crashed becomes false)
  const respawnSample = { p: [0, 500, 0], q: [0, 0, 0, 1], v: [80, 0, 0], gear: 0, flaps: 0, crashed: false };
  remote.update(respawnSample, 'Ghost', null);
  assert.equal(remote.group.visible, true);
  const clearCall = breakupCalls.find(c => c[0] === 'clear');
  assert.ok(clearCall, 'Breakup should be cleared with persistence on respawn');
  assert.deepEqual(clearCall[1], { persist: true, duration: 30 });

  remote.dispose();
  assert.equal(breakupCalls.at(-1)[0], 'disposePrepared');
});

test('remote aircraft water crash detects WATER and passes isWater to audio and explosion', async () => {
  const scene = new THREE.Scene();
  const explosionCalls = [];
  const audioCalls = [];
  const explosionSystem = {
    spawnExplosion(crashResult, vel) { explosionCalls.push({ crashResult, vel }); }
  };
  const audio = {
    playRemoteExplosion(dist, isWater) { audioCalls.push({ dist, isWater }); }
  };
  const terrain = {
    getHeight(x, z) { return -10; },
    getWaterLevel(x, z) { return 0; }
  };
  const model = { group: new THREE.Group(), ready: Promise.resolve(), setCockpitMode() {}, update() {} };
  const remote = new RemoteAircraft(scene, 'F16', {
    createModel: () => model,
    createIndicator: () => ({ hide() {}, update() {} }),
    createBreakup: () => ({ prepare() {}, spawn() {}, update() {}, clear() {}, disposePrepared() {} }),
    explosionSystem,
    audio,
    terrain
  });
  await remote.ready;

  const waterCrashSample = { p: [0, 0.5, 0], q: [0, 0, 0, 1], v: [30, -10, 5], gear: 0, flaps: 0, crashed: true };
  remote.update(waterCrashSample, 'Ghost', null, { localPosition: new THREE.Vector3(0, 0, 0) });
  assert.equal(explosionCalls.length, 1);
  assert.equal(explosionCalls[0].crashResult.type, 'WATER');
  assert.equal(audioCalls.length, 1);
  assert.equal(audioCalls[0].isWater, true);
  remote.dispose();
});
