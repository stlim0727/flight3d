import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAirportIndexCache } from '../src/geospatial/airportIndex.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { BASE_OFFSETS } from '../src/world/UnifiedWorld.js';
import { ExternalAirportStreamer } from '../src/world/ExternalAirportStreamer.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ descriptor: initialDescriptor, ...options } = {}) {
  const events = {
    statuses: [], added: [], removed: [], registered: [], unregistered: [], disposed: [],
    loads: [], builds: [],
  };
  const descriptor = initialDescriptor ?? {
    icao: 'RKSS', latitude: 37.448, longitude: 126.455, elevationM: 18,
    runways: [],
  };
  const clock = { time: 1000 };
  const world = {
    anchor: 'incheon',
    offsets: new Map(),
    registerDynamic(id, spec) {
      assert.ok(Array.isArray(spec.baseOffset), 'dynamic baseOffset must be an array');
      events.registered.push([id, spec]);
      const anchor = BASE_OFFSETS[this.anchor];
      this.offsets.set(id, [spec.baseOffset[0] - anchor[0], spec.baseOffset[1] - anchor[1]]);
    },
    incheonFrameToAnchor(x, z) {
      const anchor = BASE_OFFSETS[this.anchor];
      return [x - anchor[0], z - anchor[1]];
    },
    unregister(id) {
      events.unregistered.push(id);
      return this.offsets.delete(id);
    },
  };
  const scene = {
    add(group) { events.added.push(group); },
    remove(group) { events.removed.push(group); },
  };
  const makeRegion = () => ({
    group: { name: 'external-airport' },
    terrain: { isLoaded: true },
    airport: {},
    extent: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    dispose() { events.disposed.push(this); },
  });
  const behavior = {
    async load() { return descriptor; },
    build({ airport, baseOffset, outsideHeight }) {
      return { ...makeRegion(), airport, baseOffset, outsideHeight };
    },
  };
  const streamer = new ExternalAirportStreamer({
    world,
    scene,
    loadAirport(...args) {
      events.loads.push(args);
      return behavior.load(...args);
    },
    buildRegion(options) {
      events.builds.push(options);
      return behavior.build(options);
    },
    onStatus(status) { events.statuses.push(status); },
    now: () => clock.time,
    loadRadiusM: 60000,
    unloadRadiusM: 120000,
    retryDelayMs: 20000,
    ...options,
  });
  return { streamer, world, scene, events, behavior, clock, descriptor, makeRegion };
}

test('only indexed external ICAO codes are considered and reset unmounts', async () => {
  const h = harness();
  h.streamer.setDestination('RKSI');
  assert.deepEqual(h.streamer.status, {
    state: 'idle', code: null, error: null, loaded: false, distanceM: null,
  });
  assert.equal(h.events.loads.length, 0);

  h.streamer.setDestination(' rkss ');
  assert.equal(h.streamer.status.code, 'RKSS');
  assert.equal(await h.streamer.ensure('RKSS'), true);
  assert.equal(h.events.loads[0][0], 'RKSS');
  assert.equal(h.streamer.statusFor('rkss').state, 'ready');
  assert.equal(h.streamer.statusFor('RKSI'), null);

  h.streamer.setDestination('RJTT');
  assert.equal(h.streamer.status.state, 'idle');
  assert.equal(h.streamer.status.code, null);
  assert.equal(h.events.removed.length, 0, 'destination selection alone keeps occupied contact');
  h.streamer.update({ x: 0, z: 0, onGround: false, onRunway: false, destinationCode: 'RJTT' });
  assert.equal(h.events.removed.length, 1);
  assert.deepEqual(h.events.unregistered, ['RKSS']);
  assert.equal(h.events.disposed.length, 1);
  assert.equal(h.world.offsets.has('RKSS'), false);
});

test('concurrent ensures share one load; completions after a destination change are discarded', async () => {
  const h = harness();
  let resolveLoad;
  h.behavior.load = () => new Promise(resolve => { resolveLoad = resolve; });
  h.streamer.setDestination('RKSS');

  const first = h.streamer.ensure('RKSS');
  const second = h.streamer.ensure('RKSS');
  assert.equal(h.events.loads.length, 1);
  assert.equal(h.streamer.status.state, 'loading');

  h.streamer.setDestination(null);
  assert.equal(h.streamer.status.state, 'idle');
  resolveLoad(h.descriptor);
  assert.equal(await first, false);
  assert.equal(await second, false);
  await flush();
  assert.equal(h.events.registered.length, 0);
  assert.equal(h.events.added.length, 0);

  // A region that finishes building after the swap must also be thrown away.
  let resolveBuild;
  h.behavior.load = async () => h.descriptor;
  h.behavior.build = () => new Promise(resolve => { resolveBuild = resolve; });
  h.streamer.setDestination('RKSS');
  const stale = h.streamer.ensure('RKSS');
  await flush();
  assert.equal(h.events.builds.length, 1);
  h.streamer.dispose();
  resolveBuild(h.makeRegion());
  assert.equal(await stale, false);
  assert.equal(h.events.added.length, 0);
  assert.equal(h.events.disposed.length, 1);
  assert.equal(h.streamer.ensure('RKSS'), false);
});

test('failed update loads retry only after the retry delay', async () => {
  const h = harness();
  let calls = 0;
  h.behavior.load = async () => {
    calls += 1;
    if (calls === 1) throw new Error('index offline');
    return h.descriptor;
  };

  h.streamer.setDestination('RKSS');
  h.streamer.update({ x: 0, z: 0, now: 1000 });
  await flush();
  assert.equal(h.streamer.status.state, 'failed');
  assert.match(h.streamer.status.error, /index offline/);
  assert.equal(h.streamer.status.loaded, false);

  h.streamer.update({ x: 0, z: 0, now: 1001 });
  h.streamer.update({ x: 0, z: 0, now: 20999 });
  await flush();
  assert.equal(calls, 1);

  h.streamer.update({ x: 0, z: 0, now: 21000 });
  await flush();
  assert.equal(calls, 2);
  assert.equal(h.streamer.status.state, 'ready');
});

test('on-ground and on-runway keep the region mounted; far airborne unload cleans up', async () => {
  const h = harness();
  assert.equal(await h.streamer.ensure('RKSS'), true);
  assert.deepEqual(h.world.offsets.get('RKSS'), [0, 0]);

  h.streamer.update({ x: 200000, z: 0, onGround: true, now: 1000 });
  assert.equal(h.streamer.status.state, 'ready');
  assert.equal(h.events.removed.length, 0);
  h.streamer.update({ x: 200000, z: 0, onRunway: true, now: 1001 });
  assert.equal(h.streamer.status.state, 'ready');
  assert.equal(h.events.removed.length, 0);

  h.streamer.update({ x: 200000, z: 0, now: 1002 });
  assert.equal(h.streamer.status.state, 'idle');
  assert.equal(h.streamer.status.distanceM, 200000);
  assert.equal(h.streamer.status.loaded, false);
  assert.equal(h.events.removed.length, 1);
  assert.deepEqual(h.events.unregistered, ['RKSS']);
  assert.equal(h.events.disposed.length, 1);
  assert.equal(h.world.offsets.has('RKSS'), false);

  h.streamer.update({ x: 200000, z: 0, now: 1003 });
  assert.equal(h.events.loads.length, 1, 'stored last offset prevents an immediate reload');
});

test('speed expands the load radius and baseOffset is the projected world-frame position', async () => {
  const descriptor = {
    icao: 'RKSS', latitude: 37.51, longitude: 126.94, elevationM: 20, runways: [],
  };
  const h = harness({ descriptor });
  h.world.offsets.set('RKSS', [0, 0]);
  h.streamer.setDestination('RKSS');

  h.streamer.update({ x: 70000, z: 0, speedMps: 0, now: 1000 });
  assert.equal(h.streamer.status.state, 'idle');
  h.streamer.update({ x: 70000, z: 0, speedMps: 50, now: 1001 });
  assert.equal(h.streamer.status.state, 'loading');
  await flush();
  assert.equal(h.streamer.status.state, 'ready');
  assert.deepEqual(h.events.builds[0].baseOffset, projectToLocal(descriptor.latitude, descriptor.longitude));
  assert.equal(h.events.builds[0].outsideHeight, 0);
});

test('status callback reports each transition with a consistent snapshot', async () => {
  const h = harness();
  h.streamer.setDestination('RKSS');
  h.streamer.update({ x: 0, z: 0, now: 1000 });
  await flush();
  h.streamer.update({ x: 200000, z: 0, now: 1001 });

  assert.deepEqual(h.events.statuses.map(status => status.state), ['idle', 'loading', 'ready', 'idle']);
  assert.deepEqual(h.events.statuses.map(status => status.loaded), [false, false, true, false]);
  assert.ok(h.events.statuses.every(status => status.code === 'RKSS'));
  assert.equal(h.events.statuses.at(-1).distanceM, 200000);
  assert.equal(h.events.statuses.at(-1).error, null);
});

test('default loadAirport resolves the ICAO code through the manifest and tile', async () => {
  const requests = [];
  const baseUrl = `https://streamer.test/${Date.now()}/data/airports/`;
  const manifest = {
    schemaVersion: 1, version: 'v1', tileDegrees: 10,
    tiles: { '31-126': true }, icao: { RKSS: '31-126' }, iata: {},
  };
  const tile = {
    schemaVersion: 1, version: 'v1', tile: '31-126',
    airports: [{ id: '1', icao: 'RKSS', latitude: 37.448, longitude: 126.455, elevationM: 18 }],
  };
  const fetchImpl = async url => {
    requests.push(new URL(url).pathname);
    return {
      ok: true, status: 200,
      json: async () => (url.includes('manifest.json') ? manifest : tile),
    };
  };
  const h = harness({ fetchImpl, baseUrl, loadAirport: undefined });
  try {
    assert.equal(await h.streamer.ensure('RKSS'), true);
    assert.ok(requests[0].endsWith('manifest.json'));
    assert.ok(requests[1].endsWith('/v1/tiles/31-126.json'));
    assert.equal(h.events.builds[0].airport.icao, 'RKSS');
  } finally {
    clearAirportIndexCache();
    h.streamer.dispose();
  }
});

test('changing destination while on a runway keeps the occupied region until airborne', async () => {
  const h = harness();
  assert.equal(await h.streamer.ensure('RKSS'), true);
  h.streamer.setDestination(null);
  assert.equal(h.events.unregistered.length, 0, 'selection alone must not remove contact');
  h.streamer.update({ x: 0, z: 0, onGround: true, onRunway: true, destinationCode: null });
  assert.equal(h.events.unregistered.length, 0, 'ground occupancy keeps the region');
  assert.equal(h.events.removed.length, 0);
  h.streamer.update({ x: 0, z: 0, onGround: false, onRunway: false, destinationCode: null });
  assert.deepEqual(h.events.unregistered, ['RKSS']);
  assert.equal(h.events.removed.length, 1);
  assert.equal(h.events.disposed.length, 1);
});

test('reselecting the occupied airport cancels retirement without unmounting', async () => {
  const h = harness();
  assert.equal(await h.streamer.ensure('RKSS'), true);
  h.streamer.setDestination(null);
  assert.equal(h.events.unregistered.length, 0);
  h.streamer.setDestination('RKSS');
  assert.equal(h.events.unregistered.length, 0, 'reselect keeps the same contact surface');
  assert.equal(h.events.removed.length, 0);
  assert.equal(h.streamer.statusFor('RKSS').state, 'ready');
  h.streamer.update({ x: 0, z: 0, onGround: true, onRunway: true, destinationCode: 'RKSS' });
  assert.equal(h.events.unregistered.length, 0, 'ground update does not retire reselected region');
});

test('an unloaded destination is rebased when the spawn anchor changes', async () => {
  const h = harness({
    descriptor: {
      icao: 'RKSS', latitude: 37.5583, longitude: 126.791, elevationM: 18, runways: [],
    },
  });
  h.world.anchor = 'jeju';
  assert.equal(await h.streamer.ensure('RKSS'), true);
  const [baseX, baseZ] = projectToLocal(37.5583, 126.791);
  h.streamer.update({
    x: baseX - BASE_OFFSETS.jeju[0] + 200000,
    z: baseZ - BASE_OFFSETS.jeju[1],
    onGround: false, onRunway: false, destinationCode: 'RKSS',
  });
  assert.deepEqual(h.events.unregistered, ['RKSS']);
  assert.equal(h.events.loads.length, 1);

  h.world.anchor = 'incheon';
  h.streamer.update({
    x: baseX, z: baseZ, onGround: false, onRunway: false, destinationCode: 'RKSS',
  });
  await flush();
  assert.equal(h.events.loads.length, 2, 'near the real destination a new load starts');
  assert.equal(h.streamer.statusFor('RKSS').state, 'ready');
});
