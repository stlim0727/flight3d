import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PilotHost } from '../src/pilot/PilotHost.js';
import { createPilotRuntime } from '../src/pilot/pilot.worker.js';
import { createEnvelope, PILOT_LIMITS } from '../src/pilot/PilotProtocol.js';

const command = { elevator: 0.1, aileron: 0, rudder: 0, throttle: 0.7, brakes: 0 };
const source = 'export function createPilot() {}';

class FakeWorker {
  constructor(module = { createPilot: () => ({ reset() {}, onTick: () => command }) }) {
    this.sent = [];
    this.terminated = false;
    this.receive = createPilotRuntime({
      send: data => queueMicrotask(() => this.onmessage?.({ data })),
      loadModule: async () => module,
    });
  }
  postMessage(message) {
    this.sent.push(message);
    if (!this.silent) queueMicrotask(() => this.receive(message));
  }
  terminate() { this.terminated = true; }
}

function setup(module, options = {}) {
  const worker = new FakeWorker(module);
  const host = new PilotHost({ workerFactory: () => worker, ...options });
  return { host, worker };
}

describe('trusted local PilotHost lifecycle', () => {
  it('transports allowed payload depth and byte boundaries through the actual runtime', async () => {
    let nested = 1;
    for (let i = 0; i < PILOT_LIMITS.depth; i++) nested = { a: nested };
    const full = { pad: 'x'.repeat(PILOT_LIMITS.observationBytes - JSON.stringify({ pad: '' }).length) };
    const { host } = setup();
    // Control characters have six-byte JSON escapes but one-byte raw source size.
    const escapedSource = '//' + '\u0001'.repeat(PILOT_LIMITS.sourceBytes - 2);
    await host.start(escapedSource, nested);
    assert.deepEqual(await host.tick(nested, { sampleTick: 0 }), command);
    host.stop();
    const second = setup().host;
    await second.start(source, full);
    assert.deepEqual(await second.tick(full, { sampleTick: 0 }), command);
    second.stop();
  });

  it('initial reset and later reset reproduce RNG even when the factory draws randomness', async () => {
    const replies = [];
    const receive = createPilotRuntime({ send: message => replies.push(message),
      loadModule: async () => ({ createPilot(api) {
        api.random();
        let offset;
        return { reset() { offset = api.random(); }, onTick() { return { ...command, elevator: (offset + api.random()) / 2 }; } };
      } }),
    });
    const meta = sequence => ({ sessionId: 'rng-case', sequence, sampleTick: sequence * 24 });
    await receive(createEnvelope('init', meta(0), { source, briefing: {} }));
    await receive(createEnvelope('observation', meta(1), {}));
    const initial = replies.at(-1).payload;
    await receive(createEnvelope('reset', meta(2), { briefing: {} }));
    assert.equal(replies.at(-1).type, 'reset-complete');
    await receive(createEnvelope('observation', meta(3), {}));
    assert.deepEqual(replies.at(-1).payload, initial);
  });

  it('initializes the pilot once and carries state across ticks', async () => {
    let count = 0;
    const { host, worker } = setup({ createPilot: () => ({
      reset(briefing) { assert.equal(briefing.missionId, 'takeoff'); count = 0; },
      onTick(observation) { assert.ok(Object.isFrozen(observation)); return { ...command, elevator: ++count / 10 }; },
    }) });
    await host.start(source, { missionId: 'takeoff' });
    assert.equal(host.state, 'ready');
    assert.equal((await host.tick({}, { sampleTick: 0 })).elevator, 0.1);
    assert.equal((await host.tick({}, { sampleTick: 24 })).elevator, 0.2);
    assert.equal(worker.sent[2].meta.sequence, 2);
    host.stop();
    assert.ok(worker.terminated);
    assert.equal(host.state, 'stopped');
  });

  it('rejects concurrent calls without disrupting the in-flight request', async () => {
    const { host, worker } = setup();
    await host.start(source, {});
    worker.silent = true;
    const first = host.tick({}, { sampleTick: 0 });
    await assert.rejects(host.tick({}, { sampleTick: 24 }), { code: 'pilot-busy' });
    const request = worker.sent.at(-1);
    host.receive(createEnvelope('command', request.meta, command));
    assert.deepEqual(await first, command);
    host.stop();
  });

  it('times out a non-returning invocation and terminates the worker', async () => {
    const { host, worker } = setup(undefined, { tickTimeoutMs: 10 });
    await host.start(source, {});
    worker.silent = true;
    await assert.rejects(host.tick({}, { sampleTick: 0 }), { code: 'pilot-timeout' });
    assert.ok(worker.terminated);
    assert.equal(host.state, 'faulted');
  });

  it('times out initialization as well as ticks', async () => {
    const worker = new FakeWorker();
    worker.silent = true;
    const host = new PilotHost({ workerFactory: () => worker, startupTimeoutMs: 10 });
    await assert.rejects(host.start(source, {}), { code: 'pilot-timeout' });
    assert.ok(worker.terminated);
  });

  it('stop rejects outstanding work and prevents a late startup from reviving it', async () => {
    const worker = new FakeWorker();
    worker.silent = true;
    const host = new PilotHost({ workerFactory: () => worker });
    const starting = host.start(source, {});
    const oldHandler = worker.onmessage;
    const request = worker.sent[0];
    host.stop();
    oldHandler({ data: createEnvelope('ready', request.meta, {}) });
    await assert.rejects(starting, { code: 'pilot-stopped' });
    assert.equal(host.state, 'stopped');
  });

  it('ignores stale, duplicate and wrong-session replies', async () => {
    const { host, worker } = setup();
    await host.start(source, {});
    worker.silent = true;
    const pending = host.tick({}, { sampleTick: 24 });
    const request = worker.sent.at(-1);
    for (const meta of [
      { ...request.meta, sequence: 0 },
      { ...request.meta, sessionId: 'old-session' },
      { ...request.meta, sampleTick: 0 },
    ]) host.receive(createEnvelope('command', meta, command));
    assert.ok(host.pending);
    host.receive(createEnvelope('command', request.meta, command));
    assert.deepEqual(await pending, command);
    host.receive(createEnvelope('command', request.meta, command));
    assert.equal(host.pending, null);
    host.stop();
  });

  it('fails atomically on invalid command and exposes no partial axes', async () => {
    const { host, worker } = setup({ createPilot: () => ({ reset() {}, onTick: () => ({ ...command, rudder: NaN }) }) });
    await host.start(source, {});
    await assert.rejects(host.tick({}, { sampleTick: 0 }), { code: 'invalid-command' });
    assert.ok(worker.terminated);
  });

  it('rejects runtime exceptions and async hooks', async () => {
    for (const onTick of [() => { throw new Error('tick failed'); }, async () => command]) {
      const { host } = setup({ createPilot: () => ({ reset() {}, onTick }) });
      await host.start(source, {});
      await assert.rejects(host.tick({}, { sampleTick: 0 }), { code: 'pilot-runtime-error' });
      assert.equal(host.state, 'faulted');
    }
  });

  it('requires createPilot/reset/onTick and handles reset exceptions', async () => {
    for (const module of [{}, { createPilot: () => ({ onTick() {} }) }, {
      createPilot: () => ({ reset() { throw new Error('reset failed'); }, onTick() {} }),
    }]) {
      const { host, worker } = setup(module);
      await assert.rejects(host.start(source, {}), { code: 'pilot-runtime-error' });
      assert.ok(worker.terminated);
    }
  });

  it('caps diagnostics and shields execution from log callback exceptions', async () => {
    const logs = [];
    const { host } = setup({ createPilot: api => ({
      reset() {}, onTick() { for (let i = 0; i < 20; i++) api.log('x'.repeat(2000)); return command; },
    }) }, { onLog(message) { logs.push(message); throw new Error('UI unavailable'); } });
    await host.start(source, {});
    await host.tick({}, { sampleTick: 0 });
    assert.equal(logs.length, 4);
    assert.ok(logs.every(message => message.length === 1024));
    host.stop();
  });

  it('rejects oversized source and invalid input before crossing the worker boundary', async () => {
    const { host, worker } = setup();
    await assert.rejects(host.start('x'.repeat(262145), {}), { code: 'invalid-source' });
    assert.equal(worker.sent.length, 0);
    await host.start(source, {});
    await assert.rejects(host.tick({ x: Infinity }, { sampleTick: 0 }), { code: 'invalid-observation' });
    await assert.rejects(host.tick({}, { sampleTick: -1 }), { code: 'invalid-tick-meta' });
    host.stop();
  });

  it('faults on malformed active messages and native worker errors', async () => {
    for (const trigger of [host => host.receive({}), (host, worker) => worker.onerror()]) {
      const { host, worker } = setup();
      await host.start(source, {});
      worker.silent = true;
      const pending = host.tick({}, { sampleTick: 0 });
      trigger(host, worker);
      await assert.rejects(pending);
      assert.ok(worker.terminated);
    }
  });
});

describe('actual isolated JavaScript thread watchdog', () => {
  it('terminates an infinite pilot loop while the host event loop keeps running', async () => {
    const { Worker: Thread } = await import('node:worker_threads');
    const runtimeUrl = new URL('../src/pilot/pilot.worker.js', import.meta.url).href;
    class ThreadWorker {
      constructor() {
        this.thread = new Thread(`
          const { parentPort, workerData } = require('node:worker_threads');
          (async () => {
            const { createPilotRuntime } = await import(workerData.runtimeUrl);
            const receive = createPilotRuntime({
              send: message => parentPort.postMessage(message),
              loadModule: source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
            });
            parentPort.on('message', message => { void receive(message); });
          })().catch(error => { throw error; });
        `, { eval: true, workerData: { runtimeUrl } });
        this.thread.on('message', data => this.onmessage?.({ data }));
        this.thread.on('error', () => this.onerror?.());
      }
      postMessage(message) { this.thread.postMessage(message); }
      terminate() { this.termination = this.thread.terminate(); }
    }
    const worker = new ThreadWorker();
    const host = new PilotHost({ workerFactory: () => worker, startupTimeoutMs: 2000, tickTimeoutMs: 50 });
    await host.start('export function createPilot() { return { reset() {}, onTick() { while (true) {} } }; }', {});
    let hostTurn = false;
    const hostTimer = setTimeout(() => { hostTurn = true; }, 5);
    try {
      await assert.rejects(host.tick({}, { sampleTick: 0 }), { code: 'pilot-timeout' });
      assert.equal(hostTurn, true);
      assert.equal(host.state, 'faulted');
      await worker.termination;
    } finally {
      clearTimeout(hostTimer);
      host.stop();
    }
  });
});
