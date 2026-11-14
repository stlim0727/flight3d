import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSpawnToWind } from '../src/core/windSpawn.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const degrees = radians => radians * 180 / Math.PI;

test('a crosswind keeps the track and airspeed and crabs the nose into the wind', () => {
  // Track east at 46 m/s; wind from the north blows toward +Z (south).
  const out = alignSpawnToWind({ x: 46, y: 0, z: 0 }, { x: 0, y: 0, z: 4 });
  near(out.z, 0); assert.ok(out.x > 0 && out.x < 46);
  near(Math.hypot(out.x - 0, out.z - 4), 46);
  // Positive yaw is nose-left: from east toward north, into the wind.
  near(degrees(out.yaw), degrees(Math.asin(4 / 46)), 1e-9);
  // A wind from the south crabs the other way.
  near(alignSpawnToWind({ x: 46, y: 0, z: 0 }, { x: 0, y: 0, z: -4 }).yaw, -out.yaw);
});

test('head and tail winds change only the ground speed', () => {
  // Track north (-Z) at 46 m/s.
  const head = alignSpawnToWind({ x: 0, y: 0, z: -46 }, { x: 0, y: 0, z: 4 });
  near(head.x, 0); near(head.z, -42); near(head.yaw, 0);
  const tail = alignSpawnToWind({ x: 0, y: 0, z: -46 }, { x: 0, y: 0, z: -4 });
  near(tail.z, -50); near(tail.yaw, 0);
});

test('any track and wind give zero sideslip at the authored airspeed', () => {
  for (let heading = 0; heading < 360; heading += 35) {
    for (let from = 0; from < 360; from += 50) {
      const h = heading * Math.PI / 180, f = from * Math.PI / 180;
      const velocity = { x: 70 * Math.sin(h), y: -3, z: -70 * Math.cos(h) };
      const wind = { x: -9 * Math.sin(f), y: 0, z: 9 * Math.cos(f) };
      const out = alignSpawnToWind(velocity, wind);
      const ax = out.x - wind.x, az = out.z - wind.z;
      near(Math.hypot(ax, az), 70);
      // The ground velocity stays on the authored track.
      near(out.x * velocity.z - out.z * velocity.x, 0, 1e-9);
      assert.ok(out.x * velocity.x + out.z * velocity.z > 0);
      // Yawing the authored heading by out.yaw points the nose along the air velocity.
      const noseHeading = h - out.yaw;
      near(Math.sin(noseHeading) * az + Math.cos(noseHeading) * ax, 0, 1e-9);
      assert.ok(Math.sin(noseHeading) * ax - Math.cos(noseHeading) * az > 0);
    }
  }
});

test('no wind, no speed, or a wind too strong to hold the track leaves the spawn unchanged', () => {
  assert.deepEqual(alignSpawnToWind({ x: 46, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), { x: 46, z: 0, yaw: 0 });
  assert.deepEqual(alignSpawnToWind({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }), { x: 0, z: 0, yaw: 0 });
  assert.deepEqual(alignSpawnToWind({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 12 }), { x: 10, z: 0, yaw: 0 });
  assert.deepEqual(alignSpawnToWind({ x: 10, y: 0, z: 0 }, { x: -12, y: 0, z: 0 }), { x: 10, z: 0, yaw: 0 });
  const target = {};
  assert.equal(alignSpawnToWind({ x: 46, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, target), target);
});
