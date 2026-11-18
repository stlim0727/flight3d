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

test('a killed bandit falls as a burning wreck instead of vanishing instantly', () => {
  const scene = createMockScene();
  const target = {
    id: 1, callsign: 'BANDIT 1', alive: true,
    position: new THREE.Vector3(0, 1200, 0), velocity: new THREE.Vector3(0, 0, -250),
    quaternion: new THREE.Quaternion(), damage: 0.9, damageZones: {},
  };
  const system = { targets: [target], missiles: [], flares: [], chaffClouds: [] };
  const view = new MissileCombatView(scene, system, { terrainHeight: () => 1150 });
  for (let i = 0; i < 4; i++) {
    target.position.z -= 5;
    view.sync(0.02);
  }
  const mesh = view.targetViews.get(1).mesh;
  const deathZ = target.position.z;
  const deathY = mesh.position.y;

  target.alive = false;
  view.sync(0.02);
  assert.equal(mesh.visible, true, 'the airframe survives the kill');
  assert.ok(view.targetViews.get(1).wreck, 'a wreck starts from the last flight state');

  for (let i = 0; i < 100; i++) view.sync(0.02);
  assert.equal(mesh.visible, true);
  assert.ok(mesh.position.z < deathZ - 100, 'the wreck keeps the airframe momentum');
  assert.ok(mesh.position.y < deathY - 5, 'the wreck falls under gravity');

  // It burns until the ground, then stops drawing.
  for (let i = 0; i < 320; i++) view.sync(0.02);
  assert.equal(mesh.visible, false, 'the wreck ends on terrain impact');
  assert.equal(view.targetViews.get(1).wreck, null);

  // A respawn restores the airframe at the new patrol point.
  target.position.set(0, 1200, -3000);
  target.alive = true;
  view.sync(0.02);
  assert.equal(mesh.visible, true);
  assert.ok(mesh.position.distanceTo(target.position) < 1e-6);
  view.clear();
});

test('a target that was never seen alive does not fabricate a wreck', () => {
  const scene = createMockScene();
  const target = {
    id: 2, callsign: 'BANDIT 2', alive: false,
    position: new THREE.Vector3(0, 1200, 0), velocity: new THREE.Vector3(0, 0, -200),
    quaternion: new THREE.Quaternion(), damage: 1, damageZones: {},
  };
  const view = new MissileCombatView(scene, { targets: [target], missiles: [], flares: [], chaffClouds: [] });
  for (let i = 0; i < 5; i++) view.sync(0.02);
  assert.equal(view.targetViews.get(2).mesh.visible, false);
  view.clear();
});

test('replay playback shows the recorded bandit kill as a falling wreck', () => {
  const scene = createMockScene();
  const playback = new CombatReplayPlayback({
    scene,
    camera: { position: new THREE.Vector3() },
    explosionSystem: { spawnExplosion() {} },
    audio: {},
  });
  playback.load({
    targets: [{ callsign: 'BANDIT 1' }],
    banditSamples: [0, 0.5, 1, 1.5].map((timeSec, index) => ({
      timeSec,
      targets: [{ x: 0, y: 1000, z: -index * 120, headingRad: 0, alive: index < 2 }],
    })),
    missileSamples: [],
    events: [],
  });
  for (let time = 0; time <= 1.4; time += 1 / 60) playback.update(1 / 60, time);
  const view = playback.view.targetViews.get(0);
  const target = playback.state.targets[0];
  assert.equal(target.alive, false);
  assert.ok(view.wreck, 'the dead bandit keeps falling from its last flight state');
  assert.equal(view.mesh.visible, true);
  const fallY = view.mesh.position.y;
  const fallZ = view.mesh.position.z;
  for (let i = 0; i < 30; i++) playback.update(1 / 60, 1.4 + i / 60);
  assert.ok(view.mesh.position.y < fallY, 'the recorded airframe falls');
  assert.ok(view.mesh.position.z < fallZ, 'the recorded airframe keeps its momentum');

  // A seek after the kill has no motion history, so no phantom wreck is drawn.
  playback.seek(1.4);
  assert.equal(playback.view.targetViews.get(0).mesh.visible, false);
  playback.stop();
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

  const playedPos = playback.state.flares[0].position.clone();
  playback.seek(6.0);
  assert.ok(playback.state.flares[0].position.distanceTo(playedPos) < 1e-9,
    'seek and forward playback produce identical decoy positions');

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

test('a killed bandit breaks apart into structural debris and triggers ground impact explosion and audio', () => {
  const scene = createMockScene();
  const target = {
    id: 1, callsign: 'BANDIT 1', alive: true,
    position: new THREE.Vector3(0, 50, 0), velocity: new THREE.Vector3(0, 0, -200),
    quaternion: new THREE.Quaternion(), damage: 0.9, damageZones: {},
  };
  const system = { targets: [target], missiles: [], flares: [], chaffClouds: [] };
  const explosions = [];
  const audios = [];
  const fakeExplosionSystem = {
    spawnExplosion(config, velocity, options) {
      explosions.push({ config, velocity, options });
    },
  };
  const fakeAudio = {
    playRemoteExplosion(distance, isWater) {
      audios.push({ distance, isWater });
    },
  };
  const camera = { position: new THREE.Vector3(0, 100, 200) };

  const view = new MissileCombatView(scene, system, {
    terrainHeight: () => 10,
    explosionSystem: fakeExplosionSystem,
    audio: fakeAudio,
    camera,
  });

  // Alive step
  view.sync(0.02);
  target.position.z -= 4;
  view.sync(0.02);

  const targetView = view.targetViews.get(1);
  assert.ok(targetView.breakup, 'breakup is initialized for the bandit');
  assert.equal(targetView.aircraft.proxy.visible, true, 'proxy is visible while alive');

  // Kill step: breakup spawns, intact proxy is hidden, pieces are in scene
  target.alive = false;
  view.sync(0.02);
  assert.ok(targetView.wreck, 'wreck is created');
  assert.ok(targetView.breakup.pieces.length > 0, 'pieces are spawned');
  assert.equal(targetView.aircraft.proxy.visible, false, 'intact proxy is hidden during breakup');

  // Fall until terrain impact (terrain height = 10, start y = 50)
  for (let i = 0; i < 200; i++) {
    view.sync(0.02);
    if (!targetView.wreck) break;
  }

  assert.equal(targetView.wreck, null, 'wreck ended upon ground impact');
  assert.equal(targetView.mesh.visible, false, 'wreck mesh is hidden');
  assert.ok(explosions.length >= 1, 'ground impact explosion was spawned');
  assert.equal(explosions[0].config.type, 'TERRAIN');
  assert.equal(explosions[0].config.name, 'BANDIT IMPACT');
  assert.ok(audios.length >= 1, 'remote explosion audio was played');
  assert.equal(audios[0].isWater, false);
  assert.ok(audios[0].distance > 100);

  view.clear();
});

test('wing-localized hit shears single wing and induces aerodynamic death spiral with offset trail', () => {
  const scene = createMockScene();
  const target = {
    id: 10, callsign: 'BANDIT 10', alive: true,
    position: new THREE.Vector3(0, 1000, 0), velocity: new THREE.Vector3(0, 0, -200),
    quaternion: new THREE.Quaternion(), damage: 0.9, lastHitZone: 'wingL',
    damageZones: { wingL: 0.95, wingR: 0.1, fuselage: 0.2 },
  };
  const system = { targets: [target], missiles: [], flares: [], chaffClouds: [] };
  const view = new MissileCombatView(scene, system, { terrainHeight: () => 0 });

  view.sync(0.02);
  target.position.z -= 4;
  view.sync(0.02);

  const targetView = view.targetViews.get(10);
  assert.ok(targetView);

  // Kill step on left wing
  target.alive = false;
  view.sync(0.02);

  assert.ok(targetView.wreck);
  assert.ok(targetView.breakup);
  assert.ok(targetView.breakup.mainPiece, 'severed airframe is maintained as mainPiece');
  assert.equal(targetView.breakup.mainPiece.severedSide, 'left', 'left wing is registered severed');
  assert.ok(targetView.breakup.mainPiece.spin.z > 2.0, 'strong positive roll induced toward missing wing');
  assert.ok(targetView.breakup.mainPiece.spin.y < -1.0, 'yaw moment induced into drag of torn wing');

  const detachedWing = targetView.breakup.pieces.find(p => p.isDetachedPart);
  assert.ok(detachedWing, 'detached wing piece exists');
  assert.equal(detachedWing.partName, 'left');

  // Verify fire trail updates with offset position
  assert.ok(targetView.fireTrail);
  const trailX = targetView.fireTrail.positions[0];
  assert.ok(Math.abs(trailX - 0) > 0.5, 'trail emits from offset severed wing root');

  view.clear();
});
