import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { presentCombatEvent, syncCombatAudio } from '../src/weapons/combatPresentation.js';
import { CombatReplayPlayback } from '../src/replay/CombatReplayPlayback.js';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { decodeTrack, encodeTrack } from '../src/replay/ReplayCodec.js';

test('presentCombatEvent handles live and replay event shapes uniformly', () => {
  const calls = [];
  const view = {
    spawnExplosion(sys, payload) {
      calls.push(['explosion', sys, payload.position.toArray(), payload.velocity.toArray(), payload.target?.id ?? null]);
    },
  };
  const audio = {
    playMissileLaunch() { calls.push(['launch']); },
    playLockTone() { calls.push(['lock']); },
    playRemoteExplosion(distance, isWater) { calls.push(['remoteExplosion', Math.round(distance), isWater]); },
  };
  const camera = { position: new THREE.Vector3(0, 0, 0) };
  const explosionSystem = { tag: 'fx' };

  assert.equal(presentCombatEvent({ type: 'launch' }, { audio }), 'launch');
  assert.equal(presentCombatEvent({ kind: 'launch' }, { audio }), 'launch');
  assert.equal(presentCombatEvent({ type: 'lock' }, { audio }), 'lock');
  assert.equal(presentCombatEvent({
    kind: 'detonation',
    x: 3, y: 4, z: 0,
    vx: 10, vy: 20, vz: 30,
    surface: false,
  }, { view, explosionSystem, audio, camera }), 'detonation');
  assert.equal(presentCombatEvent({
    type: 'detonation',
    target: { id: 7 },
    position: new THREE.Vector3(0, 0, 10),
    velocity: new THREE.Vector3(1, 2, 3),
    surface: true,
  }, { view, explosionSystem, audio, camera }), 'detonation');

  assert.deepEqual(calls, [
    ['launch'],
    ['launch'],
    ['lock'],
    ['explosion', explosionSystem, [3, 4, 0], [10, 20, 30], null],
    ['remoteExplosion', 5, false],
    ['explosion', explosionSystem, [0, 0, 10], [1, 2, 3], 7],
    ['remoteExplosion', 10, true],
  ]);
});

test('CombatReplayPlayback plays launch and detonation audio once per pass', () => {
  const launches = [];
  const explosions = [];
  const audio = {
    playMissileLaunch() { launches.push(true); },
    playRemoteExplosion(distance, isWater) { explosions.push({ distance, isWater }); },
  };
  const scene = { add() {}, remove() {} };
  const playback = new CombatReplayPlayback({
    scene,
    camera: { position: new THREE.Vector3(0, 0, 0) },
    explosionSystem: { spawnExplosion() {} },
    audio,
  });

  playback.load({
    targets: [{ callsign: 'BANDIT 1' }],
    banditSamples: [{ timeSec: 0, rails: 0x3f, targets: [{ x: 100, y: 1000, z: 0, headingRad: 0, alive: true }] }],
    missileSamples: [{ timeSec: 1, id: 1, typeId: 'AIM9X', x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true }],
    events: [
      { timeSec: 1.0, kind: 'launch', missileId: 1, x: 0, y: 1000, z: 0, vx: 0, vy: 0, vz: 0 },
      { timeSec: 2.0, kind: 'detonation', missileId: 1, surface: false, x: 30, y: 40, z: 0, vx: 0, vy: 0, vz: 0 },
    ],
  });

  playback.update(0.1, 1.1);
  playback.update(0.1, 1.5);
  assert.equal(launches.length, 1);
  assert.equal(explosions.length, 0);

  playback.update(0.1, 2.1);
  assert.equal(launches.length, 1);
  assert.equal(explosions.length, 1);
  assert.equal(Math.round(explosions[0].distance), 50);
  assert.equal(explosions[0].isWater, false);
});

test('AirToAirMissileSystem.reset() resets elapsed to zero', () => {
  const sys = new AirToAirMissileSystem();
  sys.update(1.5, { position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), onGround: false });
  assert.ok(sys.elapsed > 1.0);
  sys.reset();
  assert.equal(sys.elapsed, 0);
});

test('ReplayRecorder and ReplayCodec round-trip targetId on kill events', () => {
  const recorder = new ReplayRecorder();
  recorder.start({ airport: 'coastal', aircraft: 'F16', scenario: 'cruise' });
  recorder.elapsed = 12.5;
  recorder.recordCombatEvent({
    type: 'kill',
    missile: { id: 2 },
    target: { id: 2 },
    hitZone: 'fuselage',
    position: new THREE.Vector3(100, 1000, -200),
    velocity: new THREE.Vector3(0, 0, -100),
  });
  const baseSample = {
    timeSec: 0, x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1],
    airspeedKnots: 300, verticalSpeedFpm: 0, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
    throttle: 0.8, flaps: 0, gearState: 0, speedbrake: 0, onGround: false,
    compressions: { nose: 0, mainLeft: 0, mainRight: 0 },
    gearDamage: {}, bodyDamage: {}, engine1: { n1: 0.8, egt: 500, fuelFlow: 1 }, engine2: { n1: 0, egt: 0, fuelFlow: 0 },
  };
  const track = {
    intervalSec: 0.2,
    durationSec: 15,
    metadata: { airport: 'coastal', aircraft: 'F16', scenario: 'cruise', gearIds: [], bodyIds: [] },
    samples: [baseSample, { ...baseSample, timeSec: 15 }],
    gearIds: [],
    bodyIds: [],
    combat: recorder.combat,
  };
  const decoded = decodeTrack(encodeTrack(track));
  const killEvent = decoded.combat.events.find(e => e.kind === 'kill');
  assert.ok(killEvent);
  assert.equal(killEvent.targetId, 2);
});

test('live and recorded countermeasure dispensers play distance-scaled flare and chaff audio', () => {
  const calls = [];
  const audio = {
    playFlareDispense(distance) { calls.push(['flare', Math.round(distance)]); },
    playChaffDispense(distance) { calls.push(['chaff', Math.round(distance)]); },
  };
  const camera = { position: new THREE.Vector3(0, 0, 0) };
  // Live events carry the decoy object; nothing in the cockpit is silent about it.
  const flare = { type: 'flare', position: new THREE.Vector3(0, 0, -300) };
  assert.equal(presentCombatEvent({ type: 'flare_dispense', flare, target: { id: 1 } }, { audio, camera }),
    'flare_dispense');
  const chaff = { type: 'chaff', position: new THREE.Vector3(0, 0, -400) };
  assert.equal(presentCombatEvent({ type: 'chaff_dispense', chaff }, { audio, camera }), 'chaff_dispense');
  // Recorded events are scalars with a decoy type.
  assert.equal(presentCombatEvent({ kind: 'decoy_dispense', decoyType: 'flare', x: 0, y: 0, z: -500 }, { audio, camera }),
    'decoy_dispense');
  assert.equal(presentCombatEvent({ kind: 'decoy_dispense', decoyType: 'chaff', x: 0, y: 0, z: -1200 }, { audio, camera }),
    'decoy_dispense');
  assert.deepEqual(calls, [['flare', 300], ['chaff', 400], ['flare', 500], ['chaff', 1200]]);
});

test('syncCombatAudio forwards missiles only when unpaused and launch passes camera distance (#784)', () => {
  const flightCalls = [];
  const launchDists = [];
  const audio = {
    syncMissileFlight(missiles, pos) { flightCalls.push({ count: missiles.length, pos }); },
    playMissileLaunch(dist) { launchDists.push(dist); },
  };
  const camera = { position: new THREE.Vector3(0, 0, 0) };
  presentCombatEvent({ kind: 'launch', x: 300, y: 400, z: 0 }, { audio, camera });
  presentCombatEvent({ type: 'launch', missile: { position: new THREE.Vector3(0, 600, 800) } }, { audio, camera });
  assert.deepEqual(launchDists, [500, 1000]);

  syncCombatAudio({ missiles: [{ alive: true }] }, { audio, camera, paused: false });
  syncCombatAudio({ missiles: [{ alive: true }] }, { audio, camera, paused: true });
  assert.deepEqual(flightCalls.map(c => c.count), [1, 0]);
});

test('syncCombatAudio feeds bandit engines to the spatial layer and stops them when paused (#862)', () => {
  const calls = [];
  const audio = {
    syncMissileFlight() {},
    syncRemoteEngines(targets, camera) {
      calls.push({ count: targets.length, sameCamera: camera?.tag === 'cam' });
    },
  };
  const camera = { tag: 'cam', position: new THREE.Vector3(0, 1000, 0) };
  const targets = [{ alive: true }, { alive: true }];
  syncCombatAudio({ missiles: [], targets }, { audio, camera, paused: false });
  syncCombatAudio({ missiles: [], targets }, { audio, camera, paused: true });
  assert.deepEqual(calls, [{ count: 2, sameCamera: true }, { count: 0, sameCamera: true }]);
});
