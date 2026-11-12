import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { ReplayCrashEffects, crashEvents, REPLAY_IMPACT_LIFETIME } from '../src/replay/ReplayCrashEffects.js';

function fixture() {
  const root = new Group(), model = new Group(); root.add(model);
  const calls = { spawn: 0, clear: 0, time: 0, explosionTime: 0 };
  const breakup = { spawn() { calls.spawn++; }, clear() { calls.clear++; }, update(dt) { calls.time += dt; } };
  const explosions = { spawnExplosion() {}, clear() {}, update(dt) { calls.explosionTime += dt; } };
  const effects = new ReplayCrashEffects({ aircraft: { group: model }, poseRoot: root, breakup, explosions });
  const event = { timeSec: 2, position: new Vector3(100, 50, 200), quat: [0, 0, 0, 1], velocity: new Vector3(), type: 'unknown' };
  return { root, model, effects, calls, event };
}

test('crash effects follow replay time, freeze while paused and reconstruct on backwards seek', () => {
  const { effects, calls, event } = fixture();
  effects.apply(event, 3);
  assert.ok(Math.abs(calls.time - 1) < 1e-8);
  assert.equal(calls.spawn, 1);
  effects.apply(event, 3);
  assert.ok(Math.abs(calls.time - 1) < 1e-8, 'paused wall time never advances particles');
  effects.apply(event, 5);
  assert.ok(Math.abs(calls.time - 3) < 1e-8, '3x playback advances effects by the same replay delta');
  effects.apply(event, 2.5, { seek: true });
  assert.equal(calls.spawn, 2); assert.equal(calls.clear, 1);
  assert.ok(Math.abs(effects.age - 0.5) < 1e-8);
  assert.ok(Math.abs(calls.explosionTime - calls.time) < 1e-8);
  effects.apply(null, 1);
  assert.equal(effects.event, null);
});

test('remote impact pose is applied to its wrapper once, never twice in world coordinates', () => {
  const { effects, root, model, event } = fixture();
  root.position.set(100, 50, 200);
  effects.apply(event, 2);
  assert.deepEqual(model.position.toArray(), [0, 0, 0]);
  assert.deepEqual(model.getWorldPosition(new Vector3()).toArray(), event.position.toArray());
});

test('gaps, respawns, expired effects and exit clear wreckage without persistent live copies', () => {
  const { effects, event, calls } = fixture();
  effects.apply(event, 3);
  effects.apply(event, 4, { visible: false });
  assert.equal(effects.event, null);
  effects.apply(event, 5);
  assert.equal(calls.spawn, 2);
  effects.apply(event, event.timeSec + REPLAY_IMPACT_LIFETIME);
  assert.equal(effects.event, null);
  effects.apply(event, 3); effects.dispose(); effects.dispose();
  assert.equal(effects.event, null);
});

test('impact events survive repeated crashes and do not derive velocity across a respawn', () => {
  const state = (segment, crashed) => ({ visible: true, held: false, stale: false, segment, crashed });
  const samples = [0, 1, 2, 3].map((timeSec, i) => ({ timeSec, x: i < 2 ? i * 10 : 5000, y: 100, z: 0,
    quat: [0, 0, 0, 1], segment: i < 2 ? 0 : 1 }));
  const timeline = samples.map((s, i) => ({ timeSec: s.timeSec, states: [state(s.segment, i === 1 || i === 2)] }));
  const events = crashEvents({ samples, metadata: { room: { timeline } } }, 0);
  assert.equal(events.length, 2);
  assert.equal(events[0].velocity.x, 10);
  assert.equal(events[1].velocity.length(), 0);
  assert.equal(events[1].position.x, 5000);
});
