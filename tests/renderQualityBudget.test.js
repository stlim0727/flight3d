import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRenderQuality, renderPixelRatio, RENDER_QUALITY } from '../src/config/renderQuality.js';

test('capability defaults preserve every explicit preset', () => {
  for (const quality of Object.keys(RENDER_QUALITY)) {
    assert.equal(initialRenderQuality(quality, { coarsePointer: true, deviceMemory: 2 }), quality);
  }
  assert.equal(initialRenderQuality(null), 'balanced');
  assert.equal(initialRenderQuality('invalid', { coarsePointer: true }), 'performance');
  assert.equal(initialRenderQuality(null, { deviceMemory: 4 }), 'performance');
  for (const deviceMemory of [0, -1, NaN, undefined, 8]) {
    assert.equal(initialRenderQuality(null, { deviceMemory }), 'balanced');
  }
});

test('all framebuffer budgets hold across desktop, portrait, and high density displays', () => {
  for (const [quality, preset] of Object.entries(RENDER_QUALITY)) {
    for (const [width, height] of [[390, 844], [1920, 1080], [3840, 2160], [7680, 4320]]) {
      for (const dpr of [0.5, 1, 2, 3]) {
        const ratio = renderPixelRatio(quality, width, height, dpr);
        assert.ok(ratio > 0 && ratio <= dpr && ratio <= preset.maxDpr);
        assert.ok(width * height * ratio ** 2 <= preset.maxPixels + 1e-6);
        assert.equal(ratio, renderPixelRatio(quality, height, width, dpr));
      }
    }
  }
});

test('resize and quality transitions restore clarity within each budget', () => {
  assert.equal(renderPixelRatio('balanced', 780, 437, 2), 1.5);
  assert.equal(renderPixelRatio('balanced', 3840, 2160, 2), 2 / 3);
  assert.equal(renderPixelRatio('high', 3840, 2160, 2), 1);
  assert.equal(renderPixelRatio('balanced', 780, 437, 1), 1);
  assert.equal(renderPixelRatio('balanced', 780, 437, 2), 1.5);
  assert.equal(renderPixelRatio('performance', 390, 844, 3), 1);
});

test('lower tiers reduce real geometry and framebuffer work', () => {
  const tiers = ['high', 'balanced', 'performance', 'ultraLow'];
  for (let i = 1; i < tiers.length; i++) {
    const previous = RENDER_QUALITY[tiers[i - 1]];
    const current = RENDER_QUALITY[tiers[i]];
    assert.ok(current.terrainSegments < previous.terrainSegments, `${tiers[i]} terrain density`);
    assert.ok(current.waterSegments < previous.waterSegments, `${tiers[i]} water density`);
    assert.ok(current.maxPixels <= previous.maxPixels, `${tiers[i]} framebuffer budget`);
  }
  const balanced = renderPixelRatio('balanced', 1440, 900, 1);
  const performance = renderPixelRatio('performance', 1440, 900, 1);
  assert.ok(performance < balanced, 'performance renders fewer physical pixels on a 1440x900 desktop');
  assert.ok(performance >= 0.75 && performance <= 0.9);
});

test('missing dimensions and invalid DPR remain finite', () => {
  for (const dpr of [NaN, Infinity, 0, -1]) {
    assert.equal(renderPixelRatio('invalid', 390, 844, dpr), 1);
  }
  assert.equal(renderPixelRatio('balanced', 0, 0, 2), 1.5);
});

test('F16 framebuffer never grows when dropping quality at a fixed viewport', () => {
  for (const [width, height] of [[390, 844], [1280, 720], [1440, 900], [3840, 2160], [7680, 4320]]) {
    for (const dpr of [0.5, 1, 1.5, 2, 3]) {
      let previous = Infinity;
      for (const quality of Object.keys(RENDER_QUALITY)) {
        const ratio = renderPixelRatio(quality, width, height, dpr, 'F16');
        assert.ok(ratio <= previous, `${quality}: ${width}x${height} at DPR ${dpr}`);
        const standard = renderPixelRatio(quality, width, height, dpr);
        assert.equal(renderPixelRatio(quality, width, height, dpr, 'B738'), standard);
        if (quality === 'high') assert.equal(ratio, standard);
        if (quality === 'balanced') assert.equal(ratio, standard * .85);
        previous = ratio;
      }
    }
  }
  assert.equal(renderPixelRatio('performance', 1280, 720, 1, 'F16'), .85);
  assert.equal(renderPixelRatio('ultraLow', 1440, 900, 1, 'F16'), .75);
});
