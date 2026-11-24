import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RasterRegionSurface } from '../src/environment/RasterRegionSurface.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';

const config = REGION_SURFACES.lukla;

test('DEM loading exposes terminal failures and can recover on an explicit retry', async t => {
  const previousWindow = globalThis.window;
  globalThis.window = { fetch: true };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  t.mock.method(console, 'warn', () => {});
  for (const [name, response, error] of [
    ['HTTP error', async () => ({ ok: false, status: 503 }), /HTTP 503/],
    ['network rejection', async () => { throw new Error('Network unavailable'); }, /Network unavailable/],
    ['invalid grid', async () => ({ ok: true, arrayBuffer: async () => new Float32Array([1]).buffer }),
      /Invalid DEM grid/]
  ]) {
    await t.test(name, async st => {
      const surface = new RasterRegionSurface(config, { load: false });
      // Keep this test about DEM loading; imagery uses a separate loader.
      surface.imageryUrl = '';
      let loadedCallbacks = 0;
      surface.onLoaded = () => { loadedCallbacks += 1; };

      await surface.loadAssets(response);
      assert.equal(surface.isLoaded, false);
      assert.match(surface.loadError, error);
      assert.equal(loadedCallbacks, 0);

      const recover = async () => ({
        ok: true,
        arrayBuffer: async () => new Float32Array(config.gridSize * config.gridSize)
          .fill(config.runway.midElevationM).buffer,
      });
      await surface.loadAssets(recover);
      assert.equal(surface.isLoaded, true);
      assert.equal(surface.loadError, null);
      assert.equal(loadedCallbacks, 1);
      assert.equal(surface.getNaturalHeight(0, 0), config.runway.midElevationM);
      surface.dispose();
    });
  }
});
