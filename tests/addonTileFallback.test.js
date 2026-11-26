import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveProfile } from '../src/addons/addonContract.js';
import { regionPackFromProfile } from '../src/addons/regionPackBinding.js';
import { TileCacheManager } from '../src/environment/TileCacheManager.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('a pinned external pack supplies the tile URL and failed tiles fall back to null', async () => {
  const manifest = {
    schemaVersion: 1,
    id: 'poc/region/fallback-bay',
    publisher: 'poc',
    version: '0.3.1',
    coreRange: { min: '1.0.0', maxExclusive: '2.0.0' },
    dependencies: [],
    license: 'CC-BY-4.0',
    attribution: 'POC',
    region: {
      bounds: { west: 126.4, south: 34.2, east: 126.6, north: 34.4 },
      origin: { latitude: 34.3, longitude: 126.5 },
      verticalDatum: 'EGM2008',
      tiles: {
        format: 'xyz-image', url: 'https://packs.example/fallback/{z}/{y}/{x}.png',
        checksum: hash('tiles'), minZoom: 8, maxZoom: 14,
      },
    },
  };
  const catalog = {
    schemaVersion: 1,
    addons: [{ id: manifest.id, version: manifest.version, url: 'https://packs.example/addon.json', sha256: hash(manifest) }],
  };
  const profile = await resolveProfile(catalog, [manifest.id], {
    coreVersion: '1.8.0',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify(manifest)) }),
  });
  const binding = regionPackFromProfile(profile, manifest.id, { coreVersion: '1.8.0' });
  const manager = new TileCacheManager({ ...binding.cacheOptions, enableBrowserCache: false, timeoutMs: 10 });
  const requested = [];
  manager._fetchTile = async (z, x, y) => {
    requested.push(manager.getTileUrl(z, x, y));
    throw new Error('tile offline');
  };

  assert.equal(await manager.getTileImage(10, 12, 34), null);
  assert.deepEqual(requested, ['https://packs.example/fallback/0.3.1/10/34/12.png']);
  assert.equal(manager.getMetrics().errors, 1);
  manager.dispose();
});
