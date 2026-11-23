import test from 'node:test';
import assert from 'node:assert/strict';
import { airportSpawnPlan } from '../src/config/airportSpawnPlan.js';
import { isExternalDestination } from '../src/config/externalDestinations.js';
import { applyAirportOverrides } from '../src/config/airportOverrides.js';
import { resolveMapFlightPlan } from '../src/config/mapFlightPlan.js';
// Frozen baseline from the retired Jeju preset, kept as a regression contract.
const BASELINE = {
  B738: {
    runway: { x: -1371.5495, y: 39.5, z: 582.2269, yaw: -1.1694, vx: 0, vy: 0, vz: 0 },
    approach: { x: -6577.925, y: 330.6776, z: 2792.2021, yaw: -1.1694, vx: 68.5776, vy: -3.9044, vz: -29.1095 },
    cruise: { x: 3741.4, y: 3048, z: 7500, yaw: -3.1416, vx: 0, vy: 0, vz: 108 },
    challenge: { x: -18300, y: 2400, z: -65000, yaw: -3.1416, vx: 0, vy: -2.8, vz: 110 },
  },
  C172: {
    runway: { x: -1371.5495, y: 39.5, z: 582.2269, yaw: -1.1694, vx: 0, vy: 0, vz: 0 },
    approach: { x: -6577.925, y: 330.6776, z: 2792.2021, yaw: -1.1694, vx: 30.3767, vy: -1.7295, vz: -12.8941 },
    cruise: { x: 3741.4, y: 3048, z: 7500, yaw: -3.1416, vx: 0, vy: 0, vz: 48 },
    challenge: { x: -18300, y: 2400, z: -65000, yaw: -3.1416, vx: 0, vy: -2.8, vz: 45 },
  },
  F16: {
    runway: { x: -1371.5495, y: 39.5, z: 582.2269, yaw: -1.1694, vx: 0, vy: 0, vz: 0 },
    approach: { x: -6577.925, y: 330.6776, z: 2792.2021, yaw: -1.1694, vx: 82.8454, vy: -4.7167, vz: -35.1658 },
    cruise: { x: 3741.4, y: 3048, z: 7500, yaw: -3.1416, vx: 0, vy: 0, vz: 180 },
    challenge: { x: -18300, y: 2400, z: -65000, yaw: -3.1416, vx: 0, vy: -2.8, vz: 160 },
  },
};
import { projectToLocal } from '../src/geospatial/incheon.js';
import { BASE_OFFSETS } from '../src/world/UnifiedWorld.js';
import { createSimulatorScenarioStart } from '../src/core/simulatorScenarioStart.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';

const CLEARANCE_M = 3.5;
const POSE_KEYS = ['x', 'y', 'z', 'yaw', 'vx', 'vy', 'vz'];

function closePose(actual, expected, tolerance = 0.01) {
  for (const key of POSE_KEYS) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance,
      `${key}: common ${actual[key]} != baseline ${expected[key]}`);
  }
}

// Index record shape from the committed OurAirports tile; only runway 07/25
// is needed to reproduce a map-based RKPC start.
const INDEX_RECORD = {
  ident: 'RKPC',
  latitude: 33.512058,
  longitude: 126.492548,
  elevationM: 35.97,
  runways: [{
    id: '237295',
    ends: [
      { ident: '07', physical: { latitude: 33.500401, longitude: 126.469002, elevationM: 26.21 },
        threshold: { latitude: 33.500401, longitude: 126.469002, elevationM: 26.21 } },
      { ident: '25', physical: { latitude: 33.5145, longitude: 126.497002, elevationM: 23.16 },
        threshold: { latitude: 33.5145, longitude: 126.497002, elevationM: 23.16 } },
    ],
  }],
};

test('RKPC preset poses match the validated Jeju baseline for every aircraft', () => {
  for (const aircraftId of ['B738', 'C172', 'F16']) {
    for (const scenario of ['runway', 'approach', 'cruise', 'challenge', 'ditching']) {
      const expected = BASELINE[aircraftId][scenario === 'ditching' ? 'challenge' : scenario];
      const common = airportSpawnPlan('RKPC', scenario, {
        groundClearanceM: CLEARANCE_M, aircraftId,
      });
      assert.ok(common, `${aircraftId}/${scenario} must have a common spawn plan`);
      closePose(common, expected, 0.001);
    }
  }
});

test('map entry and preset use the same corrected RKPC threshold and elevation', () => {
  const airport = applyAirportOverrides(INDEX_RECORD);
  for (const scenario of ['runway', 'approach']) {
    const preset = airportSpawnPlan('RKPC', scenario, {
      groundClearanceM: CLEARANCE_M, aircraftId: 'B738',
    });
    const map = resolveMapFlightPlan({
      state: scenario,
      airport,
      runwayId: '237295',
      endId: '07',
      baseOffset: projectToLocal(INDEX_RECORD.latitude, INDEX_RECORD.longitude),
      anchorBase: BASE_OFFSETS.jeju,
      aircraftId: 'B738',
    });
    assert.ok(map, `${scenario} map plan must exist`);
    // WGS84 round-trip through two projections leaves sub-5 m drift.
    closePose(map.spawn, preset, 5);
  }
});

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

test('Jeju preset start streams RKPC and aligns the pose with the common surface', () => withStorage(async () => {
  const calls = [];
  const sim = {
    lobby: { airport: 'jeju', aircraft: 'B738', preset: 'runway', pilotMode: 'human' },
    destinationAirport: 'none',
    currentAircraftId: 'B738',
    sky: { timeOfDay: 12 },
    gear: { cgGroundHeightM: CLEARANCE_M },
    position: { x: 0, y: 0, z: 0 },
    currentTerrain: { getHeight: () => 39.5 },
    devRunner: { stop() {} }, shadowDemo: { stop() {} }, replayDirector: { stop() {} },
    demoDirector: { userTimeOfDayOverridden: true },
    gameFlow: new GameFlowController(),
    analytics: { trackFlightStart() {} },
    beginFlightRecording() {},
    setPreset(scenario) { calls.push(['preset', scenario]); },
    airportStreamer: {
      releaseGroundHold() { calls.push(['release']); },
      ensure(code) { calls.push(['ensure', code]); },
      setHome(code) { calls.push(['home', code]); },
      statusFor(code) { return { state: 'ready', code }; },
      update() { calls.push(['update']); },
    },
  };
  await createSimulatorScenarioStart(sim).start();
  assert.ok(calls.some(call => call[0] === 'ensure' && call[1] === 'RKPC'),
    'Jeju preset must load the indexed RKPC airport');
  assert.ok(calls.some(call => call[0] === 'home' && call[1] === 'RKPC'),
    'spawn airport must be held by the streamer, not by navigation state');
  assert.equal(sim.destinationAirport, 'none', 'the chosen destination must be preserved');
  assert.equal(sim.position.y, 43, 'runway pose must be aligned to the common contact surface');
}));

test('RKPC remains a streamable destination without the map catalog', () => {
  assert.equal(isExternalDestination('RKPC'), true);
});
