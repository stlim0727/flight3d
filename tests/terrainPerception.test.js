import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainPerception } from '../src/pilot/TerrainPerception.js';
import { validatePlainData } from '../src/pilot/PilotProtocol.js';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const source = (getHeight = () => 0, quaternion = identity) => ({ position: { x: 0, y: 100, z: 0 }, quaternion, getHeight });
const raySensor = options => new TerrainPerception({ noise: false, azimuthsDeg: [0], elevationsDeg: [-35, 0, 25], ...options });

test('bounded grid distinguishes a measured first terrain return from a clear point ray', () => {
  const sensor = new TerrainPerception({ noise: false });
  const result = sensor.sample(source(), 0);
  assert.equal(result.cells.length, 84);
  assert.equal(result.frame, 'body');
  assert.equal(result.limits.sampling, 'point-rays');
  for (const c of result.cells) {
    if (c.elevationDeg < 0) {
      assert.equal(c.status, 'available');
      assert.ok(Math.abs(c.rangeM.mean - 100 / -Math.sin(c.elevationDeg * Math.PI / 180)) < 0.005);
    } else {
      assert.equal(c.status, 'clear-to-range');
      assert.equal(c.rangeM, null);
    }
  }
  assert.equal(validatePlainData(result).ok, true);
  const keys = Object.keys(result);
  assert.ok(!keys.includes('position') && !keys.includes('quaternion') && !keys.includes('getHeight'));
});

test('body orientation turns forward scan toward the east and preserves nearest-ridge occlusion', () => {
  const q = { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  // A near ridge at x=200 blocks a higher and more distant ridge at x=500.
  const height = x => x >= 200 && x <= 260 ? 150 : x >= 500 ? 300 : 0;
  const hit = raySensor().sample(source(height, q), 0).cells[1];
  assert.equal(hit.status, 'available');
  assert.ok(Math.abs(hit.rangeM.mean - 200) < 0.005);
  const north = raySensor().sample(source(height), 0).cells[1];
  assert.equal(north.status, 'clear-to-range');
});

test('unknown data and below-surface origins are unavailable rather than safe empty space', () => {
  const cells = raySensor().sample(source((_x, z) => z < -100 ? NaN : 0), 0).cells;
  assert.equal(cells[1].status, 'unavailable');
  assert.equal(cells[1].reason, 'terrain-unavailable');
  for (const input of [undefined, source(() => NaN), source(() => 120), source(() => { throw new Error('unloaded'); })]) {
    const result = raySensor().sample(input, 0);
    assert.ok(result.cells.every(c => c.status === 'unavailable' && c.rangeM === null));
  }
});

test('noise is seeded and correlated, repeated reads are idempotent and reset reproduces the stream', () => {
  const a = raySensor({ noise: true, sensorSeed: 17 }), b = raySensor({ noise: true, sensorSeed: 17 });
  const first = a.sample(source(), 0);
  assert.deepEqual(first, b.sample(source(), 0));
  assert.notEqual(first.cells[0].rangeM.mean, 100 / -Math.sin(-35 * Math.PI / 180));
  assert.ok(first.cells[0].rangeM.std > 2);
  first.cells[0].rangeM.mean = -999;
  assert.notEqual(a.sample(source(), 0).cells[0].rangeM.mean, -999);
  assert.deepEqual(a.sample(source(), 24), b.sample(source(), 24));
  a.reset();
  b.reset();
  assert.deepEqual(a.sample(source(), 0), b.sample(source(), 0));
});

test('terrain sampling has bounded work and no calls outside the maximum range', () => {
  let queries = 0, farthest = 0;
  const s = raySensor({ maxRangeM: 100 });
  const result = s.sample(source((x, z) => { queries++; farthest = Math.max(farthest, Math.hypot(x, z)); return 0; }), 0);
  assert.ok(queries <= 1 + 3 * (5 + 12));
  assert.ok(farthest <= 100 + 1e-9);
  assert.ok(result.cells.every(c => c.status === 'clear-to-range'));
  assert.throws(() => new TerrainPerception({ maxRangeM: Infinity }), /Invalid/);
  assert.throws(() => new TerrainPerception({ marchStepM: 0 }), /Invalid/);
  s.sample(source(), 24);
  assert.throws(() => s.sample(source(), 12), /Nonmonotonic/);
});
