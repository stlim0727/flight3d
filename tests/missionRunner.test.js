import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionRunner } from '../src/arena/MissionRunner.js';
import { createMissionManifest } from '../src/arena/missionConfig.js';

const command = { elevator: 0.2, aileron: 0, rudder: 0, throttle: 1, brakes: 0 };
function fixture() {
  const events = [], manifest = createMissionManifest('takeoff');
  const adapter = {
    tick: 0, releases: 0,
    async prepare() { return { manifest }; },
    acquire() { events.push('acquire'); },
    apply(c) { events.push(['apply', this.tick, c]); },
    step() { this.tick++; },
    release() { this.releases++; },
    snapshot(tick) {
      const grounded = tick < 25;
      return { tick, iasKnots: 160, groundSpeedKnots: 160, pitchDeg: 3, rollDeg: 0,
        headingDeg: 90, vsiFpm: 0, radioAltFt: 400, altitudeFt: 440,
        runwayS: 50, centerlineOffsetM: 0, heightAboveRunwayM: 120,
        weightOnWheels: grounded, crashed: false, damaged: false, bodyContact: false,
        elevator: 0, aileron: 0, rudder: 0, throttle: 1, brakes: 0,
        gearContacts: ['nose', 'mainLeft', 'mainRight'].map(id => ({ id, grounded,
          runwayS: 50, centerlineOffsetM: 0, sinkRateMs: 0 })) };
    },
  };
  const host = { async start() {}, async tick(obs, meta) {
    events.push(['sample', meta.sampleTick, adapter.tick]);
    return command;
  }, stop() { events.push('stop'); } };
  return { adapter, host, events };
}

test('runner applies one-period delayed controls and judges every physics step', async () => {
  const { adapter, host, events } = fixture();
  const runner = new MissionRunner(adapter, { hostFactory: () => host, yieldFrame: async () => {} });
  const record = await runner.start('source');
  assert.equal(record.status, 'succeeded');
  assert.equal(record.tick, 1224);
  assert.equal(adapter.releases, 1);
  assert.match(record.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(events.filter(e => Array.isArray(e)).slice(0, 3), [
    ['sample', 0, 0], ['apply', 24, command], ['sample', 24, 24],
  ]);
  for (const item of record.commands) assert.equal(item.applyTick - item.sampleTick, 24);
});

test('takeover during worker wait prevents delayed command or physics advancement', async () => {
  const { adapter, host, events } = fixture();
  let finish;
  host.tick = () => new Promise(resolve => { finish = resolve; });
  const runner = new MissionRunner(adapter, { hostFactory: () => host });
  const running = runner.start('source');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  runner.stop();
  finish(command);
  const result = await running;
  assert.equal(result.status, 'aborted');
  assert.equal(adapter.tick, 0);
  assert.equal(adapter.releases, 1);
  assert.equal(events.some(e => Array.isArray(e) && e[0] === 'apply'), false);
});

test('runtime failure terminates the run and releases flight control', async () => {
  const { adapter, host } = fixture();
  host.tick = async () => { throw new Error('pilot-timeout'); };
  const runner = new MissionRunner(adapter, { hostFactory: () => host });
  const record = await runner.start('source');
  assert.equal(record.status, 'failed');
  assert.equal(record.detail, 'pilot-timeout');
  assert.equal(adapter.tick, 0);
  assert.equal(adapter.releases, 1);
});

test('manual takeover during a real-time frame wait prevents the next physics step', async () => {
  const { adapter, host } = fixture();
  const runner = new MissionRunner(adapter, { hostFactory: () => host,
    paceTick: async tick => { if (tick === 4) runner.stop(); } });
  const record = await runner.start('source');
  assert.equal(record.status, 'aborted');
  assert.equal(adapter.tick, 3);
  assert.equal(adapter.releases, 1);
});

test('stop during preparation aborts the signal and prevents late acquisition', async () => {
  const { adapter, host, events } = fixture();
  let finish, signal;
  adapter.prepare = options => {
    signal = options.signal;
    return new Promise(resolve => { finish = () => resolve({ manifest: createMissionManifest('takeoff') }); });
  };
  const runner = new MissionRunner(adapter, { hostFactory: () => host });
  const promise = runner.start('source');
  runner.stop('flight-held');
  assert.equal(signal.aborted, true);
  await assert.rejects(runner.start('new source'), /stopping/);
  finish();
  const record = await promise;
  assert.equal(record.status, 'aborted');
  assert.equal(events.includes('acquire'), false);
});

test('stopped startup cannot revive and its promise retains the old record', async () => {
  const { adapter, host } = fixture();
  let finish;
  host.start = () => new Promise(resolve => { finish = resolve; });
  const runner = new MissionRunner(adapter, { hostFactory: () => host });
  const promise = runner.start('old source');
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const oldRecord = runner.record;
  runner.stop('flight-held');
  runner.record = { status: 'new-record' };
  finish();
  assert.equal(await promise, oldRecord);
  assert.equal(adapter.tick, 0);
});

test('a stopped run completing its hashes cannot overwrite a replacement run record', async t => {
  const { adapter, host } = fixture();
  adapter.prepare = async ({ seed }) => ({ manifest: createMissionManifest('takeoff', { environmentSeed: seed }) });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let finishOldHash, finishNewTick;
  let calls = 0;
  t.mock.method(crypto.subtle, 'digest', (algorithm, bytes) => {
    if (calls++ === 0) return new Promise(resolve => { finishOldHash = resolve; });
    return digest(algorithm, bytes);
  });
  host.tick = () => new Promise(resolve => { finishNewTick = resolve; });
  const runner = new MissionRunner(adapter, { hostFactory: () => host });
  const oldPromise = runner.start('old source', { seed: 1 });
  while (!finishOldHash) await new Promise(resolve => setImmediate(resolve));
  const oldRecord = runner.record;
  runner.stop();
  const newPromise = runner.start('new source', { seed: 2 });
  while (!finishNewTick) await new Promise(resolve => setImmediate(resolve));
  const newRecord = runner.record;
  const expected = newRecord.manifestHash;
  finishOldHash(new ArrayBuffer(32));
  assert.equal(await oldPromise, oldRecord);
  assert.equal(runner.record, newRecord);
  assert.equal(newRecord.manifest.environmentSeed, 2);
  assert.equal(newRecord.manifestHash, expected);
  assert.notEqual(oldRecord.manifestHash, newRecord.manifestHash);
  runner.stop(); finishNewTick(command);
  await newPromise;
});
