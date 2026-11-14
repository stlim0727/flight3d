import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { infraredSignalQuality, sampleEngineInfrared } from '../src/weapons/InfraredSignal.js';
import { BanditTarget } from '../src/weapons/AirToAirMissileSystem.js';
import { runInfraredScenario } from '../scripts/lib/infraredScenario.mjs';

const emitter = () => ({ position: new Vector3(), quaternion: new Quaternion(),
  infraredSignature: { enginePower: 1, heat: 1, afterburner: 0, omnidirectional: false } });
const observer = (x, z) => ({ position: new Vector3(x, 0, z) });

test('range spreading follows inverse-square received signal while bounded quality decreases', () => {
  const t = emitter(), a = {}, b = {};
  const near = infraredSignalQuality(observer(0, 4000), t, 4000, a);
  const far = infraredSignalQuality(observer(0, 8000), t, 8000, b);
  assert.ok(Math.abs(a.received / b.received - 4) < 1e-12);
  assert.ok(near > far && far > 0 && near < 1);
});

test('target -Z forward makes rear brighter than side and front, smoothly across aspect', () => {
  const t = emitter();
  const rear = infraredSignalQuality(observer(0, 6000), t, 6000);
  const side = infraredSignalQuality(observer(6000, 0), t, 6000);
  const front = infraredSignalQuality(observer(0, -6000), t, 6000);
  assert.ok(rear > side && side > front);
  const epsilon = 1e-5;
  assert.ok(Math.abs(infraredSignalQuality(observer(6000, epsilon), t, 6000)
    - infraredSignalQuality(observer(6000, -epsilon), t, 6000)) < 1e-8);
});

test('power, thermal state and explicit afterburner have continuous monotonic effects', () => {
  const t = emitter(), o = observer(0, 4000), s = t.infraredSignature;
  for (const field of ['enginePower', 'heat', 'afterburner']) {
    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      s[field] = i / 20;
      const q = infraredSignalQuality(o, t, 4000);
      assert.ok(q >= previous && Number.isFinite(q)); previous = q;
    }
    s[field] = field === 'afterburner' ? 0 : 1;
  }
  s.enginePower = 0; s.heat = 0;
  assert.ok(infraredSignalQuality(o, t, 4000) > 0, 'airframe floor is not perfect invisibility');
});

test('missing/malformed signatures fail closed and diagnostics cannot retain a stale valid sample', () => {
  const t = emitter(), o = observer(0, 4000), diagnostic = {};
  infraredSignalQuality(o, t, 4000, diagnostic);
  t.infraredSignature.heat = NaN;
  assert.equal(infraredSignalQuality(o, t, 4000, diagnostic), 0);
  assert.equal(diagnostic.quality, 0);
  delete t.infraredSignature;
  assert.equal(infraredSignalQuality(o, t, 4000), 0);
});

test('IR signal changes use existing memory/reacquisition without altering the radar channel', () => {
  const report = runInfraredScenario();
  assert.deepEqual(report.snapshots.map(s => s.ir), ['track', 'memory', 'lost', 'lost', 'acquire', 'track']);
  assert.ok(report.snapshots.every(s => s.radar === 'track'));
  assert.ok(report.snapshots[0].quality > 0.25);
  assert.ok(report.snapshots[3].quality < 0.25);
  assert.ok(report.snapshots[5].quality > 0.25);
});

test('live bandit signatures follow spool/EGT state, cool after failure and reset on respawn', () => {
  const orbit = { center: new Vector3(), radius: 1500, angle: 0, altitudeM: 3000, omega: 180 / 1500 };
  const t = new BanditTarget({ callsign: 'IR', position: new Vector3(1500, 3000, 0), orbit });
  const engine = t.flight.engines, before = {};
  sampleEngineInfrared(engine, 0, before);
  engine.setThrottle(1); const afterCommand = {}; sampleEngineInfrared(engine, 0, afterCommand);
  assert.deepEqual(afterCommand, before, 'lever movement alone cannot instantly change emitted signal');
  for (let i = 0; i < 1200; i++) t.update(1 / 120);
  const warm = { ...t.infraredSignature };
  engine.failed[0] = true; t.update(1 / 120);
  assert.ok(t.infraredSignature.heat > 0 && t.infraredSignature.enginePower > 0);
  for (let i = 0; i < 1200; i++) t.update(1 / 120);
  assert.ok(t.infraredSignature.heat < warm.heat * 0.1);
  assert.ok(t.infraredSignature.enginePower < warm.enginePower * 0.1);
  t.infraredAfterburnerLevel = 1;
  t.respawn(new Vector3(1500, 3000, 0), orbit);
  assert.equal(t.infraredAfterburnerLevel, 0);
  assert.equal(t.infraredSignature.afterburner, 0);
  assert.ok(t.infraredSignature.heat > 0);
  assert.equal(t.infraredSignature.omnidirectional, false);
});
