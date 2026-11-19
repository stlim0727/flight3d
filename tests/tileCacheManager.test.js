import test from 'node:test';
import assert from 'node:assert/strict';
import { TileCacheManager } from '../src/environment/TileCacheManager.js';

test('TileCacheManager constructs valid URL from template', () => {
  const manager = new TileCacheManager();
  const url = manager.getTileUrl(10, 871, 410);
  assert.equal(url, 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/10/410/871');
});

test('TileCacheManager provides in-memory LRU caching and metrics', async () => {
  const manager = new TileCacheManager({ maxMemoryTiles: 3 });

  // Mock _fetchTile
  let fetchCount = 0;
  manager._fetchTile = async (z, x, y, key) => {
    fetchCount++;
    const img = { width: 256, height: 256, key };
    manager._storeInMemory(key, img);
    return img;
  };

  // Request tile 1
  const t1 = await manager.getTileImage(10, 1, 1);
  assert.equal(fetchCount, 1);
  assert.equal(t1.key, '10/1/1');

  // Request tile 1 again (Cache hit)
  const t1Hit = await manager.getTileImage(10, 1, 1);
  assert.equal(fetchCount, 1, 'Should hit cache without refetching');
  assert.equal(t1Hit, t1);

  // Fill up cache to trigger LRU eviction (limit 3)
  await manager.getTileImage(10, 2, 2);
  await manager.getTileImage(10, 3, 3);
  const metricsBeforeEviction = manager.getMetrics();
  assert.equal(metricsBeforeEviction.cachedTilesCount, 3);

  // Adding 4th tile should evict the oldest tile (10/1/1 was refreshed, so oldest is 10/2/2 or similar)
  await manager.getTileImage(10, 4, 4);
  const metricsAfterEviction = manager.getMetrics();
  assert.equal(metricsAfterEviction.cachedTilesCount, 3);

  // Metrics validation
  assert.equal(manager.getMetrics().estimatedMemoryBytes, 3 * 256 * 256 * 4);
});

test('TileCacheManager de-duplicates concurrent in-flight requests', async () => {
  const manager = new TileCacheManager();
  let networkCalls = 0;

  manager._fetchTile = async (z, x, y, key) => {
    networkCalls++;
    await new Promise(r => setTimeout(r, 20));
    const img = { width: 256, height: 256, key };
    manager._storeInMemory(key, img);
    return img;
  };

  // Launch 3 simultaneous requests for the exact same tile
  const [res1, res2, res3] = await Promise.all([
    manager.getTileImage(13, 6974, 3285),
    manager.getTileImage(13, 6974, 3285),
    manager.getTileImage(13, 6974, 3285),
  ]);

  assert.equal(networkCalls, 1, 'Concurrent requests must be de-duplicated into single fetch');
  assert.equal(res1, res2);
  assert.equal(res2, res3);
});

test('TileCacheManager gracefully falls back on error without throwing', async () => {
  const manager = new TileCacheManager();

  manager._fetchTile = async () => {
    throw new Error('Network offline or 404');
  };

  const result = await manager.getTileImage(10, 999, 999);
  assert.equal(result, null, 'Must resolve null on error, never crash');
  assert.equal(manager.getMetrics().errors, 1);
});

test('TileCacheManager dispose clears memory and state', () => {
  const manager = new TileCacheManager();
  manager._storeInMemory('1/1/1', { width: 256, height: 256 });
  assert.equal(manager.getMetrics().cachedTilesCount, 1);

  manager.dispose();
  assert.equal(manager.getMetrics().cachedTilesCount, 0);
  assert.equal(manager.getMetrics().inFlightCount, 0);
});
