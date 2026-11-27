import assert from 'node:assert/strict';
import test from 'node:test';
import { ChartTileLayer } from '../src/ui/ChartTileLayer.js';
import { CHART_TILE_LIMIT } from '../src/geospatial/regionalChart.js';

const tile = x => ({ zoom: 7, x, y: 11 });
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const calls = [], decoded = [];
  const layer = new ChartTileLayer({
    getZxy(zoom, x, y, signal) {
      const request = Promise.withResolvers();
      calls.push({ zoom, x, y, signal, ...request });
      return request.promise;
    },
  }, (data, tile) => {
    decoded.push(tile.key);
    return data ?? [];
  });
  const select = (...tiles) => { layer.select(tiles); layer.refresh(performance.now()); };
  return { layer, calls, decoded, select };
}

test('first unfold adopts ready and pending centre tiles, retrying a failed prefetch immediately', async () => {
  const { layer, calls, decoded, select } = fixture();
  layer.prefetch([tile(1), tile(2), tile(3)]);
  calls[0].resolve({ data: ['shore'] });
  calls[2].reject(new Error('offline'));
  await settle();
  select(tile(1), tile(2), tile(3), tile(4));
  assert.deepEqual(layer.visible[0].data, ['shore']);
  assert.deepEqual(calls.map(c => c.x), [1, 2, 3, 3, 4]);
  assert.equal(calls[1].signal.aborted, false);
  // A failure after opening should also get one ordinary foreground attempt.
  calls[1].reject(new Error('timeout'));
  await settle();
  layer.refresh(performance.now());
  assert.deepEqual(calls.map(c => c.x), [1, 2, 3, 3, 4, 2]);
  assert.deepEqual(decoded, ['7/1/11']);
  select();
  assert.equal(calls.at(-1).signal.aborted, true);
});

test('unfold restores decoded tiles synchronously and a neighbouring sheet requests only missing tiles', async () => {
  const { layer, calls, decoded, select } = fixture();
  select(tile(10), tile(11));
  calls[0].resolve({ data: ['west'] });
  calls[1].resolve({ data: ['east'] });
  await settle();
  const east = layer.visible[1].data;
  select();
  select(tile(10), tile(11));
  assert.equal(layer.visible[1].data, east);
  assert.deepEqual(layer.visible.map(e => e.state), ['ready', 'ready']);
  select(tile(11), tile(12));
  assert.equal(layer.visible[0].data, east);
  assert.deepEqual(calls.map(c => c.x), [10, 11, 12]);
  assert.deepEqual(decoded, ['7/10/11', '7/11/11']);
  // Same coordinates at a different zoom belong to a different tile.
  select({ ...tile(11), zoom: 8 });
  assert.equal(calls[3].zoom, 8);
});

test('folding and moving discard late responses, while an overlapping pending request survives the move', async () => {
  const { layer, calls, decoded, select } = fixture();
  select(tile(0));
  select();
  const folded = layer.revision;
  calls[0].resolve({ data: ['old flight'] });
  await settle();
  assert.equal(layer.revision, folded);
  select(tile(0), tile(1));
  select(tile(1), tile(2));
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls[2].signal.aborted, false);
  const moved = layer.revision;
  calls[1].resolve({ data: ['old region'] });
  await settle();
  assert.equal(layer.revision, moved);
  calls[2].resolve({ data: ['shared'] });
  await settle();
  assert.deepEqual(decoded, ['7/1/11']);
  assert.deepEqual(layer.visible.map(e => e.data), [['shared'], undefined]);
});

test('empty ocean tiles stay ready and failed tiles retry while the same sheet stays open', async () => {
  const { layer, calls, select } = fixture();
  select(tile(1), tile(2));
  calls[0].resolve(undefined);
  calls[1].reject(new Error('offline'));
  await settle();
  const [ocean, failed] = layer.visible;
  assert.deepEqual([ocean.state, ocean.data, failed.state], ['ready', [], 'failed']);
  layer.refresh(failed.retryAt - 1);
  assert.equal(calls.length, 2);
  layer.refresh(failed.retryAt);
  layer.refresh(failed.retryAt + 1);
  assert.deepEqual(calls.map(c => c.x), [1, 2, 2]);
  calls[2].resolve({ data: ['restored'] });
  await settle();
  assert.deepEqual([failed.state, failed.data], ['ready', ['restored']]);
});

test('recently visible tiles survive bounded eviction across sheets', async () => {
  const { layer, calls, select } = fixture();
  select(...Array.from({ length: CHART_TILE_LIMIT }, (_, i) => tile(i)));
  for (const request of calls) request.resolve(undefined);
  await settle();
  select(tile(0), tile(CHART_TILE_LIMIT));
  assert.equal(layer.cache.size, CHART_TILE_LIMIT);
  assert.equal(layer.cache.has('7/1/11'), false);
  assert.equal(layer.visible[0].state, 'ready');
});

test('select protects all currently visible tiles when selection exceeds CHART_TILE_LIMIT and aborts evicted loading entries', async () => {
  const { layer, calls, select } = fixture();
  // Seed older non-visible cached entries first.
  select(tile(100), tile(101));
  calls[0].resolve({ data: ['stale-a'] });
  calls[1].resolve({ data: ['stale-b'] });
  await settle();

  // Also ensure an orphaned loading entry evicted via LRU has its controller aborted.
  const orphan = { ...tile(102), key: '7/102/11', state: 'new' };
  layer.cache.set(orphan.key, orphan);
  layer.load(orphan);
  const orphanRequest = calls[2];
  assert.equal(orphan.state, 'loading');
  assert.equal(orphanRequest.signal.aborted, false);

  const wideTiles = Array.from({ length: CHART_TILE_LIMIT + 3 }, (_, i) => tile(i));
  select(...wideTiles);
  assert.equal(layer.cache.size, wideTiles.length);
  assert.equal(layer.cache.has('7/100/11'), false);
  assert.equal(layer.cache.has('7/101/11'), false);
  assert.equal(layer.cache.has('7/102/11'), false);
  assert.equal(orphanRequest.signal.aborted, true);
  assert.ok(layer.visible.every(entry => layer.cache.has(entry.key)));

  // Settle the wide selection so subsequent shrinking exercises LRU eviction rather than loading cancellation.
  for (const request of calls.slice(3)) request.resolve({ data: ['wide'] });
  await settle();
  assert.ok(layer.visible.every(entry => entry.state === 'ready'));

  // Shrinking selection back below CHART_TILE_LIMIT restores the bounded cache cap.
  select(tile(0));
  assert.equal(layer.cache.size, CHART_TILE_LIMIT);
});
