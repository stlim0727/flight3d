import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { HudView } from '../src/ui/HudView.js';

test('target symbols follow line of sight across viewport exits, rear view and re-entry', () => {
  const labels = [], locators = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText'
    ? (...args) => labels.push(args) : () => {} });
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx, sim: { camera: new PerspectiveCamera(60, 16 / 9), quaternion: new Quaternion() },
    _hudInverse: new Quaternion(), _hudPoint: new Vector3(), _hudForward: new Vector3(),
    drawGunSight() {}, drawRwr() {}, drawTargetLocator(screen) { locators.push(screen); },
  });
  const target = { callsign: 'BANDIT', position: new Vector3() };
  const state = { selectedTarget: target, rangeM: 1000, remaining: 0, total: 0, splash: 0 };
  for (const locked of [false, true]) {
    state.locked = locked;
    for (const [x, y, z, visible] of [[0, 0, -100, true], [100, 0, -100, true],
      [110, 0, -100, false], [0, 80, -100, false], [0, -80, -100, false],
      [0, 0, 100, false], [0, 0, -100, true]]) {
      labels.length = locators.length = 0;
      target.position.set(x, y, z);
      hud.drawCombat(1600, 900, 1, state, true);
      const label = labels.find(([text]) => text.startsWith('BANDIT'));
      assert.equal(Boolean(label), visible, `${x},${y},${z}, locked=${locked}`);
      assert.equal(locators.length, visible ? 0 : 1);
      if (visible) assert.equal(label[1], hud.projectWorld(target.position, 1600, 900).x);
    }
  }
});

test('offscreen locator points toward projected elevation as well as azimuth', () => {
  const rotations = [];
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx: new Proxy({}, { get: (_, key) => key === 'rotate' ? a => rotations.push(a) : () => {} }),
  });
  for (const [x, y, expected] of [[800, -100, 0], [1700, 450, Math.PI / 2],
    [800, 1000, Math.PI], [-100, 450, -Math.PI / 2]]) {
    hud.drawTargetLocator({ x, y, behind: false, angle: 0 }, 1600, 900, 1, {}, 'red');
    assert.equal(rotations.at(-1), expected);
  }
});

test('offscreen locator respects the 15 km distance radius', () => {
  const locators = [];
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx: new Proxy({}, { get: () => () => {} }),
    sim: { camera: new PerspectiveCamera(60, 16 / 9), quaternion: new Quaternion() },
    _hudInverse: new Quaternion(), _hudPoint: new Vector3(), _hudForward: new Vector3(),
    drawGunSight() {}, drawRwr() {}, drawTargetLocator(screen) { locators.push(screen); },
  });
  const target = { callsign: 'BANDIT', position: new Vector3(0, 0, 100) }; // offscreen (behind)
  const state = { selectedTarget: target, remaining: 0, total: 0, splash: 0 };

  // Within 15 km -> locator arrow drawn
  state.rangeM = 14900;
  locators.length = 0;
  hud.drawCombat(1600, 900, 1, state, true);
  assert.equal(locators.length, 1, 'draws locator within 15 km');

  // Exactly 15 km -> locator arrow drawn
  state.rangeM = 15000;
  locators.length = 0;
  hud.drawCombat(1600, 900, 1, state, true);
  assert.equal(locators.length, 1, 'draws locator at 15 km boundary');

  // Beyond 15 km -> locator arrow omitted
  state.rangeM = 15001;
  locators.length = 0;
  hud.drawCombat(1600, 900, 1, state, true);
  assert.equal(locators.length, 0, 'omits locator beyond 15 km');
});

test('offscreen locator pads boundary to stay clear of top and bottom UI bars', () => {
  const translations = [];
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx: new Proxy({}, { get: (_, key) => key === 'translate' ? (x, y) => translations.push({ x, y }) : () => {} }),
  });
  const width = 1600, height = 900, scale = 1;

  // Upwards (toward top bar)
  hud.drawTargetLocator({ x: 800, y: -200, behind: false, angle: 0 }, width, height, scale, {}, 'red');
  const up = translations.at(-1);
  assert.ok(up.y >= 64, `expected y >= 64 (top bar clearance), got ${up.y}`);

  // Downwards (toward bottom toolbar)
  hud.drawTargetLocator({ x: 800, y: 1200, behind: false, angle: Math.PI }, width, height, scale, {}, 'red');
  const down = translations.at(-1);
  assert.ok(down.y <= height - 72, `expected y <= ${height - 72} (bottom toolbar clearance), got ${down.y}`);

  // Left and right edges
  hud.drawTargetLocator({ x: -200, y: 450, behind: false, angle: -Math.PI / 2 }, width, height, scale, {}, 'red');
  const left = translations.at(-1);
  assert.ok(left.x >= 36, `expected x >= 36, got ${left.x}`);

  hud.drawTargetLocator({ x: 1900, y: 450, behind: false, angle: Math.PI / 2 }, width, height, scale, {}, 'red');
  const right = translations.at(-1);
  assert.ok(right.x <= width - 36, `expected x <= ${width - 36}, got ${right.x}`);
});

test('drawTargetLocator directs drawing to arrowCtx on top layer when available', () => {
  let mainCtxUsed = false;
  let arrowCtxUsed = false;
  const hud = Object.assign(Object.create(HudView.prototype), {
    ctx: new Proxy({}, { get: () => () => { mainCtxUsed = true; } }),
    arrowCtx: new Proxy({}, { get: () => () => { arrowCtxUsed = true; } }),
  });
  hud.drawTargetLocator({ x: 800, y: -200, behind: false, angle: 0 }, 1600, 900, 1, {}, 'red');
  assert.equal(arrowCtxUsed, true, 'draws to arrowCtx');
  assert.equal(mainCtxUsed, false, 'does not fall back to mainCtx when arrowCtx is available');
});
