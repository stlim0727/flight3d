import test from 'node:test';
import assert from 'node:assert/strict';
import { isExampleTileUrl, OpenWorldTerrain } from '../src/environment/OpenWorldTerrain.js';

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

test('example tile URLs are recognized and not treated as deployable imagery', () => {
  assert.equal(isExampleTileUrl('https://packs.example/santorini/tiles/1.0.0/{z}/{y}/{x}.png'), true);
  assert.equal(isExampleTileUrl('https://raw.githubusercontent.com/example/flight3d-addon/main/tiles/1.0.0/{z}/{y}/{x}.png'), true);
  assert.equal(isExampleTileUrl('https://stlim0727.github.io/flight3d-addons/addons/med/region/santorini/tiles/1.0.0/{z}/{y}/{x}.png'), false);
});
