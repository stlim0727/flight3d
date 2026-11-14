import test from 'node:test';
import assert from 'node:assert/strict';
import { WindField } from '../src/physics/WindField.js';
import { UrbanWindField, URBAN_WIND } from '../src/physics/UrbanWindField.js';
import { NEON_TOWERS, NEON_WIND_SITES, CANYON_FLIGHT } from '../src/config/neonBuildings.js';

const calm = { profile: 'calm-debug-v1', seed: 'urban-test' };
const tower = { id: 'solo', x: 0, z: 0, w: 60, d: 60, h: 300, rot: 0 };
const neon = (extra = {}) => new UrbanWindField({ profile: 'light-turbulence-v1', seed: 'neon-background-v1',
  runwayHeadingDeg: 90, meanFromDeg: 0, meanSpeed: 4, referenceHeight: 110, streetY: 0, waterY: -14,
  obstacles: NEON_TOWERS, ...extra });
const sitePoint = id => ({ x: NEON_WIND_SITES.find(s => s.id === id).x, y: CANYON_FLIGHT.altitude, z: CANYON_FLIGHT.z });
const speed = wind => Math.hypot(wind.x, wind.z);
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected}`);

test('the height profile is 4 m/s at the reference height and constant above the ceiling', () => {
  const field = neon({ obstacles: [] });
  near(field.speedAt(110), 4, 1e-12);
  near(field.speedAt(-14), 1.42, 0.01);
  near(field.speedAt(0), 2.39, 0.01);
  near(field.speedAt(400), 5.39, 0.01);
  assert.equal(field.speedAt(900), field.speedAt(URBAN_WIND.ceilingY));
  assert.equal(field.speedAt(-50), field.speedAt(-14));
  // From 000 the wind blows toward +Z (south).
  const mean = field.mean();
  near(mean.x, 0, 1e-12); near(mean.z, 4, 1e-12); assert.equal(mean.y, 0);
});

test('without obstacles or mean wind the field is the base WindField above the vertical fade', () => {
  const options = { profile: 'strong-turbulence-v1', seed: 'coastal-b738-turbulence-1', runwayHeadingDeg: 63 };
  const base = new WindField(options), urban = new UrbanWindField({ ...options, streetY: 0, waterY: -14 });
  for (let i = 0; i < 200; i++) {
    const point = { x: i * 37 - 900, y: 30 + i * 4, z: 500 - i * 21 }, time = i * 0.41;
    const expected = base.sample(point, time), wind = urban.sample(point, time);
    for (const axis of ['x', 'y', 'z']) near(wind[axis], expected[axis], 1e-12, axis);
  }
});

test('one tower shelters its lee side; reversing the wind moves the wake to the other side', () => {
  const lee = { x: 0, y: 100, z: 150 }, mirror = { x: 0, y: 100, z: -150 }, free = { x: 5000, y: 100, z: 150 };
  const north = new UrbanWindField({ ...calm, meanSpeed: 4, obstacles: [tower] });
  const open = speed(north.meanAt(free));
  near(open, north.speedAt(100), 1e-12);
  // 120 m behind the lee face of a 60 m wide tower: two lengths, deficit 0.6 / (1 + 2 / 4).
  near(speed(north.meanAt(lee)), 0.6 * open, 1e-9);
  near(speed(north.meanAt(mirror)), open, 1e-12);
  assert.ok(north.turbulenceAt(lee) > 0.3 && north.turbulenceAt(mirror) === 0);
  const south = new UrbanWindField({ ...calm, meanSpeed: 4, meanFromDeg: 180, obstacles: [tower] });
  near(speed(south.meanAt(lee)), open, 1e-12);
  near(speed(south.meanAt(mirror)), 0.6 * open, 1e-9);
  near(south.meanAt(free).z, -open, 1e-12);
  // Above the roof shear layer and beyond the wake's end the wind is undisturbed.
  near(speed(north.meanAt({ x: 0, y: 340, z: 150 })), north.speedAt(340), 1e-12);
  near(speed(north.meanAt({ x: 0, y: 100, z: 30 + 12 * 60 })), open, 1e-12);
  // East wind: the wake lies to the west of the tower.
  const east = new UrbanWindField({ ...calm, meanSpeed: 4, meanFromDeg: 90, obstacles: [tower] });
  near(speed(east.meanAt({ x: -150, y: 100, z: 0 })), 0.6 * open, 1e-9);
  assert.ok(east.meanAt(free).x < 0);
});

test('the wake follows the rotated footprint and the smaller of width and height', () => {
  const wall = { id: 'wall', x: 0, z: 0, w: 240, d: 36, h: 170, rot: 0 };
  const field = new UrbanWindField({ ...calm, meanSpeed: 4, obstacles: [wall] });
  const open = field.speedAt(100);
  // Reference length is the 170 m height; 340 m behind the lee face is two lengths.
  near(speed(field.meanAt({ x: 0, y: 100, z: 18 + 340 })), 0.6 * open, 1e-9);
  // Turned a quarter, the same wall is 36 m wide to the wind and 240 m deep.
  const turned = new UrbanWindField({ ...calm, meanSpeed: 4, obstacles: [{ ...wall, rot: Math.PI / 2 }] });
  near(speed(turned.meanAt({ x: 0, y: 100, z: 120 + 72 })), 0.6 * open, 1e-9);
});

test('Neon: the lee and slot sites are sheltered and more turbulent than the open site', () => {
  const field = neon();
  const open = speed(field.meanAt(sitePoint('open')));
  near(open, 4, 0.05);
  for (const id of ['lee', 'slot']) {
    assert.ok(speed(field.meanAt(sitePoint(id))) <= 0.8 * open, id);
    assert.ok(field.turbulenceAt(sitePoint(id)) > 0.5, id);
  }
  assert.ok(field.turbulenceAt(sitePoint('open')) < 0.05);
  assert.ok(speed(field.meanAt(sitePoint('canal'))) > speed(field.meanAt(sitePoint('lee'))) + 1);
  // The crown tower causes most of the lee site's shelter.
  const without = neon({ obstacles: NEON_TOWERS.filter(t => t.id !== 'mega-crown') });
  assert.ok(speed(without.meanAt(sitePoint('lee'))) > speed(field.meanAt(sitePoint('lee'))) + 0.5);
  // Sampled over a minute, the lee site's wind varies more than the open site's.
  const rms = point => {
    let sum = 0, sumSq = 0, count = 0;
    for (let time = 0; time < 60; time += 0.1) {
      const x = field.sample(point, time).x; sum += x; sumSq += x * x; count++;
    }
    return Math.sqrt(sumSq / count - (sum / count) ** 2);
  };
  assert.ok(rms(sitePoint('lee')) > 2 * rms(sitePoint('open')));
});

test('samples are a pure function of seed, position and time, and accept an aliased target', () => {
  const field = neon(), point = sitePoint('lee');
  const expected = field.sample(point, 12.5);
  field.sample({ x: -900, y: 12, z: 90 }, 72); field.meanAt(sitePoint('slot')); field.turbulenceAt(sitePoint('open'));
  assert.deepEqual(field.sample(point, 12.5), expected);
  assert.deepEqual(neon().sample(point, 12.5), expected);
  assert.notDeepEqual(neon({ seed: 'other' }).sample(point, 12.5), expected);
  assert.notDeepEqual(field.sample(point, 13), expected);
  const aliased = { ...point };
  assert.deepEqual(field.sample(aliased, 12.5, aliased), expected);
});

test('the field is continuous across wake sides, roofs, lee faces and wake ends', () => {
  const field = neon();
  const lines = [
    [{ x: 200, y: 110, z: 0 }, { x: 0.5, y: 0, z: 0 }, 7200], // the canyon flight
    [{ x: 2500, y: 0, z: -139 }, { x: 0, y: 0.5, z: 0 }, 1100], // up through the crown tower's wake and roof
    [{ x: 2500, y: 200, z: -175 }, { x: 0, y: 0, z: 0.5 }, 2400], // lee face to beyond the wake's end
    [{ x: 2300, y: -14, z: 1900 }, { x: 0, y: 0.02, z: -0.5 }, 7400], // the bridge flight, climbing gently
  ];
  let worst = 0;
  for (const [start, step, count] of lines) {
    let previous = null;
    for (let i = 0; i < count; i++) {
      const wind = field.sample({ x: start.x + step.x * i, y: start.y + step.y * i, z: start.z + step.z * i }, 31);
      if (previous) for (const axis of ['x', 'y', 'z']) worst = Math.max(worst, Math.abs(wind[axis] - previous[axis]));
      previous = wind;
    }
  }
  assert.ok(worst <= 0.3, `largest change over 0.5 m: ${worst}`);
});

test('vertical wind is zero at and below street level, everywhere and at any time', () => {
  const field = neon({ profile: 'strong-turbulence-v1' });
  for (let i = 0; i < 300; i++) {
    for (const y of [0, -4, -14]) {
      assert.equal(Math.abs(field.sample({ x: 200 + i * 12, y, z: (i % 9) * 40 - 160 }, i * 0.7).y), 0);
    }
  }
  assert.ok(Math.abs(field.sample(sitePoint('lee'), 3).y) > 0);
});

test('mean wind is uniform across a span in open air and the city terms vanish without wind', () => {
  const open = neon({ profile: 'calm-debug-v1', obstacles: [] });
  assert.deepEqual(open.sample({ x: 300, y: 110, z: -9 }, 5), open.sample({ x: 300, y: 110, z: 9 }, 5));
  const still = neon({ meanSpeed: 0 }), base = new WindField({ profile: 'light-turbulence-v1',
    seed: 'neon-background-v1', runwayHeadingDeg: 90 });
  const point = sitePoint('lee');
  assert.deepEqual(still.meanAt(point), { x: 0, y: 0, z: 0 });
  assert.equal(still.turbulenceAt(point), 0);
  const wind = still.sample(point, 9), expected = base.sample(point, 9);
  for (const axis of ['x', 'y', 'z']) near(wind[axis], expected[axis], 1e-12, axis);
});

test('twenty overlapping towers stay finite and inside the profile speed', () => {
  const field = new UrbanWindField({ ...calm, meanSpeed: 4, obstacles: Array.from({ length: 20 }, () => tower) });
  for (let z = 20; z < 900; z += 7) {
    const point = { x: 5, y: 100, z }, mean = speed(field.meanAt(point)), wind = field.sample(point, z);
    assert.ok(mean >= 0 && mean <= field.speedAt(100));
    assert.ok([wind.x, wind.y, wind.z].every(Number.isFinite));
    assert.ok(field.turbulenceAt(point) <= URBAN_WIND.intensityCap * field.speedAt(100));
  }
});

test('invalid profiles and obstacles are rejected', () => {
  assert.throws(() => new UrbanWindField({ meanSpeed: -1 }), RangeError);
  assert.throws(() => new UrbanWindField({ referenceHeight: -20, waterY: -14 }), RangeError);
  assert.throws(() => new UrbanWindField({ streetY: -20, waterY: -14 }), RangeError);
  assert.throws(() => new UrbanWindField({ obstacles: [{ ...tower, h: 0 }] }), TypeError);
  assert.throws(() => new UrbanWindField({ obstacles: [{ ...tower, x: NaN }] }), TypeError);
  assert.throws(() => new UrbanWindField({ profile: 'missing' }), RangeError);
});
