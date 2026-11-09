import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhostPilot } from '../src/multiplayer/GhostPilot.js';
import { validSnapshot } from '../src/multiplayer/protocol.js';

test('GPU-free AI flies a stable orbit for ten minutes, then resets cleanly', () => {
  const pilot = new GhostPilot();
  const initial = pilot.snapshot().p;
  for (let i = 0; i < 6000; i++) {
    pilot.advance(.1);
    if (i % 100 !== 0) continue;
    const snapshot = pilot.snapshot();
    assert.equal(validSnapshot({ ...snapshot, round: 1, seq: i, epoch: 0 }), true);
    assert.ok(Math.abs(snapshot.p[1] - initial[1]) < 35, 'altitude held');
    assert.ok(pilot.sim.telemetry.iasKnots > 170 && pilot.sim.telemetry.iasKnots < 240);
    assert.equal(pilot.sim.isCrashed, false);
    assert.equal(pilot.sim.telemetry.isStalled, false);
    assert.ok(Math.abs(Math.hypot(snapshot.p[0] - pilot.center.x, snapshot.p[2] - pilot.center.z) - pilot.radius) < 500);
  }
  assert.ok(Math.hypot(pilot.snapshot().p[0] - initial[0], pilot.snapshot().p[2] - initial[2]) > 1000);
  pilot.reset();
  assert.deepEqual(pilot.snapshot().p, initial);
  const before = pilot.sim.totalSimTime;
  pilot.advance(60);
  assert.ok(pilot.sim.totalSimTime - before < .26, 'suspension does not cause catch-up burst');
  assert.throws(() => pilot.advance(NaN));
});

test('GhostPilot slot 1 spawns with guest offset and supports talking snapshot', () => {
  const lead = new GhostPilot();
  const wing = new GhostPilot(undefined, 1);
  const p0 = lead.snapshot().p;
  const p1 = wing.snapshot().p;
  assert.ok(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 50, 'slot 1 is offset from lead position');
  assert.equal(wing.snapshot(true).talking, true);
  assert.equal(wing.snapshot(false).talking, false);
  for (let i = 0; i < 300; i++) {
    lead.advance(0.1);
    wing.advance(0.1);
  }
  const s0 = lead.snapshot();
  const s1 = wing.snapshot();
  assert.equal(s0.crashed, false);
  assert.equal(s1.crashed, false);
  assert.ok(Math.abs(s0.p[1] - s1.p[1]) < 35, 'wing holds altitude alongside lead');
});
