import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPilot, valleySlalomPilotSource } from '../src/pilot/examples/valleySlalom.js';

const sensor = mean => ({ status: 'available', mean, std: 0 });

function observation(overrides = {}) {
  return {
    instruments: Object.fromEntries(Object.entries({
      iasKnots: 230,
      tasKnots: 250,
      pitchDeg: 6,
      rollDeg: 0,
      headingDeg: 180,
      radioAltFt: 220,
      vsiFpm: 0,
      pitchRateDegS: 0,
      rollRateDegS: 0,
      yawRateDegS: 0,
    }).map(([key, value]) => [key, sensor(value)])),
    navigation: {
      goalBearingDeg: sensor(180),
      goalRangeM: sensor(1000),
      currentGateIndex: 1,
    },
    ...overrides,
  };
}

function sampleBriefing() {
  return {
    configuration: { pitchTrimDeg: 2 },
    course: {
      route: [
        { sM: 0, x: 0, z: 0, groundElevationM: 100 },
        { sM: 500, x: 0, z: 500, groundElevationM: 100 },
        { sM: 1000, x: 100, z: 1000, groundElevationM: 100 },
        { sM: 1500, x: 200, z: 1500, groundElevationM: 100 },
      ],
      gates: [
        { sM: 0, crossOffsetM: 0, maxAglM: 120 },
        { sM: 500, crossOffsetM: 50, maxAglM: 120 },
        { sM: 1000, crossOffsetM: -50, maxAglM: 120 },
      ],
    },
  };
}

test('valley slalom pilot source is a self-contained module string', async () => {
  assert.ok(typeof valleySlalomPilotSource === 'string');
  assert.ok(valleySlalomPilotSource.includes('export function createPilot'));
  const module = await import('data:text/javascript;base64,' + Buffer.from(valleySlalomPilotSource).toString('base64'));
  assert.equal(typeof module.createPilot, 'function');
  const pilot = module.createPilot();
  pilot.reset(sampleBriefing());

  for (let i = 0; i < 20; i++) {
    const cmd = pilot.onTick(observation());
    for (const [key, val] of Object.entries(cmd)) {
      assert.ok(Number.isFinite(val), `${key} should be finite, got ${val}`);
      assert.ok(val <= 1 && val >= (['throttle', 'brakes'].includes(key) ? 0 : -1));
    }
  }
});

test('commands remain finite and bounded across continuous operations', () => {
  const pilot = createPilot();
  pilot.reset(sampleBriefing());

  for (let i = 0; i < 50; i++) {
    const cmd = pilot.onTick(observation({
      instruments: Object.fromEntries(Object.entries({
        iasKnots: 200 + i,
        tasKnots: 220 + i,
        pitchDeg: -10 + i * 0.5,
        rollDeg: -45 + i * 1.5,
        headingDeg: 180 + Math.sin(i) * 30,
        radioAltFt: 150 + Math.cos(i) * 50,
        vsiFpm: Math.sin(i) * 500,
        pitchRateDegS: Math.cos(i) * 5,
        rollRateDegS: Math.sin(i) * 10,
        yawRateDegS: 0,
      }).map(([key, value]) => [key, sensor(value)])),
    }));

    for (const [key, val] of Object.entries(cmd)) {
      assert.ok(Number.isFinite(val));
      assert.ok(val <= 1 && val >= (['throttle', 'brakes'].includes(key) ? 0 : -1));
    }
  }
});

test('missing sensors hold last command without throwing', () => {
  const pilot = createPilot();
  pilot.reset(sampleBriefing());
  const nominal = pilot.onTick(observation());
  const held = pilot.onTick({ instruments: {} });
  assert.deepEqual(held, nominal);
});
