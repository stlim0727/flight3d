import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { encodeTrack, decodeTrack, COMBAT_TRACK_VERSION } from '../src/replay/ReplayCodec.js';
import { CombatReplayPlayback } from '../src/replay/CombatReplayPlayback.js';
import { MissileCombatView } from '../src/weapons/MissileCombatView.js';
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
