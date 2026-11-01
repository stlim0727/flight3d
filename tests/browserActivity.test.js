import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatorClass } from './helpers/simulatorClass.js';
import { GameFlowController, FLOW } from '../src/ui/GameFlowController.js';
import { FlightAudio } from '../src/audio/FlightAudio.js';
import { MissionRunner } from '../src/arena/MissionRunner.js';
import { createMissionManifest } from '../src/arena/missionConfig.js';

function fixture() {
  const audio = new FlightAudio();
  let clockReads = 0, released = 0, resumes = 0;
  audio.ensureContextRunning = () => resumes++;
  const sim = Object.assign(Object.create(SimulatorClass.prototype), {
    gameFlow: new GameFlowController(), audio,
    clock: { getDelta() { clockReads++; return 10; } }, physicsAccumulator: 0.005,
    controls: {
      releaseAllKeys() { released++; }, setTouchStick() {}, setTouchRudder() {}, setTouchBrakes() {},
    },
  });
  sim.gameFlow.enterFlight();
  return { sim, audio, counts: () => ({ clockReads, released, resumes }) };
}

test('background hold silences audio/radio and discards elapsed time without changing flight or volume', () => {
  const { sim, audio, counts } = fixture();
  audio.setVolume(0.6);
  sim.setBrowserActive(false);
  assert.equal(sim.browserBackgrounded, true);
  assert.equal(audio.effectiveVolume, 0);
  assert.equal(audio.departureRadio.paused, true);
  assert.equal(sim.gameFlow.state, FLOW.FLIGHT);
  assert.equal(sim.physicsAccumulator, 0);
  sim.setBrowserActive(false);
  assert.deepEqual(counts(), { clockReads: 1, released: 1, resumes: 0 });
  sim.syncAudioPause();
  assert.equal(audio.effectiveVolume, 0, 'flow synchronization cannot unmute a background window');
  sim.setBrowserActive(true);
  assert.equal(audio.effectiveVolume, 0.6);
  assert.equal(audio.departureRadio.paused, false);
  assert.deepEqual(counts(), { clockReads: 2, released: 1, resumes: 1 });
  audio.setMuted(true);
  sim.setBrowserActive(false); sim.setBrowserActive(true);
  assert.equal(audio.isMuted, true);
  assert.equal(audio.effectiveVolume, 0);
});

test('focus return preserves explicit pause and a held lobby flight', () => {
  for (const state of [FLOW.PAUSED, FLOW.LOBBY]) {
    const { sim, audio } = fixture();
    if (state === FLOW.PAUSED) sim.gameFlow.pause();
    else sim.gameFlow.returnToLobby(true);
    sim.setBrowserActive(false); sim.setBrowserActive(true);
    assert.equal(sim.gameFlow.state, state);
    assert.equal(sim.gameFlow.isPhysicsFrozen(), true);
    assert.equal(audio.effectiveVolume, 0);
    assert.equal(audio.departureRadio.paused, true);
  }
});

test('browser visibility and window focus must both allow playback, including page lifecycle', () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const win = new EventTarget(), doc = new EventTarget();
  let focused = true;
  doc.hidden = false; doc.hasFocus = () => focused;
  globalThis.window = win; globalThis.document = doc;
  try {
    const { sim, audio } = fixture();
    sim.initBrowserActivity();
    assert.equal(audio.effectiveVolume, 1);
    focused = false; win.dispatchEvent(new Event('blur'));
    assert.equal(audio.effectiveVolume, 0);
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(audio.effectiveVolume, 0, 'visible but unfocused remains silent');
    doc.hidden = true; focused = true; win.dispatchEvent(new Event('focus'));
    assert.equal(audio.effectiveVolume, 0, 'focus event cannot override hidden document');
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(audio.effectiveVolume, 1);
    win.dispatchEvent(new Event('pagehide'));
    assert.equal(audio.effectiveVolume, 0);
    win.dispatchEvent(new Event('pageshow'));
    assert.equal(audio.effectiveVolume, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('background animation schedules its next frame but never advances simulation or audio', () => {
  const { sim } = fixture();
  const previous = globalThis.requestAnimationFrame;
  let scheduled = 0;
  globalThis.requestAnimationFrame = () => scheduled++;
  try {
    sim.setBrowserActive(false);
    sim.animate(); // Everything after the background guard requires a live scene.
    assert.equal(scheduled, 1);
  } finally {
    if (previous === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previous;
  }
});

test('actual browser activity handling holds a pending pilot reply without advancing judged physics', async () => {
  const { sim } = fixture();
  let finishTick, steps = 0;
  const adapter = { async prepare() { return { manifest: createMissionManifest('takeoff') }; },
    acquire() {}, release() {}, apply() {}, snapshot() { return {}; }, step() { steps++; } };
  let heldFrames = 0;
  const runner = sim.pilotArena = new MissionRunner(adapter, {
    canAdvance: () => !sim.browserBackgrounded,
    yieldFrame: async () => {
      assert.equal(steps, 0);
      if (++heldFrames === 3) runner.stop('manual-takeover');
    }, hostFactory: () => ({
    async start() {}, tick() { return new Promise(resolve => { finishTick = resolve; }); }, stop() {},
  }) });
  const run = runner.start('source');
  while (!finishTick) await new Promise(resolve => setImmediate(resolve));
  sim.setBrowserActive(false);
  finishTick({ elevator: 0, aileron: 0, rudder: 0, throttle: 1, brakes: 0 });
  const record = await run;
  assert.equal(record.status, 'aborted');
  assert.equal(record.reason, 'manual-takeover');
  assert.equal(heldFrames, 3);
  assert.equal(steps, 0);
});
