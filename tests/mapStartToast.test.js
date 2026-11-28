import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatorScenarioStart } from '../src/core/simulatorScenarioStart.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { t } from '../src/i18n/index.js';

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

const RKPU = {
  code: 'RKPU', name: 'Ulsan Airport', latitude: 35.5935, longitude: 129.351699, elevationM: 13.72,
};

// Mirrors the simulator's showToast: the quiet flag suppresses preset toasts.
function mapStartSim({ lobbyAirport = 'incheon', state = 'cruise' } = {}) {
  const toasts = [];
  const sim = {
    lobby: {
      airport: lobbyAirport, aircraft: 'C172', preset: state, pilotMode: 'human',
      mapPlan: { state, airportCode: RKPU.code, runwayKey: '', pointId: '', departure: '' },
    },
    mapPlaces: { airports: [RKPU], points: [] },
    activeAirport: lobbyAirport,
    currentAircraftId: 'C172',
    sky: { timeOfDay: 12 },
    gear: { cgGroundHeightM: 1.4 },
    position: { x: 0, y: 0, z: 0 },
    linearVelocity: { x: 0, y: 0, z: 0 },
    currentTerrain: { getHeight: () => 0 },
    devRunner: { stop() {} }, shadowDemo: { stop() {} }, replayDirector: { stop() {} },
    demoDirector: { userTimeOfDayOverridden: true },
    gameFlow: new GameFlowController(),
    analytics: { trackFlightStart() {} },
    ensureGeographicLayers: async () => ({}),
    beginFlightRecording() {},
    setCustomWorldOrigin() {},
    setPreset(scenario) {
      // The legacy base-airport branch announces its own showcase scenario.
      sim.showToast(() => `${sim.activeAirport}.${scenario}`);
    },
    applyMapSpawn(spawn) { Object.assign(sim.position, { x: spawn.x, y: spawn.y, z: spawn.z }); return true; },
    showToast(msg) {
      if (sim.quietPresetToast) return;
      toasts.push(typeof msg === 'function' ? msg() : msg);
    },
  };
  return { sim, toasts };
}

for (const lobbyAirport of ['incheon', 'jeju']) {
  test(`map cruise start at RKPU names Ulsan, not the ${lobbyAirport} showcase (#1096)`, () => withStorage(async () => {
    const { sim, toasts } = mapStartSim({ lobbyAirport });
    await createSimulatorScenarioStart(sim).start();
    assert.ok(toasts.length > 0, 'the start must still be announced');
    assert.ok(!toasts.some(text => text.startsWith(`${lobbyAirport}.`)),
      `base-airport preset toast leaked: ${JSON.stringify(toasts)}`);
    assert.match(toasts.at(-1), /RKPU/);
    assert.ok(toasts.at(-1).startsWith(t('lobby.cruiseStart')), toasts.at(-1));
    assert.equal(sim.quietPresetToast, undefined, 'the quiet flag must be restored');
  }));
}

test('non-map preset start keeps its own scenario toast', () => withStorage(async () => {
  const { sim, toasts } = mapStartSim();
  sim.lobby.mapPlan = null;
  sim.lobby.preset = 'runway';
  sim.airportStreamer = {
    releaseGroundHold() {}, ensure() {}, setHome() {}, update() {},
    statusFor: code => ({ state: 'ready', code }),
    regionFor: () => null,
  };
  await createSimulatorScenarioStart(sim).start();
  assert.deepEqual(toasts, ['incheon.runway']);
}));
