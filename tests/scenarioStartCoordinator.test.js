import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioStartCoordinator } from '../src/core/ScenarioStartCoordinator.js';
import { createSimulatorScenarioStart } from '../src/core/simulatorScenarioStart.js';
import { loadSavedFlightSelection, saveFlightSelection } from '../src/config/flightSelection.js';
import { saveSimulatorPreferences, loadSimulatorPreferences } from '../src/config/simulatorPreferences.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { recoverSimulatorFlightStart } from '../src/core/simulatorFlightStart.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function simulator() {
  const events = [];
  const sim = {
    lobby: { airport: 'valley', aircraft: 'F16', preset: 'valley', pilotMode: 'human', demoProfile: 'standard' },
    activeAirport: 'valley', currentAircraftId: 'F16', sky: { timeOfDay: 12 },
    devRunner: { stop() {} }, shadowDemo: { stop() {} }, replayDirector: { stop() {} },
    demoDirector: { userTimeOfDayOverridden: true, start() { return false; } },
    gameFlow: new GameFlowController(),
    beginFlightRecording() { events.push('record'); },
    analytics: { trackFlightStart(info) { events.push(info); } },
    setPreset(preset) { events.push(preset); this.beginFlightRecording(); },
  };
  return { sim, events };
}

function withStorage(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } });
  return Promise.resolve().then(run).finally(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
}

test('ordinary scenario installation and commitment are synchronous and ordered', async () => {
  const events = [];
  const start = new ScenarioStartCoordinator({
    prepare: () => ({ scenario: 'runway' }),
    installers: { preset(request) { events.push(request.scenario); } },
    commit: () => events.push('commit'),
  });
  const pending = start.start();
  assert.deepEqual(events, ['runway', 'commit']);
  await pending;
});

test('asynchronous installation commits only after preparation succeeds', async () => {
  for (const fail of [true, false]) {
    const gate = deferred(), events = [];
    const start = new ScenarioStartCoordinator({
      prepare: () => ({ scenario: 'valley' }),
      installers: { valley: () => gate.promise }, commit: () => events.push('commit'),
    });
    const pending = start.start();
    assert.deepEqual(events, []);
    if (fail) { gate.reject(Error('prepare failed')); await assert.rejects(pending, /prepare failed/); }
    else { gate.resolve(); await pending; assert.deepEqual(events, ['commit']); }
  }
});

test('pending menu edits during lazy preparation cannot replace the launched selection', () => withStorage(async () => {
  const { sim, events } = simulator();
  const gate = deferred();
  sim.startValleyMission = ({ pilotKind }) => { assert.equal(pilotKind, 'human'); return gate.promise; };
  const pending = createSimulatorScenarioStart(sim).start();
  assert.deepEqual(events, [], 'mission adapter owns recording, coordinator must not arm it again');
  Object.assign(sim.lobby, { airport: 'coastal', aircraft: 'C172', preset: 'cruise', pilotMode: 'ai', demoProfile: 'maneuvers' });
  gate.resolve();
  await pending;
  assert.deepEqual(loadSavedFlightSelection(), { airport: 'valley', aircraft: 'F16', scenario: 'valley' });
  assert.equal(loadSimulatorPreferences().demoProfile, 'standard');
  assert.equal(events.length, 1);
  assert.equal(events[0].pilotMode, 'human');
}));

test('scenario failure leaves saved flight/preferences and flight-start analytics untouched', () => withStorage(async () => {
  saveFlightSelection({ airport: 'coastal', aircraft: 'C172', scenario: 'cruise' });
  saveSimulatorPreferences({ demoProfile: 'maneuvers' });
  const before = loadSavedFlightSelection();
  const { sim, events } = simulator();
  sim.startValleyMission = async () => { throw Error('course failed'); };
  await assert.rejects(createSimulatorScenarioStart(sim).start(), /course failed/);
  assert.deepEqual(loadSavedFlightSelection(), before);
  assert.equal(loadSimulatorPreferences().demoProfile, 'maneuvers');
  assert.deepEqual(events, []);
  sim.lobby.preset = 'demo';
  await assert.rejects(createSimulatorScenarioStart(sim).start(), /Demo scenario/);
  assert.deepEqual(events, []);
}));

test('ordinary and demo starts each arm their recorder once', async () => {
  for (const preset of ['runway', 'demo']) {
    const { sim, events } = simulator();
    sim.lobby.preset = preset;
    sim.demoDirector.start = () => true;
    await createSimulatorScenarioStart(sim).start();
    assert.equal(events.filter(event => event === 'record').length, 1);
  }
});

test('failed start cancels stale recordings and debrief timers as it freezes the lobby', t => {
  const { sim } = simulator();
  sim.gameFlow.enterFlight();
  sim.gameFlow.returnToLobby(true);
  sim.flightRecorder = { active: true };
  sim.replayRecorder = { active: true };
  sim.debriefReport = sim.debriefReplay = {};
  sim.crashDebriefRemaining = 1;
  sim.showToast = sim.syncFlowUi = () => {};
  t.mock.method(console, 'warn', () => {});
  recoverSimulatorFlightStart(sim, Error('failed start'));
  assert.equal(sim.flightRecorder.active, false);
  assert.equal(sim.replayRecorder.active, false);
  assert.equal(sim.crashDebriefRemaining, null);
  assert.equal(sim.debriefReport, null);
  assert.equal(sim.debriefReplay, null);
  assert.equal(sim.gameFlow.canResumeFromLobby(), false);
  assert.equal(sim.gameFlow.isPhysicsFrozen(), true);
});


test('explicit installer rejection cannot commit a successful start', async () => {
  for (const installed of [false, Promise.resolve(false)]) {
    const start = new ScenarioStartCoordinator({ prepare: () => ({ scenario: 'runway' }),
      installers: { preset: () => installed }, commit: () => assert.fail('committed rejected installation') });
    await assert.rejects(start.start(), /installation was rejected/);
  }
});
