import assert from 'node:assert/strict';
import test from 'node:test';
import { AIRPORT_ORIGINS } from '../src/geospatial/airportGeodesy.js';
import { REGIONAL_CRUISES } from '../src/config/regionalCruises.js';
import { installSimulatorHudAndBindings } from '../src/ui/SimulatorHudAndBindings.js';

test('closed paper warms once after startup and drops obsolete idle work', t => {
  class Sim {}
  installSimulatorHudAndBindings(Sim);
  const sim = new Sim();
  const idle = [], requests = [], selections = [];
  const originalWindow = globalThis.window;
  t.after(() => { globalThis.window = originalWindow; });
  globalThis.window = { requestIdleCallback: fn => idle.push(fn) };
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  Object.assign(sim, {
    world: { activeOrigin: AIRPORT_ORIGINS.incheon, anchor: 'incheon' },
    position: { x: 0, z: 0 }, gameFlow: { state: 'flight' },
    regionalChart: { water: { prefetch: tiles => requests.push(tiles), select: tiles => selections.push(tiles) } },
  });
  const map = { open: false };
  const tick = (busan = false) => sim.updateChartPrefetch(map, sim.world.activeOrigin, busan, map.open);
  tick();
  assert.equal(idle.length, 0);
  now += 3000;
  tick();
  sim.updateChartPrefetch(map, null, false, false);
  idle.shift()();
  assert.equal(requests.length, 0);

  tick();
  now += 3000;
  tick();
  map.open = true;
  tick();
  map.open = false;
  idle.shift()();
  assert.equal(requests.length, 0);

  sim.world.activeOrigin = REGIONAL_CRUISES.busan;
  tick(true);
  now += 3000;
  tick(true);
  idle.shift()();
  assert.equal(requests.length, 0);
  sim.world.activeOrigin = AIRPORT_ORIGINS.incheon;
  tick();
  now += 3000;
  tick();
  idle.shift()();
  tick();
  assert.equal(idle.length, 0);
  assert.deepEqual(requests.map(tiles => tiles.length), [2]);
  sim.updateChartPrefetch(map, null, false, false);
  assert.deepEqual(selections.at(-1), []);
});
