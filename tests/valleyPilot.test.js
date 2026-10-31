import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPilot, valleyPilotSource } from '../src/pilot/examples/valley.js';
const sensor = mean => ({ status: 'available', mean, std: 0 });
function observation(overrides = {}) {
  return {
    instruments: Object.fromEntries(Object.entries({ iasKnots: 220, tasKnots: 250, pitchDeg: 7,
      rollDeg: 0, headingDeg: 180, radioAltFt: 200, vsiFpm: 0,
      pitchRateDegS: 0, rollRateDegS: 0, yawRateDegS: 0 }).map(([key, value]) => [key, sensor(value)])),
    navigation: { goalBearingDeg: sensor(180), goalRangeM: sensor(1000), currentGateIndex: 1 },
    terrain: { cells: [] }, ...overrides,
  };
}
test('valley source is a self-contained module and all commands stay finite/bounded', async () => {
  const module = await import('data:text/javascript;base64,' + Buffer.from(valleyPilotSource).toString('base64'));
  const pilot = module.createPilot(); pilot.reset({ configuration: { pitchTrimDeg: 2 } });
  for (let i = 0; i < 20; i++) {
    const command = pilot.onTick(observation());
    for (const [key, value] of Object.entries(command)) {
      assert.ok(Number.isFinite(value));
      assert.ok(value <= 1 && value >= (['throttle', 'brakes'].includes(key) ? 0 : -1));
    }
  }
});
test('forward terrain returns demand an anticipatory climb and missing sensors hold the last command', () => {
  const clear = createPilot(), ridge = createPilot();
  clear.reset(); ridge.reset();
  const imminent = observation({ terrain: { cells: [{ status: 'available', azimuthDeg: 5,
    elevationDeg: 10, rangeM: { mean: 400, std: 14 } }] } });
  const nominal = clear.onTick(observation()), escape = ridge.onTick(imminent);
  assert.ok(escape.elevator > nominal.elevator);
  assert.deepEqual(ridge.onTick({ instruments: {} }), escape);
});
test('bearing feedback commands turns in the observed direction and reset clears climb memory', () => {
  const pilot = createPilot();
  const right = observation(); right.navigation.goalBearingDeg = sensor(200);
  assert.ok(pilot.onTick(right).aileron > 0);
  const left = observation(); left.navigation.goalBearingDeg = sensor(160);
  assert.ok(pilot.onTick(left).aileron < 0);
  pilot.reset();
  assert.deepEqual(pilot.onTick(observation()), createPilot().onTick(observation()));
});
