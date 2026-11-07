import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightStartCoordinator } from '../src/core/FlightStartCoordinator.js';

function harness({ held = false, locked = false } = {}) {
  const events = [];
  const ports = {
    isLocked: () => locked,
    hold: { get: () => held, set: value => { held = value; } },
    spawn(options) { assert.equal(held, true); events.push(['spawn', options]); },
    scene: { prepare() { assert.equal(held, true); events.push('scene'); } },
    loading: {
      open() { assert.equal(held, true); events.push('open'); },
      ready() { assert.equal(held, true); events.push('ready'); },
      close() { assert.equal(held, true); events.push('close'); },
    },
    recover(error) { assert.equal(held, true); events.push(error.message); },
  };
  return { ports, events, held: () => held, start: new FlightStartCoordinator(ports) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('ordinary spawn stays in the click task and retains retry options and external holds', async () => {
  for (const held of [false, true]) {
    const h = harness({ held });
    const pending = h.start.start({ keepTimeOfDay: true });
    assert.deepEqual(h.events, [['spawn', { keepTimeOfDay: true }]]);
    assert.equal(h.held(), true);
    assert.equal(await pending, true);
    assert.equal(h.held(), held);
    assert.equal(h.start.busy, false);
  }
});

test('scene load, spawn and final paint exclude competing entry points throughout', async () => {
  const h = harness();
  const prepared = deferred(), spawned = deferred(), painted = deferred();
  h.ports.scene.prepare = () => prepared.promise;
  h.start.spawn = () => spawned.promise;
  h.ports.loading.ready = () => painted.promise;
  const pending = h.start.rebuild();
  for (const finish of [prepared.resolve, spawned.resolve, painted.resolve]) {
    assert.equal(h.held(), true);
    assert.equal(await h.start.start(), false);
    assert.equal(await h.start.rebuild(), false);
    finish();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(await pending, true);
  assert.deepEqual(h.events, ['open', 'close']);
  assert.equal(h.held(), false);
  assert.equal(h.start.busy, false);
});

test('preparation/spawn/paint failures recover once, close UI and allow a clean retry', async () => {
  for (const phase of ['open', 'prepare', 'spawn', 'ready']) {
    const h = harness();
    const fail = () => { throw Error(`failed ${phase}`); };
    if (phase === 'spawn') h.start.spawn = fail;
    else if (phase === 'prepare') h.ports.scene.prepare = fail;
    else h.ports.loading[phase] = fail;
    assert.equal(await h.start.rebuild(), false);
    assert.equal(h.events.filter(event => event === `failed ${phase}`).length, 1);
    assert.equal(h.events.at(-1), 'close');
    if (phase !== 'ready') assert.equal(h.events.includes('ready'), false);
    assert.equal(h.held(), false);
    assert.equal(h.start.busy, false);
    h.start.spawn = () => {};
    assert.equal(await h.start.start(), true);
  }
});

test('a rejected lazy spawn keeps the hold and blocks a second direct spawn until recovery', async () => {
  const h = harness();
  const work = deferred();
  h.start.spawn = () => work.promise;
  const pending = h.start.start();
  assert.equal(await h.start.start(), false);
  assert.equal(h.held(), true);
  work.reject(Error('lazy import'));
  assert.equal(await pending, false);
  assert.deepEqual(h.events, ['lazy import']);
  assert.equal(h.held(), false);
});

test('locked sessions produce no UI, spawn or hold effects', async () => {
  const h = harness({ locked: true });
  assert.equal(await h.start.start(), false);
  assert.equal(await h.start.rebuild(), false);
  assert.deepEqual(h.events, []);
  assert.equal(h.held(), false);
});

test('cleanup errors cannot strand physics or exclude subsequent starts', async () => {
  const h = harness();
  h.ports.loading.close = () => { throw Error('UI cleanup'); };
  await assert.rejects(h.start.rebuild(), /UI cleanup/);
  assert.equal(h.held(), false);
  assert.equal(h.start.busy, false);
  assert.equal(await h.start.start(), true);
});
