import assert from 'node:assert/strict';
import test from 'node:test';
import { overtureBase } from '../src/geospatial/overtureWater.js';
import { BusanChart } from '../src/ui/BusanChart.js';

test('reopening reuses decoded tiles, retries interrupted tiles and bounds retained paths', async t => {
  class Path {
    addPath = t.mock.fn();
    moveTo() {}
    lineTo() {}
    closePath() {}
  }
  const originalPath = globalThis.Path2D;
  globalThis.Path2D = Path;
  t.after(() => {
    if (originalPath === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = originalPath;
  });
  const map = new EventTarget();
  map.querySelector = () => new EventTarget();
  const chart = new BusanChart(map);
  function open() {
    map.open = true;
    chart.controller = new AbortController();
    chart.paths = Object.fromEntries(['land', 'water', 'decks', 'spans'].map(k => [k, new Path()]));
  }
  const stale = Promise.withResolvers();
  const tile = { data: new Uint8Array() };
  const requests = t.mock.method(overtureBase, 'getZxy', async () => tile);
  open();
  chart.tile(7031, 3240, 0);
  requests.mock.mockImplementationOnce(() => stale.promise);
  chart.tile(7032, 3240, 0);
  await Promise.resolve();
  const land = chart.paths.land.addPath.mock.calls[0].arguments[0];
  map.open = false;
  map.dispatchEvent(new Event('toggle'));
  assert.ok(requests.mock.calls[1].arguments[3].aborted);

  open();
  assert.ok(chart.tile(7031, 3240, 0).ready);
  assert.equal(chart.paths.land.addPath.mock.calls[0].arguments[0], land);
  chart.tile(7031, 3240, 1);
  assert.equal(chart.paths.land.addPath.mock.callCount(), 1);
  assert.equal(requests.mock.callCount(), 2);
  assert.ok(!chart.tile(7032, 3240, 0).ready);
  await Promise.resolve();
  stale.resolve(tile);
  await Promise.resolve();
  assert.equal(chart.paths.land.addPath.mock.callCount(), 2);
  assert.equal(requests.mock.callCount(), 3);

  for (let x = 7033; x <= 7100; x++) chart.tile(x, 3240, 0);
  await Promise.resolve();
  map.open = false;
  map.dispatchEvent(new Event('toggle'));
  open();
  assert.ok(chart.tile(7100, 3240, 0).ready);
  assert.ok(!chart.tile(7031, 3240, 0).ready);
  await Promise.resolve();
});
