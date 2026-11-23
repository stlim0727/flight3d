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

test('RKSI and VNLK presets keep their validated poses', () => {
  const cases = [
    ['RKSI', 'runway', 'B738', 3.5, [-1588.118893, 10.5, -3665.574192, -2.525181, 0, 0, 0], 0],
    ['RKSI', 'approach', 'B738', 3.5, [-2513.096606, 89.111669, -4971.107121, -2.525181, 43.069275, -3.90438, 60.788877], 2.291831],
    ['RKSI', 'cruise', 'B738', 3.5, [-1356.874465, 750, -3339.19096, -2.525181, 62.435996, 0, 88.123473], 0],
    ['RKSI', 'challenge', 'B738', 3.5, [-5111.126218, 363.742786, -8032.60057, -2.176115, 69.897269, -2.5, 48.367053], 0.572958],
    ['RKSI', 'approach', 'C172', 1.4, [-2513.096606, 87.011669, -4971.107121, -2.525181, 19.077665, -1.729457, 26.926617], 2.291831],
    ['RKSI', 'cruise', 'F16', 3.5, [-1356.874465, 750, -3339.19096, -2.525181, 104.059993, 0, 146.872455], 0],
    ['VNLK', 'runway', 'B738', 3.5, [162.719765, 2862.441176, -107.574445, -4.153884, 0, 0, 0], -6.71],
    ['VNLK', 'runway', 'F16', 3.5, [166.960005, 2863.029412, -110.22404, -4.153884, 0, 0, 0], -6.71],
    ['VNLK', 'cliff', 'B738', 3.5, [162.719765, 2862.441176, -107.574445, -4.153884, 0, 0, 0], -6.71],
    ['VNLK', 'approach', 'B738', 3.5, [-3222.5824, 3070, 2013.6922, -1.012291, 58.854531, -5.2, -36.776379], 1],
    ['VNLK', 'cruise', 'B738', 3.5, [-1500, 3960, -800, -0.942478, 80, 0, -60], 0],
    ['VNLK', 'cruise', 'C172', 1.4, [-1500, 3960, -800, -0.942478, 42.4, 0, -31.8], 0],
  ];
  for (const [code, scenario, aircraftId, clearance, expected, pitchDeg] of cases) {
    const plan = airportSpawnPlan(code, scenario, { groundClearanceM: clearance, aircraftId });
    assert.ok(plan, `${code}/${scenario}/${aircraftId} must have a plan`);
    closePose(plan, {
      x: expected[0], y: expected[1], z: expected[2], yaw: expected[3],
      vx: expected[4], vy: expected[5], vz: expected[6],
    }, 0.01);
    assert.ok(Math.abs(plan.pitchDeg - pitchDeg) < 0.001, `${code}/${scenario}/${aircraftId} pitch`);
  }
});

test('Lukla preset streams VNLK and hides the duplicate legacy runway', () => withStorage(async () => {
  const calls = [];
  const legacyRunway = { visible: true };
  const sim = {
    lobby: { airport: 'lukla', aircraft: 'B738', preset: 'runway', pilotMode: 'human' },
    destinationAirport: 'none',
    currentAircraftId: 'B738',
    sky: { timeOfDay: 12 },
    gear: { cgGroundHeightM: CLEARANCE_M },
    position: { x: 0, y: 0, z: 0 },
    currentTerrain: { getHeight: () => 2862 },
    luklaAirport: { runwayGroup: legacyRunway },
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
      regionFor(code) { return code === 'VNLK' ? { airport: {} } : null; },
    },
  };
  await createSimulatorScenarioStart(sim).start();
  assert.ok(calls.some(call => call[0] === 'ensure' && call[1] === 'VNLK'),
    'Lukla preset must load the indexed VNLK airport');
  assert.ok(calls.some(call => call[0] === 'home' && call[1] === 'VNLK'));
  assert.equal(legacyRunway.visible, false, 'common runway replaces the legacy mesh');
  assert.equal(sim.destinationAirport, 'none', 'chosen destination must be preserved');
}));

test('Incheon preset streams RKSI and hides only duplicate runway meshes', () => withStorage(async () => {
  const calls = [];
  const details = { visible: true };
  const runwayPavement = { name: 'incheon-runway-pavement', visible: true };
  const markings = { name: 'incheon-runway-marking-pavement', visible: true };
  const taxiway = { name: 'incheon-taxiway-pavement', visible: true };
  const sim = {
    lobby: { airport: 'incheon', aircraft: 'B738', preset: 'runway', pilotMode: 'human' },
    destinationAirport: 'none',
    currentAircraftId: 'B738',
    sky: { timeOfDay: 12 },
    gear: { cgGroundHeightM: CLEARANCE_M },
    position: { x: 0, y: 0, z: 0 },
    currentTerrain: { getHeight: () => 10.5 },
    incheonAirport: {
      legacyRunwayDetails: details,
      pavement: { children: [runwayPavement, markings, taxiway] },
      resetTraffic() {},
    },
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
      regionFor(code) { return code === 'RKSI' ? { airport: {} } : null; },
    },
  };
  await createSimulatorScenarioStart(sim).start();
  assert.ok(calls.some(call => call[0] === 'ensure' && call[1] === 'RKSI'));
  assert.ok(calls.some(call => call[0] === 'home' && call[1] === 'RKSI'));
  assert.equal(details.visible, false);
  assert.equal(runwayPavement.visible, false);
  assert.equal(markings.visible, false);
  assert.equal(taxiway.visible, true, 'taxiways and aprons must remain');
  assert.equal(sim.destinationAirport, 'none');
}));
