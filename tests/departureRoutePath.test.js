import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenRoutePath, sampleOpenPose, samplePathCurvature, projectOntoPath, buildDepartureTakeoffPath } from '../src/geospatial/departureRoutePath.js';
import { DEPARTURE_RUNWAY, DEPARTURE_TAXI_ROUTE, departurePushbackPose } from '../src/config/incheonDeparture.js';

const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

test('open route accumulates arc length and drops duplicate vertices', () => {
  const path = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: -4 }]);
  assert.equal(path.points.length, 3);
  assert.deepEqual(path.distances, [0, 3, 7]);
  assert.equal(path.length, 7);
  assert.throws(() => buildOpenRoutePath([{ x: 1, z: 1 }, { x: 1, z: 1 }]));
});

test('pose sampling interpolates, follows the simulator heading convention and clamps at both ends', () => {
  const path = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: -10 }, { x: 10, z: -10 }]);
  const north = sampleOpenPose(path, 5);
  assert.deepEqual([north.x, north.z], [0, -5]);
  close(north.heading, 0, 1e-12, 'moving toward -Z is heading 0');
  const east = sampleOpenPose(path, 15);
  assert.deepEqual([east.x, east.z], [5, -10]);
  close(east.heading, Math.PI / 2, 1e-12, 'moving toward +X is heading 90°');
  assert.deepEqual([sampleOpenPose(path, -50).x, sampleOpenPose(path, -50).z], [0, 0]);
  const end = sampleOpenPose(path, 1e6);
  assert.deepEqual([end.x, end.z, end.distance], [10, -10, 20]);
  assert.equal(sampleOpenPose(path, NaN).distance, 0, 'non-finite input clamps to the start');
});

test('curvature is zero on a straight and signed through a turn', () => {
  const straight = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: -100 }]);
  assert.equal(samplePathCurvature(straight, 50), 0);
  const right = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: -50 }, { x: 50, z: -50 }]);
  assert.ok(samplePathCurvature(right, 50) > 0, 'right turn increases heading');
  const left = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: -50 }, { x: -50, z: -50 }]);
  assert.ok(samplePathCurvature(left, 50) < 0, 'left turn decreases heading');
  close(samplePathCurvature(right, 0, 4), 0, 1e-12, 'window clamped at the path start');
});

test('projection returns the arc length of the nearest path point', () => {
  const path = buildOpenRoutePath([{ x: 0, z: 0 }, { x: 0, z: -10 }, { x: 10, z: -10 }]);
  const { distance, offset } = projectOntoPath(path, 4, -12);
  close(distance, 14, 1e-9, 'arc length');
  close(offset, 2, 1e-9, 'lateral offset');
});

test('departure takeoff path starts at the pushback end and orders hold short, line-up and runway end', () => {
  const path = buildDepartureTakeoffPath();
  const start = sampleOpenPose(path, 0), pushbackEnd = departurePushbackPose(1);
  close(start.x, pushbackEnd.x, 1e-9, 'start x'); close(start.z, pushbackEnd.z, 1e-9, 'start z');
  assert.ok(0 < path.holdShort && path.holdShort < path.lineUp && path.lineUp < path.runwayEnd && path.runwayEnd < path.length);
  const hold = sampleOpenPose(path, path.holdShort), last = DEPARTURE_TAXI_ROUTE.at(-1);
  close(hold.x, last.x, 1e-9, 'hold short is the mapped taxi route end'); close(hold.z, last.z, 1e-9, 'hold short z');
});

test('line-up and runway roll stay on the runway centreline at runway heading', () => {
  const path = buildDepartureTakeoffPath();
  const runway = DEPARTURE_RUNWAY, angle = runway.headingDeg * Math.PI / 180;
  const cross = p => (p.x - runway.threshold.x) * Math.cos(angle) + (p.z - runway.threshold.z) * Math.sin(angle);
  for (const s of [path.lineUp + 1, (path.lineUp + path.runwayEnd) / 2, path.runwayEnd - 1, path.runwayEnd + 3000]) {
    const pose = sampleOpenPose(path, s);
    close(cross(pose), 0, 0.5, `centreline offset at ${s.toFixed(0)} m`);
    const heading = (pose.heading * 180 / Math.PI + 360) % 360;
    close(heading, runway.headingDeg, 0.1, `heading at ${s.toFixed(0)} m`);
  }
  assert.ok(path.lineUpAlongRunway > 50 && path.lineUpAlongRunway < 150, 'line-up point is near the threshold');
});

test('climb-out extension prevents airborne traffic from clamping at the runway end', () => {
  const path = buildDepartureTakeoffPath({ climbOutMeters: 5000 });
  close(path.length - path.runwayEnd, 5000, 1e-6, 'extension length');
});
