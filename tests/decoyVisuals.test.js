import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { MissileCombatView } from '../src/weapons/MissileCombatView.js';
import { CombatReplayPlayback } from '../src/replay/CombatReplayPlayback.js';
import { Flare } from '../src/weapons/Flare.js';
import { ChaffCloud } from '../src/weapons/Chaff.js';

function createMockScene() {
  const objects = new Set();
  return {
    objects,
    add(obj) { objects.add(obj); },
    remove(obj) { objects.delete(obj); },
  };
}

test('MissileCombatView renders and cleans up live flares and chaff clouds (#783)', () => {
  const scene = createMockScene();
  const flare = new Flare(new THREE.Vector3(10, 1000, -20), new THREE.Vector3(0, 0, -100));
  const chaff = new ChaffCloud(new THREE.Vector3(15, 1000, -20), new THREE.Vector3(0, 0, -100));
  const system = { targets: [], missiles: [], flares: [flare], chaffClouds: [chaff] };
  const view = new MissileCombatView(scene, system);

  view.sync(0.1);
  assert.equal(view.flareViews.size, 1);
  assert.equal(view.chaffViews.size, 1);
  assert.ok(scene.objects.size >= 3, 'flare sprite, flare smoke trail, and chaff points are in scene');

  flare.alive = false;
  chaff.alive = false;
  view.sync(0.1);
  assert.equal(view.flareViews.size, 0);
  assert.equal(view.chaffViews.size, 0);

  view.clear();
  assert.equal(scene.objects.size, 0);
});

test('CombatReplayPlayback reconstructs flares and chaff from decoy_dispense events (#783)', () => {
  const scene = createMockScene();
  const playback = new CombatReplayPlayback({
    scene,
    camera: { position: new THREE.Vector3() },
    explosionSystem: { spawnExplosion() {} },
    audio: {},
  });

  playback.load({
    targets: [{ callsign: 'BANDIT 1' }],
    banditSamples: [
      { timeSec: 0, rails: 0x3f, targets: [{ x: 0, y: 1000, z: 0, headingRad: 0, alive: true }] },
      { timeSec: 20, rails: 0x3f, targets: [{ x: 0, y: 1000, z: -2000, headingRad: 0, alive: true }] },
    ],
    missileSamples: [],
    events: [
      { timeSec: 5.0, kind: 'decoy_dispense', decoyType: 'flare', missileId: 0, x: 10, y: 1000, z: -50, vx: 0, vy: -5, vz: -150 },
      { timeSec: 5.0, kind: 'decoy_dispense', decoyType: 'chaff', missileId: 0, x: 12, y: 1000, z: -50, vx: 0, vy: 0, vz: -150 },
    ],
  });

  playback.update(0.1, 4.5);
  assert.equal(playback.state.flares.length, 0);
  assert.equal(playback.state.chaffClouds.length, 0);

  playback.update(0.1, 6.0);
  assert.equal(playback.state.flares.length, 1);
  assert.equal(playback.state.chaffClouds.length, 1);
  assert.equal(playback.view.flareViews.size, 1);
  assert.equal(playback.view.chaffViews.size, 1);
  assert.ok(playback.state.flares[0].position.z < -50, 'flare advected along velocity');

  // After 6s flare lifetime (t=12s), flare expires while 12s chaff remains alive.
  playback.seek(12.0);
  assert.equal(playback.state.flares.length, 0);
  assert.equal(playback.state.chaffClouds.length, 1);
  assert.equal(playback.view.flareViews.size, 0);
  assert.equal(playback.view.chaffViews.size, 1);

  // Seeking backwards before dispense clears active decoys.
  playback.seek(2.0);
  assert.equal(playback.state.flares.length, 0);
  assert.equal(playback.state.chaffClouds.length, 0);
});
