import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotMissionStartController } from '../src/arena/PilotMissionStartController.js';
import { MissionRunner } from '../src/arena/MissionRunner.js';
import { createMissionManifest } from '../src/arena/missionConfig.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const events = [], ready = deferred(), complete = deferred();
  const runner = {
    active: false, preparing: false,
    stop(reason) { events.push(reason); this.active = false; },
    start(source, options) {
      events.push({ source, ...options });
      this.active = true;
      this.readyPromise = ready.promise;
      return complete.promise;
    },
  };
  const pacer = () => {};
  const starter = new PilotMissionStartController({ runner,
    readRequest: overrides => ({ source: 'pilot', missionId: 'takeoff-basic-v1',
      pilotKind: 'ai', seed: 0, playback: 'fast', ...overrides }),
    beforeStart: () => events.push('reset'), createPacer: () => pacer });
  return { starter, runner, ready, complete, events, pacer };
}

test('readiness releases the caller without waiting for the flight lifetime', async () => {
  const h = fixture();
  const pending = h.starter.start();
  let returned = false;
  pending.then(() => { returned = true; });
  await Promise.resolve();
  assert.equal(returned, false);
  const record = { status: 'running' };
  h.ready.resolve(record);
  assert.equal(await pending, record);
  assert.equal(h.runner.active, true);
  assert.equal(h.runner.paceTick, null);
  h.complete.resolve(record);
});

test('retry stops the outgoing run before reset and a human command sets pacing', async () => {
  const h = fixture();
  h.runner.active = true;
  const pending = h.starter.start({ missionId: 'valley-slalom-v1', pilotKind: 'human' });
  assert.deepEqual(h.events.slice(0, 2), ['retry', 'reset']);
  assert.equal(h.events[2].missionId, 'valley-slalom-v1');
  assert.equal(h.events[2].pilotKind, 'human');
  assert.equal(h.runner.paceTick, h.pacer);
  h.ready.resolve({ status: 'running' });
  await pending;
});

test('invalid seeds and overlapping preparation leave the existing mission untouched', async () => {
  for (const seed of [-1, 0.5, NaN]) {
    const h = fixture();
    await assert.rejects(h.starter.start({ seed }), /정수/);
    assert.deepEqual(h.events, []);
  }
  const h = fixture();
  h.runner.active = h.runner.preparing = true;
  await assert.rejects(h.starter.start(), /preparing or stopping/);
  assert.deepEqual(h.events, []);
});

test('early startup rejection, failed preparation and cancelled readiness all reach the caller', async () => {
  for (const failure of ['startup', 'prepare', 'cancelled', 'missing']) {
    const h = fixture();
    if (failure === 'missing') h.runner.start = () => h.complete.promise;
    const pending = h.starter.start();
    if (failure === 'startup') h.complete.reject(Error('startup failure'));
    else if (failure === 'prepare') h.ready.reject(Error('preparation failure'));
    else if (failure === 'cancelled') h.ready.resolve({ status: 'aborted', reason: 'cancelled' });
    await assert.rejects(pending, /startup failure|preparation failure|cancelled|readiness signal/);
    h.complete.resolve({ status: 'aborted' });
  }
});

test('real runner preparation errors propagate without an unhandled readyPromise rejection', async () => {
  let released = 0;
  const runner = new MissionRunner({ prepare: async () => { throw Error('terrain unavailable'); }, release() { released++; } });
  const starter = new PilotMissionStartController({ runner,
    readRequest: () => ({ source: '', pilotKind: 'human', seed: 1 }),
    beforeStart() {}, createPacer: () => null });
  await assert.rejects(starter.start(), /terrain unavailable/);
  assert.equal(runner.record.status, 'failed');
  assert.equal(released, 1);
});

test('stopping a real runner during preparation cannot report a successful start', async () => {
  const prepared = deferred();
  let acquired = false;
  const runner = new MissionRunner({ prepare: () => prepared.promise,
    acquire() { acquired = true; }, release() {} });
  const starter = new PilotMissionStartController({ runner,
    readRequest: () => ({ source: '', pilotKind: 'ai', seed: 1 }),
    beforeStart() {}, createPacer: () => null });
  const pending = starter.start();
  runner.stop('cancelled by menu');
  prepared.resolve({ manifest: createMissionManifest('takeoff') });
  await assert.rejects(pending, /cancelled by menu/);
  assert.equal(acquired, false);
});


test('an already completed run cannot hide a missing readiness signal', async () => {
  const h = fixture();
  h.runner.start = () => Promise.resolve({ status: 'succeeded' });
  await assert.rejects(h.starter.start(), /readiness signal is missing/);
});
