import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { ReplayRecorder } from '../src/core/ReplayRecorder.js';
import { encodeTrack, decodeTrack, COMBAT_TRACK_VERSION } from '../src/replay/ReplayCodec.js';
import { CombatReplayPlayback } from '../src/replay/CombatReplayPlayback.js';
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

test('replay playback interpolates combat and stages each detonation once', () => {
  const recorder = recordCombat(5);
  recorder.recordCombatEvent({
    type: 'detonation', missile: { id: 7 },
    position: { x: 300, y: 3000, z: -1200 }, velocity: { x: 600, y: 0, z: 0 },
  });
  const combat = decodeTrack(encodeTrack(recorder.finish())).combat;
  let explosions = 0;
  const sim = { scene: new Scene(), explosionSystem: { spawnExplosion() { explosions++; } } };
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

  playback.update(0.1, 5.1);
  assert.equal(playback.getHudState(origin).splash, 1);
  assert.equal(explosions, 1, 'crossing the detonation stages one explosion');
  assert.equal(playback.state.missiles.length, 0, 'the detonated missile leaves the scene');
  playback.update(0.1, 5.2);
  assert.equal(explosions, 1, 'the same detonation is not staged twice');

  playback.seek(0.5);
  assert.equal(playback.getHudState(origin).splash, 0, 'seeking back rewinds the burst count');
  assert.equal(playback.state.missiles.length, 1, 'seeking back restores the in-flight missile');
  assert.equal(explosions, 1, 'seeking back does not replay past explosions');
  playback.stop();
  assert.equal(playback.state.targets.length, 0);
  assert.equal(playback.state.missiles.length, 0);
});
