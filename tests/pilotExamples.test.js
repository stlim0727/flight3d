import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilot as takeoff, takeoffPilotSource } from '../src/pilot/examples/takeoff.js';
import { createPilot as landing, landingPilotSource } from '../src/pilot/examples/landing.js';
import { validateCommand } from '../src/pilot/PilotProtocol.js';
const sensor = mean => ({ status: 'available', mean, std: 0 });
function obs(values = {}) {
  const v = { iasKnots: 145, groundSpeedKnots: 140, pitchDeg: 2, rollDeg: 0, radioAltFt: 300, vsiFpm: -700, headingErrorDeg: 0, centerlineOffsetM: 0, glideSlopeErrorDeg: 0, ...values };
  return { instruments: Object.fromEntries(['iasKnots', 'groundSpeedKnots', 'pitchDeg', 'rollDeg', 'radioAltFt', 'vsiFpm'].map(k => [k, sensor(v[k])])), navigation: Object.fromEntries(['headingErrorDeg', 'centerlineOffsetM', 'glideSlopeErrorDeg'].map(k => [k, sensor(v[k])])), feedback: { weightOnWheels: { status: 'available', value: v.wow ?? false } } };
}
test('source strings are self-contained pilot modules exporting both hooks', async () => {
  for (const source of [takeoffPilotSource, landingPilotSource]) {
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const pilot = module.createPilot({});
    pilot.reset({ decisionPeriodSeconds: 0.2 });
    assert.equal(validateCommand(pilot.onTick(obs())).ok, true);
  }
});
test('both pilots use cross-track/heading feedback with correcting signs and bounded outputs', () => {
  for (const create of [takeoff, landing]) {
    const right = create().onTick(obs({ headingErrorDeg: 5, centerlineOffsetM: 10 }));
    const left = create().onTick(obs({ headingErrorDeg: -5, centerlineOffsetM: -10 }));
    assert.ok(right.aileron < left.aileron);
    assert.ok(right.rudder < left.rudder);
    for (const command of [right, left, create().onTick(obs({ pitchDeg: -100, rollDeg: 150, iasKnots: 0 }))]) assert.equal(validateCommand(command).ok, true);
  }
});
test('takeoff reset honors rotation speed briefing and missing data holds last command', () => {
  const p = takeoff();
  p.reset({ recommendedSpeeds: { rotationKnots: 155 } });
  const rolling = p.onTick(obs({ iasKnots: 145, pitchDeg: 0, radioAltFt: 10 }));
  assert.equal(rolling.elevator, 0);
  const rotating = p.onTick(obs({ iasKnots: 156, pitchDeg: 0, radioAltFt: 10 }));
  assert.ok(rotating.elevator > rolling.elevator);
  assert.deepEqual(p.onTick({}), rotating);
  rotating.throttle = -99;
  assert.equal(p.onTick({}).throttle, 1);
  p.reset();
  assert.equal(p.onTick({}).throttle, 0);
});
test('landing flare survives expired guidance, touchdown latches idle through bounce and missing data', () => {
  const p = landing();
  const approach = p.onTick(obs());
  const o = obs({ radioAltFt: 30 });
  o.navigation.glideSlopeErrorDeg = { status: 'unavailable', mean: null, std: null };
  const flare = p.onTick(o);
  assert.ok(flare.throttle < approach.throttle);
  assert.equal(flare.brakes, 0);
  const rollout = p.onTick(obs({ wow: true, radioAltFt: 8, groundSpeedKnots: 100 }));
  assert.equal(rollout.throttle, 0);
  assert.ok(rollout.brakes > 0);
  assert.equal(p.onTick(obs({ wow: false, radioAltFt: 15 })).throttle, 0);
  assert.equal(p.onTick({}).throttle, 0);
  p.reset();
  assert.equal(p.onTick({}).throttle, 0.52);
});
