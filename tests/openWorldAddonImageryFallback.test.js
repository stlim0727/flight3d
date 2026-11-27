import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';

test('a failed pinned imagery tile falls back to the default satellite cache', async () => {
  const requested = [];
  const fallback = {
    getTileImage: async (level, x, y) => {
      requested.push([level, x, y]);
      return { fallback: true };
    },
    dispose() {},
  };
  const packed = { getTileImage: async () => null, dispose() {} };
  const terrain = Object.create(OpenWorldTerrain.prototype);
  terrain.imageryCache = packed;
  terrain.fallbackImageryCache = fallback;
  assert.deepEqual(await terrain.getImagery(11, 1373, 2016), { fallback: true });
  assert.deepEqual(requested, [[11, 1373, 2016]]);
});
