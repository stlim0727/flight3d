import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertHardwareDraw } from '../scripts/verify-browser-gpu.mjs';

const hardware = { webgl2: true, renderer: 'ANGLE (Intel, Vulkan Intel(R) Graphics (ADL-N))',
  pixel: [255, 0, 0, 255], error: 0 };
test('GPU gate accepts hardware only after verified shader drawing', () => {
  assert.doesNotThrow(() => assertHardwareDraw(hardware));
});
test('software, missing metadata, empty evidence and failed drawing cannot pass', () => {
  for (const renderer of ['SwiftShader', 'llvmpipe', 'softpipe', 'lavapipe',
    'ANGLE (Google, Vulkan SwiftShader Device)', 'Microsoft Basic Render Driver', '', null, 'ANGLE']) {
    assert.throws(() => assertHardwareDraw({ ...hardware, renderer }));
  }
  for (const report of [undefined, {}, { ...hardware, webgl2: false },
    { ...hardware, pixel: [0, 0, 255, 255] }, { ...hardware, pixel: [] },
    { ...hardware, pixel: undefined }, { ...hardware, error: 1282 }]) {
    assert.throws(() => assertHardwareDraw(report));
  }
});
