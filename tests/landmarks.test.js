import assert from 'node:assert/strict';
import test from 'node:test';
import { landmarksForMap } from '../src/config/landmarks.js';

test('all maps supply finite landmark anchors using their own coordinate frames', () => {
  const terrain = { getHeight: () => 200, terrain: { centerline: [{ x: 12, z: -4200 }] } };
  const airport = { controlTowerData: { x: 40, z: 10, y: 2840, height: 16 } };
  for (const map of ['incheon', 'jeju', 'lukla', 'neon', 'coastal', 'valley']) {
    const records = landmarksForMap(map, terrain, airport);
    assert.ok(records.length > 0, map);
    for (const record of records) {
      assert.ok(record.en && record.ko, map);
      assert.ok([record.x, record.z, record.height].every(Number.isFinite), map);
    }
  }
  const tower = map => landmarksForMap(map).find(record => record.en === 'Lotte World Tower');
  assert.ok(tower('incheon').x > 25000);
  assert.ok(Math.abs(tower('jeju').z) > 400000);
  assert.deepEqual(landmarksForMap('unknown'), []);
});
