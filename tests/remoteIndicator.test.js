import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePosition, indicatorMode, screenBearing } from '../src/multiplayer/remoteIndicator.js';

test('camera-relative bearing keeps the same signs across the eye plane', () => {
  for (const z of [-10, -.01, 0, .01, 10]) {
    const b = screenBearing({ x: 5, y: 5, z }, 2, 2);
    assert.ok(b.x > 0 && b.y < 0);
    assert.equal(b.behind, z > 0);
  }
  assert.equal(screenBearing({ x: -1, y: 0, z: 1 }, 1, 1).x, -1);
  assert.equal(screenBearing({ x: 0, y: -1, z: 1 }, 1, 1).y, 1);
  assert.equal(screenBearing({ x: 0, y: 0, z: 0 }, 1, 1), null);
});

test('directly behind retains the previous bearing across the rear axis', () => {
  const previous = screenBearing({ x: -10, y: 0, z: 100 }, 1, 1);
  for (const x of [-1, 0, 1]) {
    const b = screenBearing({ x, y: 0, z: 100 }, 1, 1, previous);
    assert.ok(b.directlyBehind);
    assert.equal(b.x, -1);
  }
  assert.equal(screenBearing({ x: 0, y: 0, z: 100 }, 1, 1).x, 1);
});

test('reentry margin prevents switching at every crossing', () => {
  let mode = 'hidden';
  const observed = [30, -1, 1, -1, 15, 16, 1].map(x => {
    mode = indicatorMode({ x, y: 100, front: true, inDepth: true }, 320, 200, mode);
    return mode;
  });
  assert.deepEqual(observed, ['onscreen', 'offscreen', 'offscreen', 'offscreen', 'offscreen', 'onscreen', 'onscreen']);
  assert.equal(indicatorMode({ x: 160, y: 100, front: false, inDepth: true }, 320, 200, mode), 'offscreen');
});

test('edge placement accounts for the full marker and occupied intervals', () => {
  const safe = { left: 24, right: 296, top: 110, bottom: 220 };
  const size = { width: 100, height: 24 };
  assert.deepEqual(edgePosition({ x: 0, y: -1 }, safe, size, []), { x: 160, y: 122 });
  assert.deepEqual(edgePosition({ x: 0, y: 1 }, safe, size, []), { x: 160, y: 208 });
  assert.deepEqual(edgePosition({ x: 1, y: -1 }, safe, size, []), { x: 203, y: 122 });
  const panel = { left: 228, right: 320, top: 110, bottom: 170 };
  assert.deepEqual(edgePosition({ x: 1, y: 0 }, safe, size, [panel]), { x: 246, y: 190 });
  assert.equal(edgePosition({ x: 1, y: 0 }, safe, size, [{ left: 0, right: 320, top: 100, bottom: 230 }]), null);
});
