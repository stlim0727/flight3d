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
