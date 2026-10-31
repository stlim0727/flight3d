import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotPerception, wrapSignedDegrees } from '../src/pilot/PilotPerception.js';
import { validatePlainData } from '../src/pilot/PilotProtocol.js';
const source = { iasKnots: 145, groundSpeedKnots: 140, pitchDeg: 2, rollDeg: 0, headingDeg: 359.9, altitudeFt: (15 + 3000 * Math.tan(Math.PI / 60)) * 3.280839895013123, radioAltFt: 500, vsiFpm: -700, elevator: 0, aileron: 0, rudder: 0, throttle: 0.4, brakes: 0, runwayS: -3000, centerlineOffsetM: 0, weightOnWheels: false };
const options = { sensorSeed: 'case-a', mission: 'landing', runway: { headingDeg: 0, elevationM: 0 } };
test('only named noisy sensor estimates cross boundary, derived heading shares error', () => {
  const p = new PilotPerception(options);
  const result = p.sample({ ...source, x: 999, rawVelocity: { x: 100 }, damage: 2 }, 0);
  assert.equal(result.x, undefined);
  assert.equal(result.rawVelocity, undefined);
  assert.equal(result.damage, undefined);
  assert.notEqual(result.instruments.iasKnots.mean, source.iasKnots);
  assert.equal(result.navigation.headingErrorDeg.mean, wrapSignedDegrees(result.instruments.headingDeg.mean));
  assert.ok(result.instruments.headingDeg.mean >= 0 && result.instruments.headingDeg.mean < 360);
  assert.equal(validatePlainData(result).ok, true);
  assert.deepEqual(result.visual.contacts, []);
  assert.equal(result.capabilities.visualContacts, false);
});
test('seeded sequences replay/reset exactly, same tick calls cannot advance noise or mutate cache', () => {
  const a = new PilotPerception(options), b = new PilotPerception(options);
  const history = [];
  for (let tick = 0; tick < 240; tick += 24) {
    const result = a.sample(source, tick);
    history.push(result);
    assert.deepEqual(result, b.sample(source, tick));
    result.instruments.iasKnots.mean = -123;
    assert.notEqual(a.sample(source, tick).instruments.iasKnots.mean, -123);
  }
  a.reset(); b.reset();
  assert.deepEqual(a.sample(source, 0), b.sample(source, 0));
  assert.notDeepEqual(a.sample(source, 24), new PilotPerception({ ...options, sensorSeed: 'case-b' }).sample(source, 24));
  assert.throws(() => a.sample(source, 0), /Nonmonotonic/);
});
test('clean diagnostic profile has zero uncertainty and landing guidance uses shared altitude/distance', () => {
  const p = new PilotPerception({ ...options, noise: false });
  const result = p.sample(source, 0);
  assert.equal(result.instruments.iasKnots.mean, 145);
  assert.equal(result.instruments.iasKnots.std, 0);
  assert.ok(Math.abs(result.navigation.glideSlopeErrorDeg.mean) < 1e-12);
  assert.equal(result.navigation.glideSlopeErrorDeg.std, 0);
  const boundary = p.sample({ ...source, runwayS: -20 }, 24);
  assert.equal(boundary.navigation.glideSlopeErrorDeg.status, 'unavailable');
  assert.equal(boundary.navigation.glideSlopeErrorDeg.reason, 'passed-guidance-limit');
  assert.equal(boundary.navigation.glideSlopeErrorDeg.mean, null);
  assert.equal(boundary.navigation.glideSlopeErrorDeg.std, null);
});
test('missing/invalid sources become unavailable without nonfinite values or guidance leaks', () => {
  const p = new PilotPerception(options);
  const result = p.sample({ iasKnots: Infinity }, 0);
  assert.equal(result.instruments.iasKnots.status, 'unavailable');
  assert.equal(result.navigation.glideSlopeErrorDeg.status, 'unavailable');
  assert.equal(result.feedback.weightOnWheels.status, 'unavailable');
  assert.equal(validatePlainData(result).ok, true);
});
test('weight-on-wheels debounces transitions over physics ticks and resets', () => {
  const p = new PilotPerception(options);
  p.updateContact(false, 0);
  for (let tick = 1; tick < 12; tick++) p.updateContact(true, tick);
  assert.equal(p.sample({ ...source, weightOnWheels: true }, 12).feedback.weightOnWheels.value, false);
  p.updateContact(true, 13);
  assert.equal(p.sample({ ...source, weightOnWheels: true }, 24).feedback.weightOnWheels.value, true);
  p.updateContact(false, 25); p.updateContact(true, 26);
  assert.equal(p.sample({ ...source, weightOnWheels: true }, 48).feedback.weightOnWheels.value, true);
  p.reset();
  assert.equal(p.sample({ ...source, weightOnWheels: false }, 0).feedback.weightOnWheels.value, false);
});
