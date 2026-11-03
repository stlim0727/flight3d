import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeUiScale,
  applyUiScale,
  initUiScale,
  BASE_VIEWPORT_WIDTH,
  BASE_VIEWPORT_HEIGHT,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
} from '../src/ui/UiScale.js';

test('computeUiScale returns 1.0 for standard 1080p desktop', () => {
  const scale = computeUiScale(1920, 1080);
  assert.equal(scale, 1.0);
});

test('computeUiScale scales proportionally for 1440p (QHD) display', () => {
  const scale = computeUiScale(2560, 1440);
  assert.equal(scale, 1.333);
});

test('computeUiScale returns 2.0 for 4K (UHD) display', () => {
  const scale = computeUiScale(3840, 2160);
  assert.equal(scale, 2.0);
});

test('computeUiScale clamps to MAX_UI_SCALE on 5K+ displays', () => {
  const scale = computeUiScale(5120, 2880);
  assert.equal(scale, MAX_UI_SCALE);
});

test('computeUiScale constrains ultra-wide viewports by height to prevent vertical overflow', () => {
  // 3440x1440 ultrawide has width ratio 1.79, but height ratio 1.333
  const scale = computeUiScale(3440, 1440);
  assert.equal(scale, 1.333);
});

test('computeUiScale preserves 1.0 on mobile and tablet viewports (width <= 1024)', () => {
  assert.equal(computeUiScale(390, 844), 1.0); // Mobile phone
  assert.equal(computeUiScale(768, 1024), 1.0); // iPad portrait
  assert.equal(computeUiScale(1024, 768), 1.0); // iPad landscape
});

test('computeUiScale does not scale below 1.0 on smaller desktop screens', () => {
  assert.equal(computeUiScale(1366, 768), 1.0);
  assert.equal(computeUiScale(1600, 900), 1.0);
});

test('computeUiScale safely handles invalid, zero or negative inputs', () => {
  assert.equal(computeUiScale(0, 0), MIN_UI_SCALE);
  assert.equal(computeUiScale(-1920, -1080), MIN_UI_SCALE);
  assert.equal(computeUiScale(NaN, 1080), MIN_UI_SCALE);
  assert.equal(computeUiScale(undefined, null), MIN_UI_SCALE);
});

test('applyUiScale sets --ui-scale CSS property on target element', () => {
  const mockStyle = {
    properties: {},
    setProperty(key, val) {
      this.properties[key] = val;
    },
  };
  const mockRoot = { style: mockStyle };

  applyUiScale(1.5, mockRoot);
  assert.equal(mockStyle.properties['--ui-scale'], '1.5');
});

test('initUiScale sets initial scale and updates on window resize', () => {
  const listeners = {};
  const mockStyle = {
    properties: {},
    setProperty(key, val) {
      this.properties[key] = val;
    },
  };
  const mockWindow = {
    innerWidth: 2560,
    innerHeight: 1440,
    document: {
      documentElement: { style: mockStyle },
    },
    addEventListener(evt, fn) {
      listeners[evt] = fn;
    },
  };

  const update = initUiScale(mockWindow);
  assert.equal(mockStyle.properties['--ui-scale'], '1.333');

  mockWindow.innerWidth = 3840;
  mockWindow.innerHeight = 2160;
  listeners.resize();
  assert.equal(mockStyle.properties['--ui-scale'], '2');
});
