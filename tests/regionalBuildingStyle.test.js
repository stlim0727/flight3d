import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBuildingStyle as style } from '../src/geospatial/regionalBuildingStyle.js';

const songdo = { id: 'building-7', latitude: 37.39, longitude: 126.642 };
const jeju = { ...songdo, latitude: 33.461, longitude: 126.932 };
for (const [label, place, properties, min, max, shape] of [
  ['Songdo apartment', songdo, { class: 'apartments' }, 48, 96, 'flat'],
  ['Songdo warehouse', songdo, { class: 'warehouse' }, 5, 12, 'flat'],
  ['Songdo unknown use', songdo, {}, 6, 15, 'flat'],
  ['Jeju house', jeju, { subtype: 'residential', class: 'house' }, 3.2, 7, 'hipped'],
  ['Jeju unknown use', jeju, {}, 4, 10, 'flat'],
]) {
  test(label, () => {
    const result = style({ ...place, properties });
    assert.ok(result.heightM >= min && result.heightM < max);
    assert.equal(result.roofShape, shape);
    assert.match(result.roofColor, /^#[\da-f]{6}$/);
  });
}

test('uses each valid map attribute independently', () => {
  const resolve = properties => style({ ...jeju, properties: { class: 'house', ...properties } });
  const fallback = resolve({});
  assert.deepEqual(resolve({ height: 18, num_floors: 7, roof_color: 'invalid', roof_shape: 'unknown' }),
    { ...fallback, heightM: 18 });
  assert.deepEqual(resolve({ height: Infinity, num_floors: 2, roof_color: '#008000' }),
    { ...fallback, heightM: 6.4, roofColor: '#008000' });
  assert.deepEqual(resolve({ height: 1501, num_floors: -1, roof_shape: 'gabled', roof_color: 'blue' }),
    { ...fallback, roofShape: 'gabled', roofColor: '#0000ff' });
});

test('outside either PoC uses the legacy material, 9 m and a flat roof', () => {
  for (const coords of [{ latitude: 33.5, longitude: 126.53 }, {}, { latitude: null, longitude: null }]) {
    assert.deepEqual(style({ ...coords, properties: { class: 'apartments' } }),
      { heightM: 9, roofColor: null, roofShape: 'flat' });
  }
});

test('ID or canonical coordinates keep samples stable across independent reads', () => {
  const input = { ...jeju, properties: { class: 'house' } };
  assert.deepEqual(style(input), style({ ...structuredClone(input), longitude: input.longitude + 0.000001 }));
  const anonymous = { ...input, id: undefined };
  assert.deepEqual(style(anonymous), style(structuredClone(anonymous)));
  assert.notEqual(style(anonymous).heightM, style({ ...anonymous, latitude: anonymous.latitude + 0.0001 }).heightM);
  const colors = new Set(Array.from({ length: 100 }, (_, id) => style({ ...input, id }).roofColor));
  assert.deepEqual(colors, new Set(['#427aaf', '#56835d', '#bb7049']));
});
