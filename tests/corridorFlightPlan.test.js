import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => noop,
    has: () => false,
  });
  globalThis.document = {
    createElement: () => ({ getContext: () => mockCtx, width: 512, height: 512 }),
  };
}

import {
  CORRIDOR_WAYPOINTS_EXPANDED,
  calculateBearingDeg,
  calculateCrossTrackErrorM,
  findActiveWaypointIndex,
  getActiveLegInfo,
  CorridorFlightPlanManager,
} from '../src/geospatial/CorridorFlightPlan.js';
import { AutopilotController } from '../src/physics/Autopilot.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';
import { DEV_SCENARIOS } from '../src/dev/scenarios/index.js';

test('CORRIDOR_WAYPOINTS_EXPANDED includes all corridor waypoints and Chuja', () => {
  assert.equal(CORRIDOR_WAYPOINTS_EXPANDED.length, 8);
  const idents = CORRIDOR_WAYPOINTS_EXPANDED.map(w => w.ident);
  assert.deepEqual(idents, ['RKSI', 'BOPTA', 'OLMEN', 'SOSDO', 'DOTOL', 'CHUJA', 'TAMNA', 'RW07']);

  const chuja = CORRIDOR_WAYPOINTS_EXPANDED.find(w => w.ident === 'CHUJA');
  assert.ok(chuja);
  assert.equal(chuja.latitude, 33.9620);
  assert.equal(chuja.longitude, 126.2950);
  assert.equal(chuja.altitudeFt, 10000);
  assert.equal(chuja.speedKnots, 240);

  // Check pre-projected local metrics
  assert.ok(Number.isFinite(chuja.jejuX) && Number.isFinite(chuja.jejuZ));
  assert.ok(Number.isFinite(chuja.incheonX) && Number.isFinite(chuja.incheonZ));
});

test('calculateBearingDeg returns accurate compass headings', () => {
  // Directly north: (0, 0) to (1, 0) -> 0 deg
  assert.ok(Math.abs(calculateBearingDeg(0, 0, 1, 0) - 0) < 0.01);
  // Directly east: (0, 0) to (0, 1) -> 90 deg
  assert.ok(Math.abs(calculateBearingDeg(0, 0, 0, 1) - 90) < 0.01);
  // Directly south: (1, 0) to (0, 0) -> 180 deg
  assert.ok(Math.abs(calculateBearingDeg(1, 0, 0, 0) - 180) < 0.01);
  // Directly west: (0, 1) to (0, 0) -> 270 deg
  assert.ok(Math.abs(calculateBearingDeg(0, 1, 0, 0) - 270) < 0.01);

  // RKSI to BOPTA: South-Southwest heading (~190-200°)
  const rksi = CORRIDOR_WAYPOINTS_EXPANDED[0];
  const bopta = CORRIDOR_WAYPOINTS_EXPANDED[1];
  const brg = calculateBearingDeg(rksi.latitude, rksi.longitude, bopta.latitude, bopta.longitude);
  assert.ok(brg > 185 && brg < 205, `Expected heading ~195°, got ${brg}°`);
});

test('calculateCrossTrackErrorM detects left and right of track deviations', () => {
  const p1 = { lat: 36.0, lon: 126.0 };
  const p2 = { lat: 35.0, lon: 126.0 }; // True South track

  // On track: lat 35.5, lon 126.0
  const xtkOn = calculateCrossTrackErrorM(35.5, 126.0, p1.lat, p1.lon, p2.lat, p2.lon);
  assert.ok(Math.abs(xtkOn) < 1.0, `On-track error should be near 0, got ${xtkOn}`);

  // Right of track (East of southward track): lon 126.05
  const xtkRight = calculateCrossTrackErrorM(35.5, 126.05, p1.lat, p1.lon, p2.lat, p2.lon);
  assert.ok(xtkRight < 0, `Right of southward course in bearing convention should be negative cross track or positive depending on sign convention`);

  // Left of track (West of southward track): lon 125.95
  const xtkLeft = calculateCrossTrackErrorM(35.5, 125.95, p1.lat, p1.lon, p2.lat, p2.lon);
  assert.ok(Math.sign(xtkLeft) !== Math.sign(xtkRight), 'Left and right errors must have opposite signs');
});

test('findActiveWaypointIndex sequences progressively along corridor', () => {
  // Near Incheon / departing towards BOPTA
  const nearIncheon = findActiveWaypointIndex(37.45, 126.45, 1);
  assert.equal(nearIncheon, 1); // target is BOPTA

  // At BOPTA (within 4500m)
  const bopta = CORRIDOR_WAYPOINTS_EXPANDED[1];
  const atBopta = findActiveWaypointIndex(bopta.latitude, bopta.longitude, 1);
  assert.equal(atBopta, 2); // sequences to OLMEN

  // At Chuja Island (within 4500m)
  const chuja = CORRIDOR_WAYPOINTS_EXPANDED[5];
  const atChuja = findActiveWaypointIndex(chuja.latitude, chuja.longitude, 5);
  assert.equal(atChuja, 6); // sequences to TAMNA
});

test('CorridorFlightPlanManager manages state and CDU legs formatting', () => {
  const fpm = new CorridorFlightPlanManager(1);

  // Position between BOPTA and OLMEN
  const leg = fpm.update(36.2, 126.19);
  assert.equal(leg.activeIndex, 2); // OLMEN
  assert.equal(leg.activeWaypoint.ident, 'OLMEN');
  assert.ok(leg.distanceNm > 0);
  assert.ok(leg.bearingDeg > 170 && leg.bearingDeg < 210);

  // Verify CDU legs output
  const cduLegs = fpm.getCDULegs();
  assert.ok(cduLegs.length >= 2);
  const activeRow = cduLegs.find(r => r.isActive);
  assert.ok(activeRow);
  assert.equal(activeRow.ident, 'OLMEN');
  assert.ok(activeRow.spdAltStr.includes('280/FL240'));
});

test('AutopilotController engages and commands LNAV and VNAV modes', () => {
  const ap = new AutopilotController();
  const telemetry = {
    headingDeg: 195,
    rollDeg: 0,
    pitchDeg: 2,
    altitudeFt: 28000,
    vsiFpm: 0,
    iasKnots: 250,
    x: -15000,
    z: -70000,
    airportKey: 'jeju',
  };

  ap.engage('LNAV', telemetry);
  assert.equal(ap.master, true);
  assert.equal(ap.lateralMode, 'LNAV');
  assert.ok(ap.annunciation().includes('LNAV'));

  ap.engage('VNAV', telemetry);
  assert.equal(ap.verticalMode, 'VNAV');
  assert.ok(ap.annunciation().includes('LNAV VNAV'));

  // Test control command calculation
  const out = ap.update(telemetry, 0.05);
  assert.ok(Number.isFinite(out.aileron));
  assert.ok(Number.isFinite(out.elevator));

  // Toggle off
  assert.equal(ap.toggle('LNAV', telemetry), false);
  assert.equal(ap.lateralMode, null);
  assert.equal(ap.toggle('VNAV', telemetry), false);
  assert.equal(ap.verticalMode, 'PITCH');
});

test('NDCanvas and CDUCanvas render dynamic corridor waypoints', () => {
  const nd = new NDCanvas(256, 256);
  nd.setAirport('jeju');
  nd.setRange(40);
  assert.equal(nd.rangeNm, 40);

  // Simulate aircraft position near Chuja Island (z ~ -50,000m in Jeju frame)
  nd.updateData({ headingDeg: 195, trackDeg: 195, groundSpeedKnots: 250, tasKnots: 400, x: -18000, z: -50000 });
  nd.render();

  const cdu = new CDUCanvas(256, 256);
  cdu.setAirport('jeju');
  cdu.updateData({ z: -50000 });
  assert.doesNotThrow(() => cdu.render());

  cdu.setAirport('incheon');
  cdu.updateData({ z: 20000 });
  assert.doesNotThrow(() => cdu.render());
});

test('DEV_SCENARIOS.corridor-cruise is registered and configured', () => {
  const cruise = DEV_SCENARIOS['corridor-cruise'];
  assert.ok(cruise, 'corridor-cruise scenario must exist');
  assert.equal(cruise.kind, 'physical');
  assert.equal(cruise.duration, 30);
  assert.deepEqual(cruise.airports, ['jeju']);
  assert.deepEqual(cruise.aircraft, ['B738']);

  const mockSim = {
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    linearVelocity: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    quaternion: { setFromEuler() {} },
    gear: { setGearTarget() {}, gearState: 1 },
    aero: { setFlapPosition() {} },
    controls: { throttle: 0, setParkingBrake() {} },
    engines: { setThrottle() {} },
    autopilot: { master: false, lateralMode: null, verticalMode: null, targets: {} },
    isCrashed: false,
  };

  cruise.setup(mockSim);
  assert.equal(mockSim.position.y, 8534);
  assert.equal(mockSim.autopilot.master, true);
  assert.equal(mockSim.autopilot.lateralMode, 'LNAV');

  const obs = {};
  cruise.observe(mockSim, obs);
  assert.equal(obs.stableFlight, true);
  assert.equal(obs.lnavActive, true);
  assert.equal(cruise.verdict(obs), true);
});
