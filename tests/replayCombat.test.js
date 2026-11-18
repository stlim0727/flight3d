import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { encodeTrack, decodeTrack, COMBAT_TRACK_VERSION } from '../src/replay/ReplayCodec.js';
import { CombatReplayPlayback } from '../src/replay/CombatReplayPlayback.js';
import { MissileCombatView, MissileSmokeTrail } from '../src/weapons/MissileCombatView.js';
import { REPLAY_BUDGET, base64ByteLength } from '../src/replay/replayConfig.js';

const QUAT = { x: 0.01, y: 0.7, z: -0.02, w: 0.7139 };
const TELEMETRY = {
  x: 500, z: -800, altitudeFt: 4000, iasKnots: 180, gForce: 1.2, pitchDeg: 2.5, rollDeg: -4,
  headingDeg: 270, onGround: false, elevator: -0.2, aileron: 0.1, rudder: 0, pitchTrim: 0.05,
  throttle: 0.75, flapDegree: 10, flapIndex: 1, spoilers: 0, gearState: 1,
  tasKnots: 195, groundSpeedKnots: 188, vsiFpm: 250, radioAltFt: 3800, mach: 0.32,
  compressions: { nose: 0.1, mainLeft: 0.2, mainRight: 0.2 },
  gearDamage: { nose: 'normal', mainLeft: 'normal', mainRight: 'normal' },
  bodyDamage: { belly: 0, wingL: 0, engineR: 0 },
  engine1: { n1: 80, n2: 88, egt: 520, ff: 900, failed: false },
  engine2: { n1: 79, n2: 87, egt: 515, ff: 890, failed: false },
  isTransit: false, touchdown: false, isStalled: false, isPreStall: false, isStallWarning: false,
  reverserActive: false, apEngaged: true, parkBrake: false,
  selectedHeading: 270, selectedAltitude: 4000, selectedSpeed: 180,
};
const METADATA = { airport: 'coastal', aircraft: 'F16', scenario: 'cruise', timeOfDay: 14 };
const TICK = 1 / 120;

function combatAt(timeSec) {
  return {
    targets: [
      { id: 11, callsign: 'BANDIT 1', alive: true,
        position: { x: 1000 + timeSec, y: 3000, z: -5000 }, velocity: { x: 0, y: 0, z: -180 } },
      { id: 12, callsign: 'BANDIT 2', alive: true,
        position: { x: -1000, y: 3100, z: -5200 }, velocity: { x: 180, y: 0, z: 0 } },
    ],
    loaded: [true, true, true, true, true, true],
    missiles: [{
      id: 7, typeId: 'AIM9X', alive: true,
      position: { x: timeSec * 100, y: 3000, z: -1000 - timeSec * 50 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      propellant: timeSec < 2 ? 0.5 : 0,
    }],
  };
}

function recordCombat(seconds, options = {}) {
  const recorder = new ReplayRecorder(options);
  recorder.start(METADATA);
  for (let tick = 0; tick < Math.round(seconds * 120); tick++) {
    recorder.update(TICK, TELEMETRY, QUAT, combatAt(recorder.elapsed + TICK));
  }
  return recorder;
}

test('the recorder samples bandits at 2 Hz and missiles at 20 Hz independently of pose thinning', () => {
  const recorder = recordCombat(5);
  recorder.recordCombatEvent({
    type: 'detonation', missile: { id: 7 },
    position: { x: 500, y: 3000, z: -1250 }, velocity: { x: 600, y: 0, z: 0 },
  });
  const track = recorder.finish();
  assert.ok(track.combat, 'combat data is attached to the replay');
  assert.deepEqual(track.combat.targets.map(target => target.callsign), ['BANDIT 1', 'BANDIT 2']);
  assert.ok(track.combat.banditSamples.length >= 10 && track.combat.banditSamples.length <= 12);
  assert.ok(track.combat.missileSamples.length >= 99 && track.combat.missileSamples.length <= 101);
  assert.equal(track.combat.banditSamples[0].rails, 0x3f);
  assert.ok(track.combat.missileSamples[0].powered);
  assert.equal(track.combat.missileSamples.at(-1).powered, false);
  assert.equal(track.combat.events.length, 1);
  assert.equal(track.combat.events[0].kind, 'detonation');
  assert.equal(track.combat.events[0].missileId, 7);

  const decoded = decodeTrack(encodeTrack(track));
  assert.equal(decoded.version, COMBAT_TRACK_VERSION);
  assert.equal(decoded.combat.targets[0].callsign, 'BANDIT 1');
  assert.equal(decoded.combat.banditSamples.length, track.combat.banditSamples.length);
  assert.equal(decoded.combat.missileSamples.length, track.combat.missileSamples.length);
  assert.equal(decoded.combat.events[0].x, 500);
});

test('a short entry budget thins combat samples before refusing the track', () => {
  const recorder = recordCombat(5, { maxBase64Bytes: 4000 });
  const track = recorder.finish();
  assert.ok(track);
  assert.ok(base64ByteLength(encodeTrack(track).length) <= 4000);
  assert.ok((track.combat?.banditSamples.length ?? 0) >= 1);
});

test('combat event times follow the replay clock, not the combat system clock', () => {
  const recorder = recordCombat(5);
  recorder.elapsed = 12.5;
  // Combat systems integrate their own render-frame clock, which drifts from
  // the pose/sample timeline; the stored event must land on the replay timeline.
  recorder.recordCombatEvent({
    type: 'launch', timeSec: 4.2, missile: { id: 3, position: { x: 1, y: 2, z: 3 } },
  });
  const decoded = decodeTrack(encodeTrack(recorder.finish())).combat;
  const launch = decoded.events.find(event => event.kind === 'launch');
  assert.equal(launch.timeSec, 12.5);
});

test('replay playback interpolates combat and stages each detonation once', () => {
  const recorder = recordCombat(5);
  recorder.recordCombatEvent({
    type: 'detonation', missile: { id: 7 },
    position: { x: 300, y: 3000, z: -1200 }, velocity: { x: 600, y: 0, z: 0 },
  });
  recorder.recordCombatEvent({ type: 'kill', position: { x: 300, y: 3000, z: -1200 } });
  const combat = decodeTrack(encodeTrack(recorder.finish())).combat;
  let explosions = 0;
  const sounds = [];
  const sim = {
    scene: new Scene(),
    camera: { position: new Vector3(0, 3000, 0) },
    explosionSystem: { spawnExplosion() { explosions++; } },
    audio: { playRemoteExplosion(distance, isWater) { sounds.push({ distance, isWater }); } },
  };
  const playback = new CombatReplayPlayback(sim);
  assert.equal(playback.load(combat), true);

  const origin = new Vector3(0, 3000, 0);
  playback.seek(1);
  const hud = playback.getHudState(origin);
  assert.equal(hud.splash, 0, 'future bursts are not counted yet');
  assert.equal(hud.remaining, 6);
  assert.equal(hud.nextMissileType.id, 'AIM9X');
  assert.equal(hud.selectedTarget.callsign, 'BANDIT 1');
  assert.equal(hud.missilesInFlight, 1);
  assert.equal(playback.state.targets.length, 2);
  assert.ok(Math.abs(playback.state.targets[0].position.x - 1001) < 0.2);
  assert.equal(playback.state.missiles.length, 1);
  assert.equal(playback.state.rails, 0x3f);
  assert.equal(explosions, 0, 'seeking past a detonation does not stage it');
  const inFlight = playback.state.missiles[0];
  assert.ok(inFlight.velocity.x > 50 && inFlight.velocity.z < 0, 'sample deltas restore missile velocity');
  assert.ok(inFlight.age >= 0.9, 'replay missiles expose their flight age to the director');

  playback.update(0.1, 5.1);
  assert.equal(playback.getHudState(origin).splash, 1);
  assert.equal(explosions, 1, 'crossing the detonation stages one explosion');
  assert.equal(sounds.length, 1, 'crossing the detonation plays one burst');
  const burstDistance = Math.hypot(300, 1200);
  assert.ok(Math.abs(sounds[0].distance - burstDistance) < 1e-3, 'the burst is mixed from the camera distance');
  assert.equal(sounds[0].isWater, false);
  assert.equal(playback.state.missiles.length, 0, 'the detonated missile leaves the scene');
  assert.equal(playback.missiles.get(7).alive, false, 'the held missile reference reports the detonation');
  playback.update(0.1, 5.2);
  assert.equal(explosions, 1, 'the same detonation is not staged twice');
  assert.equal(sounds.length, 1, 'the same detonation is not heard twice');

  playback.seek(0.5);
  assert.equal(playback.getHudState(origin).splash, 0, 'seeking back rewinds the burst count');
  assert.equal(playback.state.missiles.length, 1, 'seeking back restores the in-flight missile');
  assert.equal(playback.missiles.get(7).alive, true, 'seeking back revives the reused missile object');
  assert.equal(explosions, 1, 'seeking back does not replay past explosions');
  assert.equal(sounds.length, 1, 'seeking back does not replay past bursts');
  playback.stop();
  assert.equal(playback.state.targets.length, 0);
  assert.equal(playback.state.missiles.length, 0);
});

test('replayed bandits slide between 2 Hz samples instead of hopping at the midpoint', () => {
  const combat = decodeTrack(encodeTrack(recordCombat(5).finish())).combat;
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  assert.equal(playback.load(combat), true);
  const [a, b] = [combat.banditSamples[1], combat.banditSamples[2]];
  const span = b.timeSec - a.timeSec;
  assert.ok(span > 0, 'consecutive bandit samples advance in time');

  const positionAt = alpha => {
    playback.seek(a.timeSec + span * alpha);
    const { x, y, z } = playback.state.targets[0].position;
    return { x, y, z };
  };
  const expected = alpha => {
    const from = a.targets[0];
    const to = b.targets[0];
    return {
      x: from.x + (to.x - from.x) * alpha,
      y: from.y + (to.y - from.y) * alpha,
      z: from.z + (to.z - from.z) * alpha,
    };
  };
  for (const alpha of [0.25, 0.5, 0.75]) {
    const actual = positionAt(alpha);
    const want = expected(alpha);
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(actual[axis] - want[axis]) < 1e-3,
        `bandit ${axis} at alpha ${alpha} is ${actual[axis]}, expected ${want[axis]}`);
    }
  }
  playback.stop();
});

test('a bandit death between samples still snaps instead of sliding a wreck', () => {
  const combat = decodeTrack(encodeTrack(recordCombat(5).finish())).combat;
  const samples = combat.banditSamples;
  for (const sample of samples.slice(2)) sample.targets[0].alive = false;
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  assert.equal(playback.load(combat), true);
  const a = samples[1];
  const b = samples[2];
  playback.seek(a.timeSec + (b.timeSec - a.timeSec) * 0.25);
  assert.equal(playback.state.targets[0].position.x, a.targets[0].x);
  playback.seek(a.timeSec + (b.timeSec - a.timeSec) * 0.75);
  assert.equal(playback.state.targets[0].position.x, b.targets[0].x);
  assert.equal(playback.state.targets[0].alive, false);
  playback.stop();
});

test('combat playback interpolates recorded bandit bank instead of leveling the wings', () => {
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  const halfBank = Math.PI / 6;
  const combat = { targets: [{ callsign: 'BANKED' }], missiles: [], missileSamples: [], events: [],
    banditSamples: [0, 0.5].map((timeSec, index) => ({ timeSec, targets: [{
      x: index * 50, y: 3000, z: 0, headingRad: 0, alive: true,
      quaternion: [0, 0, Math.sin(index * halfBank), Math.cos(index * halfBank)],
    }] })) };
  playback.load(combat);
  playback.seek(0.25);
  const q = playback.state.targets[0].quaternion;
  assert.ok(Math.abs(q.z - Math.sin(halfBank / 2)) < 1e-6);
  assert.ok(Math.abs(q.w - Math.cos(halfBank / 2)) < 1e-6);
  const mesh = playback.view.targetViews.get(0).mesh;
  assert.ok(mesh.quaternion.equals(q));
  playback.stop();
});

test('recorded kill events count actual kills independently of explosions and seek', () => {
  const recorder = recordCombat(5);
  recorder.recordCombatEvent({ type: 'detonation', missile: { id: 7 }, position: { x: 0, y: 0, z: 0 } });
  recorder.update(1, TELEMETRY, QUAT, combatAt(6));
  recorder.recordCombatEvent({ type: 'detonation', missile: { id: 8 }, position: { x: 1, y: 0, z: 0 } });
  recorder.recordCombatEvent({ type: 'kill', missile: { id: 8 }, position: { x: 1, y: 0, z: 0 } });
  recorder.recordCombatEvent({ type: 'kill', missile: { id: 8 }, position: { x: 2, y: 0, z: 0 } });
  recorder.update(1, TELEMETRY, QUAT, combatAt(7));
  recorder.recordCombatEvent({ type: 'kill', position: { x: 3, y: 0, z: 0 } });
  const track = decodeTrack(encodeTrack(recorder.finish()));
  assert.equal(track.combat.killEventsRecorded, true);
  assert.deepEqual(track.combat.events.map(e => e.kind), ['detonation', 'detonation', 'kill', 'kill', 'kill']);
  const playback = new CombatReplayPlayback({ scene: new Scene() }); playback.load(track.combat);
  const origin = new Vector3();
  playback.seek(5.5); assert.equal(playback.getHudState(origin).splash, 0, 'surviving burst');
  playback.seek(6.5); assert.equal(playback.getHudState(origin).splash, 2, 'two kills from one burst');
  playback.seek(7.1); assert.equal(playback.getHudState(origin).splash, 3, 'gun kill counts');
  playback.seek(5.5); assert.equal(playback.getHudState(origin).splash, 0, 'rewind restores count');
});

test('legacy combat tracks preserve the historic detonation count across re-encoding', () => {
  const recorder = recordCombat(5);
  recorder.recordCombatEvent({ type: 'detonation', position: { x: 0, y: 0, z: 0 } });
  const track = recorder.finish(); track.combat.killEventsRecorded = false;
  const decoded = decodeTrack(encodeTrack(track));
  assert.equal(decoded.version, 5); assert.equal(decoded.combat.killEventsRecorded, false);
  const restored = decodeTrack(encodeTrack(decoded));
  assert.equal(restored.version, 5);
  const playback = new CombatReplayPlayback({ scene: new Scene() }); playback.load(restored.combat);
  playback.seek(6); assert.equal(playback.getHudState(new Vector3()).splash, 1);
});

test('localized damage survives recording, codec, playback, seek, rewind and respawn', () => {
  const recorder = new ReplayRecorder();
  recorder.start(METADATA);
  const system = combatAt(0);
  const target = system.targets[1]; // Live ID 12 belongs to replay slot 1.
  recorder.update(0.1, TELEMETRY, QUAT, system);
  recorder.elapsed = 0.2;
  Object.assign(target, { damage: 0.4, damageZones: { wingL: 0.7, fuselage: 0.1 } });
  recorder.recordCombatEvent({ type: 'damage', target, damage: target.damage,
    hitZone: 'wingL', damageZones: target.damageZones });
  recorder.elapsed = 0.3;
  Object.assign(target, { damage: 0.7, damageZones: { wingL: 0.7, fuselage: 0.1, engine: 0.8 } });
  recorder.recordCombatEvent({ type: 'damage', target, damage: target.damage,
    hitZone: 'engine', damageZones: target.damageZones });
  recorder.update(0.5, TELEMETRY, QUAT, system);
  target.damage = 0;
  target.damageZones = {};
  recorder.update(0.6, TELEMETRY, QUAT, system);
  recorder.update(5, TELEMETRY, QUAT, system);
  const track = decodeTrack(encodeTrack(recorder.finish()));
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  playback.load(track.combat);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1 / 254, `${actual} != ${expected}`);
  playback.seek(0.15);
  assert.equal(playback.targets[1].damage, 0);
  playback.update(0.1, 0.25);
  near(playback.targets[1].damage, 0.4);
  near(playback.targets[1].damageZones.wingL, 0.7);
  assert.equal(playback.targets[0].damage, 0);
  let view = playback.view.targetViews.get(12);
  assert.ok(view.trail.count > 0, 'damaged wing emits smoke');
  assert.equal(view.fireTrail, null);
  playback.update(0.1, 0.35);
  near(playback.targets[1].damageZones.engine, 0.8);
  assert.ok(view.fireTrail.count > 0, 'engine damage emits fire');
  playback.seek(0.9);
  near(playback.targets[1].damageZones.engine, 0.8);
  assert.ok(playback.view.targetViews.get(12).fireTrail.count > 0, 'seek restores fire');
  playback.update(0.1, 0.15);
  assert.equal(playback.targets[1].damage, 0, 'rewind clears future damage');
  assert.equal(playback.view.targetViews.get(12).trail, null);
  playback.seek(1.4);
  assert.equal(playback.targets[1].damage, 0, 'respawn clears total damage');
  assert.ok(Object.values(playback.targets[1].damageZones).every(value => value === 0));
  playback.stop();
});

test('damage at a pose timestamp and the final snapshot restore without a one-sample delay', () => {
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  const pose = { x: 0, y: 3000, z: 0, headingRad: 0, alive: true, damage: 0, damageZones: {} };
  playback.load({ version: 8, targets: [{ callsign: 'BANDIT' }], missileSamples: [],
    banditSamples: [{ timeSec: 0, targets: [pose] },
      { timeSec: 1, targets: [{ ...pose, damage: 0.8, damageZones: { engine: 0.9 } }] }],
    events: [{ timeSec: 0, kind: 'damage', targetId: 0, damage: 0.3, damageZones: { wingR: 0.6 } }] });
  playback.seek(0);
  assert.equal(playback.targets[0].damageZones.wingR, 0.6);
  playback.seek(1);
  assert.equal(playback.targets[0].damage, 0.8);
  assert.equal(playback.targets[0].damageZones.engine, 0.9);
  playback.stop();
});

test('a respawn switches damage with its pose across a thinned sampling interval', () => {
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  const pose = { x: 0, y: 3000, z: 0, headingRad: 0, alive: false, damage: 1, damageZones: { engine: 1 } };
  playback.load({ version: 8, targets: [{ id: 12, callsign: 'BANDIT' }], missileSamples: [],
    banditSamples: [{ timeSec: 10, targets: [pose] },
      { timeSec: 12, targets: [{ ...pose, x: 500, alive: true, damage: 0, damageZones: {} }] }],
    events: [{ timeSec: 10.2, kind: 'kill', targetId: 12, damage: 1, damageZones: { engine: 1 } }] });
  playback.seek(10.9);
  assert.equal(playback.targets[0].alive, false);
  assert.equal(playback.targets[0].damage, 1);
  playback.update(0.2, 11.1);
  assert.equal(playback.targets[0].alive, true);
  assert.equal(playback.targets[0].position.x, 500);
  assert.equal(playback.targets[0].damage, 0);
  assert.equal(playback.targets[0].damageState, 'normal');
  assert.ok(Object.values(playback.targets[0].damageZones).every(value => value === 0));
  assert.equal(playback.view.targetViews.get(12).fireTrail, null);
  playback.seek(11.1);
  assert.equal(playback.targets[0].damage, 0, 'seek matches forward playback');
  assert.equal(playback.view.targetViews.get(12).trail, null);
  playback.seek(10.9);
  assert.equal(playback.targets[0].damage, 1, 'rewind recovers wreck damage');
  playback.stop();
});

test('launch, damage and kill preserve one live target identity across encoding', () => {
  const recorder = recordCombat(5);
  const target = { ...combatAt(5).targets[1], damage: 0.7, damageZones: { engine: 0.8 } };
  const missile = { id: 7, launchTargetId: 12 };
  recorder.recordCombatEvent({ type: 'launch', missile });
  recorder.recordCombatEvent({ type: 'damage', missile, target, damage: 0.7, damageZones: target.damageZones });
  recorder.recordCombatEvent({ type: 'kill', missile, target });
  const combat = decodeTrack(encodeTrack(recorder.finish())).combat;
  assert.equal(combat.targets[1].id, 12);
  for (const kind of ['launch', 'damage', 'kill']) {
    assert.equal(combat.events.find(event => event.kind === kind).targetId, 12, kind);
  }
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  playback.load(combat);
  assert.equal(playback.targets[1].id, 12);
  playback.stop();
});


test('in-memory and encoded damage playback share byte IDs after repeated sorties', () => {
  const recorder = new ReplayRecorder();
  recorder.start(METADATA);
  const system = combatAt(0);
  system.targets[1].id = 268; // The live counter persists across sortie resets.
  for (let tick = 0; tick < 600; tick++) recorder.update(TICK, TELEMETRY, QUAT, system);
  const target = system.targets[1];
  const missile = { id: 7, launchTargetId: 268 };
  recorder.recordCombatEvent({ type: 'launch', missile });
  recorder.recordCombatEvent({ type: 'damage', missile, target, damage: 0.7, damageZones: { engine: 0.8 } });
  const track = recorder.finish();
  for (const combat of [track.combat, decodeTrack(encodeTrack(track)).combat]) {
    assert.equal(combat.events.find(event => event.kind === 'launch').targetId, 12);
    const playback = new CombatReplayPlayback({ scene: new Scene() });
    playback.load(combat);
    playback.seek(recorder.elapsed);
    assert.equal(playback.targets[1].id, 12);
    assert.ok(Math.abs(playback.targets[1].damage - 0.7) < 1 / 254);
    assert.ok(Math.abs(playback.targets[1].damageZones.engine - 0.8) < 1 / 254);
    assert.ok(playback.view.targetViews.get(12).fireTrail.count > 0);
    assert.equal(playback.targets[0].damage, 0);
    playback.stop();
  }
});

test('CombatReplayPlayback tags missiles as lethal based on kill events', () => {
  const playback = new CombatReplayPlayback({ scene: new Scene() });
  playback.load({
    version: 8,
    targets: [{ id: 1, callsign: 'BANDIT' }],
    missileSamples: [
      { id: 10, typeId: 'AIM9X', timeSec: 1.0, x: 0, y: 1000, z: -500, quat: [0, 0, 0, 1], powered: true },
      { id: 20, typeId: 'AIM9X', timeSec: 1.5, x: 0, y: 1000, z: -400, quat: [0, 0, 0, 1], powered: true },
    ],
    events: [
      { timeSec: 2.0, kind: 'expire', missileId: 10 },
      { timeSec: 2.5, kind: 'kill', missileId: 20, targetId: 1 },
    ],
  });
  playback.seek(1.6);
  const m10 = playback.state.missiles.find(m => m.id === 10);
  const m20 = playback.state.missiles.find(m => m.id === 20);
  assert.equal(m10?.lethal, false, 'Expired missile 10 is not lethal');
  assert.equal(m20?.lethal, true, 'Missile 20 scoring a kill is marked lethal');
  playback.stop();
});

test('MissileCombatView preserves detached wreck reference across multiple sync frames after respawn', () => {
  const scene = new Scene();
  const combatView = new MissileCombatView(scene, { targets: [], missiles: [] }, { terrainHeight: () => 0 });
  const target = {
    id: 33,
    callsign: 'BANDIT 1',
    alive: true,
    position: new Vector3(0, 1500, -2000),
    velocity: new Vector3(0, 0, -200),
    damage: 0,
  };
  combatView.system.targets = [target];

  // 1. Initial frames alive with motion to establish velocity
  combatView.sync(0.016);
  target.position.z -= 10;
  combatView.sync(0.016);
  const view = combatView.targetViews.get(33);
  assert.ok(view);

  // 2. Kill target -> creates wreck
  target.alive = false;
  combatView.sync(0.016);
  assert.ok(view.wreck, 'Wreck active after kill');

  // 3. Respawn target -> detaches wreck and creates fresh airframe
  target.alive = true;
  target.position.set(500, 2000, 1000);
  combatView.sync(0.016);
  assert.ok(view.detachedWreck, 'Wreck detached on respawn frame');
  const detachedWreckObj = view.detachedWreck;

  // 4. Multiple subsequent frames while target is alive: detachedWreck reference must persist
  for (let frame = 0; frame < 10; frame++) {
    combatView.sync(0.016);
    assert.equal(view.detachedWreck, detachedWreckObj, `detachedWreck must survive frame ${frame + 1}`);
  }

  // 5. Cleanup disposes detached aircraft resources
  let disposed = false;
  detachedWreckObj.aircraft.dispose = () => { disposed = true; };
  combatView.clear();
  assert.equal(disposed, true, 'Detached aircraft view was disposed on clear');
});

test('MissileSmokeTrail interpolates dense points along flight path without gaps even with large dt', () => {
  const scene = new Scene();
  const trail = new MissileSmokeTrail(scene, { spacing: 1.6, max: 2000 });

  // Missile moves 64 meters in a single frame (e.g. 800 m/s * 0.08s)
  const pos1 = new Vector3(0, 1000, 0);
  trail.update(0.016, pos1, true, true);
  assert.equal(trail.count, 1, 'Initial point emitted');

  const pos2 = new Vector3(64, 1000, 0);
  trail.update(0.08, pos2, true, true);

  // 64 meters / 1.6m spacing = 40 steps -> 1 + 40 = 41 points
  assert.ok(trail.count >= 40, `Trail count ${trail.count} should be densely interpolated without gaps`);

  // Verify distance between consecutive particles does not exceed spacing + jitter tolerance
  for (let i = 0; i < trail.count - 1; i++) {
    const x1 = trail.positions[i * 3];
    const y1 = trail.positions[i * 3 + 1];
    const z1 = trail.positions[i * 3 + 2];
    const x2 = trail.positions[(i + 1) * 3];
    const y2 = trail.positions[(i + 1) * 3 + 1];
    const z2 = trail.positions[(i + 1) * 3 + 2];
    const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    assert.ok(d < 3.0, `Consecutive puff distance ${d.toFixed(2)}m must not leave gaps`);
  }

  trail.dispose();
});

test('MissileSmokeTrail lingers for 20+ seconds after missile burnout and detonation', () => {
  const scene = new Scene();
  const trail = new MissileSmokeTrail(scene, { lifetime: 26.0, spacing: 2.0 });

  const pos1 = new Vector3(0, 1000, 0);
  const pos2 = new Vector3(100, 1000, 0);
  trail.update(0.016, pos1, true, true);
  trail.update(0.1, pos2, true, true);
  const initialCount = trail.count;
  assert.ok(initialCount > 10);

  // Coasting with propellant=0: continues emitting visible trail
  const pos3 = new Vector3(200, 1000, 0);
  trail.update(0.1, pos3, true, false);
  assert.ok(trail.count > initialCount, 'Coasting missile continues to emit visible trajectory trail');

  // Missile detonated / stopped emitting: smoke must persist, not vanish in 2-3 seconds
  for (let s = 0; s < 15; s++) {
    trail.update(1.0, null, false);
    assert.equal(trail.done, false, `Trail must not be done at ${s + 1}s`);
    assert.ok(trail.count > 0, `Puffs must still exist at ${s + 1}s`);
  }

  // After 28 seconds (exceeding 26s lifetime), particles have aged out
  for (let s = 0; s < 15; s++) {
    trail.update(1.0, null, false);
  }
  assert.equal(trail.done, true, 'Trail should be done after full 26s lifetime expires');
  trail.dispose();
});

test('CombatReplayPlayback seek reconstructs lingering and active missile smoke trails', () => {
  const scene = new Scene();
  const playback = new CombatReplayPlayback({ scene });
  const missileSamples = [
    { timeSec: 10.0, id: 5, typeId: 'AIM9X', x: 0, y: 3000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 10.5, id: 5, typeId: 'AIM9X', x: 300, y: 3000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 11.0, id: 5, typeId: 'AIM9X', x: 600, y: 3000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 11.5, id: 5, typeId: 'AIM9X', x: 900, y: 3000, z: 0, quat: [0, 0, 0, 1], powered: false },
    { timeSec: 12.0, id: 5, typeId: 'AIM9X', x: 1200, y: 3000, z: 0, quat: [0, 0, 0, 1], powered: false },
  ];
  const events = [
    { timeSec: 12.0, kind: 'detonation', missileId: 5, x: 1200, y: 3000, z: 0 },
  ];

  playback.load({
    version: 8,
    targets: [],
    missileSamples,
    banditSamples: [],
    events,
  });

  // 1. Seek to mid-flight (11.0s): missile is active, trajectory smoke should be pre-populated
  playback.seek(11.0);
  assert.equal(playback.state.missiles.length, 1);
  const view = playback.view.missileViews.get(5);
  assert.ok(view?.trail, 'Active missile has smoke trail');
  assert.ok(view.trail.count > 50, `Smoke trail should be pre-populated along flight path (count: ${view.trail.count})`);

  // 2. Seek to 14.0s (2s after detonation): missile is dead, lingering smoke trail reconstructed
  playback.seek(14.0);
  assert.equal(playback.state.missiles.length, 0, 'Detonated missile mesh is gone');
  assert.ok(playback.view.trails.length > 0, 'Lingering smoke trail remains in scene after detonation');
  assert.ok(playback.view.trails[0].count > 50, 'Lingering trail contains dense trajectory puffs');

  playback.stop();
});

test('CombatReplayPlayback uses Catmull-Rom spline for smooth missile position between samples', () => {
  const scene = new Scene();
  const playback = new CombatReplayPlayback({ scene });
  // Turning missile trajectory (curves in X and Z)
  const missileSamples = [
    { timeSec: 0.0, id: 1, typeId: 'AIM9X', x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.1, id: 1, typeId: 'AIM9X', x: 70, y: 1000, z: 10, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.2, id: 1, typeId: 'AIM9X', x: 130, y: 1000, z: 35, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.3, id: 1, typeId: 'AIM9X', x: 180, y: 1000, z: 75, quat: [0, 0, 0, 1], powered: true },
  ];

  playback.load({
    version: 8,
    targets: [],
    missileSamples,
    banditSamples: [],
    events: [],
  });

  // Evaluate midpoint between samples 1 and 2 (timeSec = 0.15)
  playback.seek(0.15);
  const m = playback.state.missiles[0];
  assert.ok(m);

  // Linear midpoint would be: x = (70 + 130) / 2 = 100, z = (10 + 35) / 2 = 22.5
  // Catmull-Rom spline accounts for incoming curvature, smoothly interpolating position
  assert.ok(Math.abs(m.position.y - 1000) < 1e-4);
  assert.ok(m.position.x > 70 && m.position.x < 130);
  assert.ok(m.position.z > 10 && m.position.z < 35);

  playback.stop();
});

test('SmokeTrail and MissileSmokeTrail interpolation does not mutate caller position vector', () => {
  const scene = new Scene();
  const trail = new MissileSmokeTrail(scene, { spacing: 1.6 });
  const emitVector = new Vector3(0, 100, 0);

  trail.update(0.016, emitVector, true);
  emitVector.set(10, 100, 0);

  // If internal scratch vector mutates emitVector, emitVector.x will be corrupted
  trail.update(0.016, emitVector, true);
  assert.equal(emitVector.x, 10, 'Caller position vector must remain untouched by interpolation');
  assert.equal(emitVector.y, 100);
  assert.equal(emitVector.z, 0);

  assert.equal(trail.lastPosition.x, 10, 'lastPosition must accurately store target destination');
  trail.dispose();
});

test('CombatReplayPlayback monotonic spline prevents oscillation on repeated identical positions', () => {
  const scene = new Scene();
  const playback = new CombatReplayPlayback({ scene });
  const missileSamples = [
    { timeSec: 0.0, id: 1, typeId: 'AIM9X', x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.1, id: 1, typeId: 'AIM9X', x: 60, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.2, id: 1, typeId: 'AIM9X', x: 60, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.3, id: 1, typeId: 'AIM9X', x: 120, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
  ];

  playback.load({ version: 8, targets: [], missileSamples, banditSamples: [], events: [] });

  // In the span [0.1, 0.2], missile should stay exactly at x=60 without wiggling
  for (let t = 0.10; t <= 0.20; t += 0.02) {
    playback.seek(t);
    const m = playback.state.missiles[0];
    assert.ok(Math.abs(m.position.x - 60) < 1e-4, `At t=${t.toFixed(2)}, x must stay at 60 (got ${m.position.x})`);
  }

  playback.stop();
});

test('CombatReplayPlayback bounds missile extrapolation when termination event is absent', () => {
  const scene = new Scene();
  const playback = new CombatReplayPlayback({ scene });
  const missileSamples = [
    { timeSec: 0.0, id: 1, typeId: 'AIM9X', x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 0.1, id: 1, typeId: 'AIM9X', x: 60, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
  ];

  // No detonation or expire event recorded (removeAt = Infinity)
  playback.load({ version: 8, targets: [], missileSamples, banditSamples: [], events: [] });

  playback.seek(10.0); // 9.9 seconds past the last sample
  const m = playback.state.missiles[0];
  assert.ok(m);

  // Velocity is (60 - 0) / 0.1 = 600 m/s in X.
  // Without bounding, it would have moved to x = 60 + 600 * 9.9 = 6000m!
  // With 0.1s cap, it stops at x = 60 + 600 * 0.1 = 120m.
  assert.ok(m.position.x <= 130, `Unterminated missile must not extrapolate indefinitely (got x=${m.position.x})`);

  playback.stop();
});

test('MissileSmokeTrail preserves full trajectory over long flight without premature buffer eviction', () => {
  const scene = new Scene();
  const trail = new MissileSmokeTrail(scene); // default max=7200, spacing=3.0, lifetime=26.0

  // Simulate missile flying 15 km at 600 m/s for 25 seconds
  const pos = new Vector3(0, 2000, 0);
  trail.update(0.016, pos, true, true);
  const launchPos = { x: trail.positions[0], y: trail.positions[1], z: trail.positions[2] };

  const dt = 0.1; // 100ms steps
  const speed = 600; // 600 m/s
  for (let t = 0; t < 25.0; t += dt) {
    pos.x += speed * dt;
    trail.update(dt, pos, true, t < 4.5); // powered for first 4.5s
  }

  // The launch position particle (at x=0) should still be in the buffer after 25s (< 26s lifetime)
  assert.ok(trail.count > 4500, `Buffer should hold dense trail points (got ${trail.count})`);
  const oldestX = trail.positions[0];
  assert.ok(
    Math.abs(oldestX - launchPos.x) < 5.0,
    `Launch position particle (x=0) must not be prematurely evicted after 25s (got x=${oldestX})`
  );

  trail.dispose();
});

test('prepopulateFromSamples respects powered vs unpowered particle lifetime matching normal update playback', () => {
  const scene = new Scene();
  const trailSeek = new MissileSmokeTrail(scene); // lifetime = 26.0

  // Boost phase at t = 0.0s (powered: true, lifetime = 26.0s)
  // Coast phase at t = 5.0s (powered: false, lifetime = 26.0 * 0.85 = 22.1s)
  const samples = [
    { timeSec: 0.0, x: 0, y: 1000, z: 0, powered: true },
    { timeSec: 1.0, x: 600, y: 1000, z: 0, powered: true },
    { timeSec: 5.0, x: 3000, y: 1000, z: 0, powered: false },
    { timeSec: 6.0, x: 3600, y: 1000, z: 0, powered: false },
  ];

  // At currentTime = 27.5s:
  // - Boost samples (t=0..1s) are aged 26.5..27.5s -> expired (> 26.0s)
  // - Coast samples (t=5..6s) are aged 21.5..22.5s:
  //   Coast sample at t=5.0s is aged 22.5s -> expired for unpowered (> 22.1s)
  //   Coast sample at t=6.0s is aged 21.5s -> still alive for unpowered (< 22.1s)
  trailSeek.prepopulateFromSamples(samples, 27.5);

  // Boost smoke at x=0..600 should not exist
  for (let i = 0; i < trailSeek.count; i++) {
    const x = trailSeek.positions[i * 3];
    assert.ok(x >= 3000, `Expired boost smoke (x < 3000) must not appear (found x=${x})`);
  }

  // At currentTime = 28.5s:
  // - Coast sample at t=6.0s is aged 22.5s -> also expired (> 22.1s)
  const trailSeekExpired = new MissileSmokeTrail(scene);
  trailSeekExpired.prepopulateFromSamples(samples, 28.5);
  assert.equal(trailSeekExpired.count, 0, 'All particles should be expired after 28.5s');

  trailSeek.dispose();
  trailSeekExpired.dispose();
});

test('MissileSmokeTrail alpha decay is consistent between update and prepopulateFromSamples', () => {
  const scene = new Scene();
  const trailNormal = new MissileSmokeTrail(scene, { lifetime: 26.0 });
  const pos = new Vector3(0, 1000, 0);

  // Emit 1 powered point at t=0
  trailNormal.update(0.016, pos, true, true);
  // Age by 15.0s in 1.0s increments
  for (let i = 0; i < 15; i++) {
    trailNormal.update(1.0, null, false);
  }
  const normalAlpha = trailNormal.colors[3]; // alpha of 1st point

  // Expected: 0.92 * (1.0 - (15.016 / 26)^2) = ~0.613
  const expectedAlpha = 0.92 * (1.0 - (15.016 / 26.0) ** 2);
  assert.ok(
    Math.abs(normalAlpha - expectedAlpha) < 0.05,
    `Normal alpha ${normalAlpha} should match continuous decay around ${expectedAlpha.toFixed(3)}`
  );

  // Reconstructed via prepopulateFromSamples at t=15.016 with sample at t=0
  const trailSeek = new MissileSmokeTrail(scene, { lifetime: 26.0 });
  trailSeek.prepopulateFromSamples([{ timeSec: 0.0, x: 0, y: 1000, z: 0, powered: true }], 15.016);
  const seekAlpha = trailSeek.colors[3];

  assert.ok(
    Math.abs(normalAlpha - seekAlpha) < 0.02,
    `Seek alpha (${seekAlpha.toFixed(3)}) should match normal update alpha (${normalAlpha.toFixed(3)}) without arbitrary threshold drop`
  );

  trailNormal.dispose();
  trailSeek.dispose();
});

test('CombatReplayPlayback seek does not duplicate smoke trails for active missiles without termination event', () => {
  const scene = new Scene();
  const playback = new CombatReplayPlayback({ scene });
  const missileSamples = [
    { timeSec: 0.0, id: 1, typeId: 'AIM9X', x: 0, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
    { timeSec: 1.0, id: 1, typeId: 'AIM9X', x: 600, y: 1000, z: 0, quat: [0, 0, 0, 1], powered: true },
  ];

  // No termination event (removeAt = Infinity)
  playback.load({ version: 8, targets: [], missileSamples, banditSamples: [], events: [] });

  // Seek to 5.0s (past the last sample, but missile is still active in track)
  playback.seek(5.0);

  // Active missile should have exactly 1 trail associated with its missileView
  assert.equal(playback.view.trails.length, 1, 'Exactly one smoke trail should exist');
  const view = playback.view.missileViews.get(1);
  assert.ok(view?.trail, 'Active missile has its smoke trail');
  assert.equal(playback.view.trails[0], view.trail, 'Scene trail should be the active missile view trail');

  playback.stop();
});

test('prepopulateFromSamples interpolates active span when seeking between thinned samples', () => {
  const scene = new Scene();
  const trail = new MissileSmokeTrail(scene, { spacing: 3.0 });

  // Missile flying 600 m/s with wide samples at 0.0s and 1.6s (thinned interval)
  const samples = [
    { timeSec: 0.0, x: 0, y: 1000, z: 0, powered: true },
    { timeSec: 1.6, x: 960, y: 1000, z: 0, powered: true },
  ];

  // Seek to 0.9s (midway between 0.0s and 1.6s, where missile is at x = 540m)
  trail.prepopulateFromSamples(samples, 0.9);

  // Puffs should cover the entire 0 to 540m span
  assert.ok(trail.count > 100, `Trail count ${trail.count} should densely populate 540m segment`);
  const firstX = trail.positions[0];
  const lastX = trail.positions[(trail.count - 1) * 3];

  assert.ok(Math.abs(firstX - 0) < 5.0, `Start of trail should be at x=0 (got ${firstX})`);
  assert.ok(Math.abs(lastX - 540) < 5.0, `End of trail should be at missile position x=540 (got ${lastX})`);
  assert.ok(Math.abs(trail.lastPosition.x - 540) < 5.0, `lastPosition should match missile position x=540`);

  trail.dispose();
});
