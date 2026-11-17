import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Euler, Vector3 } from 'three';
import { FlightControlLaws, applyDeadzone } from '../src/controls/FlightControlLaws.js';
import { FlightWarningsCore } from '../src/systems/FlightWarningsCore.js';
import { AutopilotController, autopilotState } from '../src/physics/Autopilot.js';
import { FlightPhysicsCore } from '../src/physics/FlightPhysicsCore.js';

test('normalized controls hold, release, reverse and produce physics inputs without browser globals', () => {
  const laws = new FlightControlLaws();
  let out;
  for (let i = 0; i < 120; i++) out = laws.update({ pitch: 1, roll: -1, yaw: 1, throttleRate: 1, pitchTrim: -1 }, 1 / 120);
  assert.ok(Math.abs(out.elevator - 0.55) < 1e-12);
  assert.ok(Math.abs(out.aileron + 0.85) < 1e-12);
  assert.ok(Math.abs(out.rudder - 0.6) < 1e-12);
  assert.ok(Math.abs(out.throttle - 0.35) < 1e-12);
  assert.ok(Math.abs(out.pitchTrim - 0.5) < 1e-12);
  out = laws.update({ flapsDelta: 1, gearToggle: true, reverserToggle: true, brakes: 0.7 }, 1 / 120);
  assert.equal(out.flapsIndex, 1);
  assert.equal(out.gearHandleDown, false);
  assert.equal(out.reverserActive, true);
  assert.equal(out.brakes, 0.7);
  for (let i = 0; i < 120; i++) out = laws.update({}, 1 / 120);
  assert.equal(out.elevator, 0); assert.equal(out.aileron, 0); assert.equal(out.rudder, 0);
  assert.equal(out.flapsIndex, 1); assert.equal(out.reverserActive, true);
  const physics = new FlightPhysicsCore();
  assert.doesNotThrow(() => physics.step(1 / 120, out));
});

test('q-feel, deadzone, precision curve and aircraft flap bounds are explicit', () => {
  const laws = new FlightControlLaws({ deadzoneStick: 0.04, precisionCurve: true });
  assert.equal(laws.update({ pitch: 0.03 }, 1).elevator, 0);
  const shaped = applyDeadzone(0.5, 0.04);
  const expected = (0.35 * shaped + 0.65 * shaped ** 3) * 0.45;
  assert.ok(Math.abs(laws.update({ pitch: 0.5 }, 1, 360, 'F16').elevator - expected) < 1e-12);
  for (let i = 0; i < 20; i++) laws.update({ flapsDelta: 1 }, 0.1, 140, 'F16');
  assert.equal(laws.flapsIndex, 1);
});

test('warning state retains hysteresis, emits single crossing callouts and resets', () => {
  const laws = new FlightWarningsCore();
  const s = { onGround: false, radioAltFt: 600, altitudeFt: 600, vsiFpm: -600,
    iasKnots: 140, mach: 0.3, gearState: 1, flapDegree: 30, rollDeg: 0 };
  assert.equal(laws.update(0.1, s).gpwsCallout, null);
  assert.equal(laws.update(0.1, { ...s, radioAltFt: 500 }).gpwsCallout?.altitudeFt, 500);
  assert.equal(laws.update(0.1, { ...s, radioAltFt: 500 }).gpwsCallout, null);
  let out = laws.update(0.1, { ...s, isStallWarning: true, iasKnots: 350, rollDeg: 60 }, 6);
  assert.equal(out.stallWarning, true); assert.equal(out.overspeed, true);
  assert.equal(out.bankAngle, true); assert.equal(out.terrainConflict, true);
  assert.equal(out.activeWarnings[0].id, 'pull-up');
  assert.equal(laws.update(0.1, s).stallWarning, true);
  for (let i = 0; i < 10; i++) out = laws.update(0.1, s);
  assert.equal(out.stallWarning, false);
  laws.reset();
  assert.deepEqual(laws.update(0, s).activeWarnings, []);
});

test('autopilot snapshot pose matches existing YXZ flight conventions and flat API', () => {
  for (const angles of [[0.2, 0.7, -0.4], [-0.3, -2, 0.8], [Math.PI / 2, 0.5, 0]]) {
    const quaternion = new Quaternion().setFromEuler(new Euler(...angles, 'YXZ'));
    const position = { x: 40, y: 500, z: -60 }, linearVelocity = { x: 0, y: -2, z: -70 };
    const telemetry = { iasKnots: 140, tasKnots: 150, throttle: 0.6 };
    const snapshot = { telemetry, quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, position, linearVelocity };
    const flat = autopilotState(snapshot);
    const euler = new Euler().setFromQuaternion(quaternion, 'YXZ');
    const f = new Vector3(0, 0, -1).applyQuaternion(quaternion);
    assert.ok(Math.abs(flat.pitchDeg - euler.x * 180 / Math.PI) < 1e-10);
    assert.ok(Math.abs(flat.rollDeg + euler.z * 180 / Math.PI) < 1e-10);
    assert.ok(Math.abs(flat.headingDeg - (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360) < 1e-10);
    const a = new AutopilotController(), b = new AutopilotController();
    for (const mode of ['MASTER', 'HDG', 'ALT', 'SPD']) { a.engage(mode, snapshot); b.engage(mode, flat); }
    for (let i = 0; i < 20; i++) assert.deepEqual(a.update(snapshot, 1 / 120), b.update(flat, 1 / 120));
  }
});
