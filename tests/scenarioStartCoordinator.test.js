import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioStartCoordinator } from '../src/core/ScenarioStartCoordinator.js';
import { createSimulatorScenarioStart, alignCruiseSpawnToTerrain } from '../src/core/simulatorScenarioStart.js';
import { approachSpawnPlan, runwayEndFrame } from '../src/config/mapFlightPlan.js';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';
import { loadSavedFlightSelection, saveFlightSelection } from '../src/config/flightSelection.js';
import { saveSimulatorPreferences, loadSimulatorPreferences } from '../src/config/simulatorPreferences.js';
import { cruisePlaces } from '../src/config/mapFlightPlaces.js';
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

test('map-planned cruise keeps the selected point on the active flight', () => withStorage(async () => {
  const { sim } = simulator();
  sim.activeAirport = 'incheon';
  sim.currentAircraftId = 'C172';
  sim.mapPlaces = { points: cruisePlaces() };
  sim.applyMapSpawn = () => {};
  Object.assign(sim.lobby, { airport: 'incheon', aircraft: 'C172', preset: 'cruise' });
  const start = createSimulatorScenarioStart(sim);
  for (const pointId of ['busan', 'jamsil']) {
    sim.lobby.mapPlan = { state: 'cruise', pointId };
    await start.start();
    assert.equal(sim.activeMapPlace.pointId, pointId);
  }
  sim.lobby.mapPlan = null;
  await start.start();
  assert.equal(sim.activeMapPlace, null);
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

test('map flight plan is captured before install and applies the resolved spawn', async () => {
  await withStorage(async () => {
    const { sim, events } = simulator();
    sim.activeAirport = 'incheon';
    sim.currentAircraftId = 'B738';
    sim.lobby = {
      airport: 'incheon', aircraft: 'B738', preset: 'approach', pilotMode: 'human',
      mapPlan: { state: 'approach', airportCode: 'RKSS', runwayKey: 'rwy1:14R' },
    };
    sim.mapPlaces = {
      airports: [{
        code: 'RKSS', latitude: 37.5583, longitude: 126.791, elevationM: 18,
        runways: [{
          id: 'rwy1', widthM: 60, lengthM: 3200,
          ends: [
            { ident: '14R', headingDegT: 140, displacedThresholdM: 0,
              physical: { latitude: 37.568, longitude: 126.776, elevationM: 18 },
              threshold: { latitude: 37.568, longitude: 126.776, elevationM: 18 } },
            { ident: '32L', headingDegT: 320, displacedThresholdM: 0,
              physical: { latitude: 37.548, longitude: 126.801, elevationM: 20 },
              threshold: { latitude: 37.548, longitude: 126.801, elevationM: 20 } },
          ],
        }],
      }],
      points: [],
    };
    const gyroRestores = [];
    sim.touchControls = { gyroRequested: true, gyroActive: false, restoreGyroSettings: options => gyroRestores.push(options) };
    let applied;
    sim.setPreset = preset => events.push(preset);
    sim.applyMapSpawn = (spawn, state) => {
      applied = { spawn, state };
      events.push(`map:${state}`);
    };
    await createSimulatorScenarioStart(sim).start();
    assert.deepEqual(events.slice(0, 2), ['approach', 'map:approach']);
    assert.equal(applied.state, 'approach');
    assert.ok(Number.isFinite(applied.spawn.x) && Number.isFinite(applied.spawn.yaw));
    assert.deepEqual(gyroRestores, [{ userGesture: true }]);
  });
});

test('high-elevation map cruise aligns above streamed DEM and survives physics start (Pangong Tso)', async () => {
  await withStorage(async () => {
    let demLoaded = false;
    const terrain = {
      getHeight(x, z) {
        if (!demLoaded) return 0;
        // 4240 m lake at origin, rising to a 4500 m ridge 500 m east along heading 090
        return x >= 400 ? 4500 : 4240;
      },
      openWorld: {
        readyAt() { return demLoaded; },
      },
    };
    const sim = createPilotMissionSimulation({ aircraftId: 'C172', airportId: 'incheon', terrain });
    sim.devRunner = { stop() {} };
    sim.shadowDemo = { stop() {} };
    sim.replayDirector = { stop() {} };
    sim.demoDirector = { userTimeOfDayOverridden: true, stop() {} };
    sim.gameFlow = new GameFlowController();
    sim.sky = { timeOfDay: 12 };
    sim.lobby = {
      airport: 'incheon',
      aircraft: 'C172',
      preset: 'cruise',
      pilotMode: 'human',
      demoProfile: 'standard',
      mapPlan: {
        state: 'cruise',
        pointId: 'geonames:1281682',
        point: {
          id: 'geonames:1281682',
          label: 'Pangong Tso',
          latitude: 33.716,
          longitude: 79.34574,
          altitudeM: 700,
          headingDeg: 90,
        },
      },
    };
    sim.mapPlaces = { airports: [], points: [] };
    let snapCount = 0;
    sim.cameraSystem = { snapToTarget() { snapCount++; } };
    sim.ensureGeographicLayers = async () => ({
      updateOpenWorldTerrain() {
        demLoaded = true;
      },
    });

    await createSimulatorScenarioStart(sim).start();

    assert.equal(demLoaded, true);
    assert.equal(sim.position.y, 4500 + 750, 'cruise altitude should clear streamed terrain and nearby ridge');
    assert.ok(snapCount >= 2, 'camera should re-snap after post-DEM altitude alignment');

    // Run 2 seconds of physics at 120 Hz: must not crash on start
    for (let i = 0; i < 240; i++) {
      sim.integratePhysics(1 / 120);
    }
    assert.equal(sim.isCrashed, false, `unexpected crash: ${sim.crashResult?.type}`);
    assert.ok(sim.position.y > 4500, 'aircraft should remain well above terrain');
  });
});

test('alignCruiseSpawnToTerrain preserves intentionally low authored showcases like Paris Eiffel', () => {
  const sim = {
    position: { x: 0, y: 120, z: 0 },
    linearVelocity: { x: -48, y: 0, z: 5 },
    currentTerrain: {
      getHeight: () => 30,
      openWorld: { readyAt: () => true },
    },
  };
  const changed = alignCruiseSpawnToTerrain(sim, { isMapPlan: true });
  assert.equal(changed, false);
  assert.equal(sim.position.y, 120);
});

test('alignCruiseSpawnToTerrain raises regional cruise after asynchronous DEM load', () => {
  let trimmed = false;
  const sim = {
    position: { x: 0, y: 750, z: 1600 },
    linearVelocity: { x: -30, y: 0, z: 40 },
    currentTerrain: {
      getHeight: () => 2400,
      openWorld: { readyAt: () => true },
    },
    applyComputedTrim() { trimmed = true; },
  };
  const changed = alignCruiseSpawnToTerrain(sim, { isMapPlan: false });
  assert.equal(changed, true);
  assert.equal(sim.position.y, 2400 + 750);
  assert.equal(trimmed, true);
});

test('map approach spawn clears the terrain at the final approach point', async () => {
  await withStorage(async () => {
    const origin = { latitude: 27.4032, longitude: 89.424599 };
    const airport = {
      code: 'VQPR', ...origin, elevationM: 2244.55, tileId: '11-26',
      runways: [{
        id: '234387', widthM: 29.9, lengthM: 2265,
        ends: [
          { ident: '15', physical: { latitude: 27.412162, longitude: 89.41906, elevationM: 2243.63 },
            threshold: { latitude: 27.410873, longitude: 89.41988, elevationM: 2242.48 },
            displacedThresholdM: 164.59, headingDegT: 150.5 },
          { ident: '33', physical: { latitude: 27.394393, longitude: 89.430371, elevationM: 2227.78 },
            threshold: { latitude: 27.395324, longitude: 89.429779, elevationM: 2228.61 },
            displacedThresholdM: 118.87, headingDegT: 330.5 },
        ],
      }],
    };
    const plan = approachSpawnPlan({
      frame: runwayEndFrame(airport, '234387', '15', { origin }), origin, aircraftId: 'C172',
    });
    const groundAtThreshold = 2242.48;
    const groundAtFinal = 2675;
    const samples = [];
    const terrain = {
      getHeight(x, z) {
        samples.push([x, z]);
        return Math.hypot(x - plan.x, z - plan.z) < 1 ? groundAtFinal : groundAtThreshold;
      },
      openWorld: { readyAt: () => true },
    };
    const sim = createPilotMissionSimulation({ aircraftId: 'C172', airportId: 'incheon', terrain });
    sim.devRunner = { stop() {} };
    sim.shadowDemo = { stop() {} };
    sim.replayDirector = { stop() {} };
    sim.demoDirector = { userTimeOfDayOverridden: true, stop() {} };
    sim.gameFlow = new GameFlowController();
    sim.sky = { timeOfDay: 12 };
    sim.lobby = {
      airport: 'jeju',
      aircraft: 'C172',
      preset: 'approach',
      pilotMode: 'human',
      demoProfile: 'standard',
      mapPlan: {
        state: 'approach',
        airportCode: 'VQPR',
        tileId: '11-26',
        runwayKey: '234387:15',
      },
    };
    sim.mapPlaces = {
      airports: [airport],
      points: [],
    };
    sim.ensureGeographicLayers = async () => ({
      updateOpenWorldTerrain() {},
    });

    await createSimulatorScenarioStart(sim).start();

    assert.ok(samples.some(([x, z]) => Math.abs(x - sim.position.x) < 1 && Math.abs(z - sim.position.z) < 1),
      'spawn alignment should sample terrain beneath the aircraft');
    assert.equal(sim.position.y, groundAtFinal + plan.groundClearanceM + plan.glideRiseM);
    assert.ok(sim.position.y > groundAtFinal, 'spawn should clear local streamed terrain');
    assert.equal(sim.isCrashed, false);

    for (let index = 0; index < 240; index++) sim.integratePhysics(1 / 120);
    assert.equal(sim.isCrashed, false, `unexpected crash: ${sim.crashResult?.type}`);
  });
});
