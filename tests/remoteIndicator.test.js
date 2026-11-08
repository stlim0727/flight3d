import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { distanceLabel, edgePosition, indicatorMode, screenBearing } from '../src/multiplayer/remoteIndicator.js';
import { RemoteAircraftIndicator } from '../src/multiplayer/RemoteAircraftIndicator.js';

test('distanceLabel formats meters under 1km to nearest 10m and kilometers to 1 decimal place', () => {
  assert.equal(distanceLabel(0), '0 m');
  assert.equal(distanceLabel(24), '20 m');
  assert.equal(distanceLabel(256), '260 m');
  assert.equal(distanceLabel(994), '990 m');
  assert.equal(distanceLabel(1000), '1.0 km');
  assert.equal(distanceLabel(1240), '1.2 km');
  assert.equal(distanceLabel(12550), '12.6 km');
});

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

test('multiplayer CSS defines transparent background and high-contrast shadow for nameplates', () => {
  const css = readFileSync(resolve('src/styles/multiplayer.css'), 'utf8');
  assert.match(css, /\.mp-nameplate\s*\{[^}]*background:\s*transparent;/);
  assert.match(css, /\.mp-nameplate\s*\{[^}]*text-shadow:/);
});

test('RemoteAircraftIndicator displays distance onscreen as well as offscreen', () => {
  const fakeElement = () => ({
    style: {},
    classList: { toggle() {} },
    dataset: {},
    append() {},
    remove() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 24, top: 24, right: 1896, bottom: 1056, width: 60, height: 16 }),
    textContent: '',
  });
  globalThis.document = {
    createElement: () => fakeElement(),
    createElementNS: () => fakeElement(),
    body: { append() {} },
    querySelectorAll: () => [],
  };
  globalThis.innerWidth = 1920;
  globalThis.innerHeight = 1080;

  const indicator = new RemoteAircraftIndicator();
  const camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.1, 10000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -100);
  camera.updateMatrixWorld(true);

  // Position directly in front of camera -> onscreen
  const pos = new THREE.Vector3(0, 0, -50);

  // 1. Onscreen with distance
  indicator.update(pos, 'Wingman', '', camera, { distance: 54 });
  assert.equal(indicator.mode, 'onscreen');
  assert.equal(indicator.label.textContent, 'Wingman · 50 m');

  // 2. Onscreen with km distance and status
  indicator.update(pos, 'Wingman', ' · 일시정지', camera, { distance: 1540 });
  assert.equal(indicator.mode, 'onscreen');
  assert.equal(indicator.label.textContent, 'Wingman · 일시정지 · 1.5 km');

  // 3. Onscreen with undefined distance
  indicator.update(pos, 'Wingman', '', camera, { distance: undefined });
  assert.equal(indicator.mode, 'onscreen');
  assert.equal(indicator.label.textContent, 'Wingman');

  // 4. Offscreen behind camera -> edge marker includes distance
  const rearPos = new THREE.Vector3(0, 0, 50);
  indicator.update(rearPos, 'Wingman', '', camera, { distance: 2500 });
  assert.equal(indicator.mode, 'offscreen');
  assert.equal(indicator.name.textContent, 'Wingman');
  assert.match(indicator.status.textContent, /2\.5 km/);

  indicator.dispose();
});
