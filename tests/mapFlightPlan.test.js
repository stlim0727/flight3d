import test from 'node:test';
import assert from 'node:assert/strict';
import {
  headingToDirection, yawForHeading, directionToHeading, runwayEndFrame,
  takeoffSpawnPlan, cruiseSpawnPlan, approachSpawnPlan, resolveMapFlightPlan,
} from '../src/config/mapFlightPlan.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { mapPlanRegion } from '../src/config/mapFlightPlaces.js';

const close = (actual, expected, epsilon = 1e-9, label = 'value') => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`);
};

function syntheticAirport() {
  return {
    id: 'TEST',
    latitude: 37.4,
    longitude: 126.4,
    elevationM: 20,
    runways: [
      {
        id: '09/27',
        widthM: 45,
        lengthM: 3000,
        ends: [
          {
            ident: '09',
            physical: { x: -1500, z: 0, elevationM: 18 },
            threshold: { x: -1400, z: 0, elevationM: 17 },
            displacedThresholdM: 100,
            headingDegT: 88,
          },
          {
            ident: '27',
            physical: { x: 1500, z: 0, elevationM: 22 },
            threshold: { x: 1500, z: 0, elevationM: 21 },
            displacedThresholdM: 0,
            headingDegT: 272,
          },
        ],
      },
      {
        id: '18/36',
        widthM: 30,
        lengthM: 2000,
        ends: [
          { ident: '18', physical: { x: 0, z: -1000, elevationM: 19 }, threshold: { x: 0, z: -900, elevationM: 19 } },
          { ident: '36', physical: { x: 0, z: 1000, elevationM: 19 }, threshold: { x: 0, z: 1000, elevationM: 19 } },
        ],
      },
    ],
  };
}

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

test('heading, direction and yaw round trip through the world frame', () => {
  for (const heading of [0, 45, 90, 144.68220519241027, 270, 359.5]) {
    const direction = headingToDirection(heading);
    close(Math.hypot(direction.x, direction.z), 1, 1e-12, 'unit direction');
    close(directionToHeading(direction.x, direction.z), heading, 1e-9, `heading ${heading}`);
    close(yawForHeading(heading), -heading * Math.PI / 180, 1e-12, `yaw ${heading}`);
  }
  assert.deepEqual(headingToDirection(0), { x: 0, z: -1 });
  close(headingToDirection(90).x, 1);
  close(headingToDirection(90).z, 0);
  assert.equal(directionToHeading(0, -1), 0);
  assert.equal(directionToHeading(1, 0), 90);
  assert.equal(directionToHeading(0, 1), 180);
  assert.equal(directionToHeading(-1, 0), 270);
});

test('runway end frame derives heading from physical ends and aims at the threshold', () => {
  const airport = syntheticAirport();
  const frame = runwayEndFrame(airport, '09/27', '09');
  assert.equal(frame.runwayId, '09/27');
  assert.equal(frame.endId, '09');
  assert.equal(frame.headingDeg, 90); // Not the published headingDegT of 88.
  assert.deepEqual(frame.threshold, { x: -1400, z: 0, elevationM: 17 });
  close(frame.direction.x, 1);
  close(frame.direction.z, 0);
  close(frame.right.x, 0);
  close(frame.right.z, 1);
  assert.equal(frame.widthM, 45);
  assert.equal(frame.lengthM, 3000);
  assert.equal(frame.displacedThresholdM, 100);

  const reverse = runwayEndFrame(airport, '09/27', '27');
  assert.equal(reverse.headingDeg, 270); // Opposite end, opposite course.
  assert.deepEqual(reverse.threshold, { x: 1500, z: 0, elevationM: 21 });
  close(reverse.direction.z, 0);
  assert.equal(reverse.displacedThresholdM, 0);
  assert.equal(runwayEndFrame(airport, '18/36', '18').headingDeg, 180);
});

test('takeoff spawn sits 100 m past the threshold at ground clearance with zero velocity', () => {
  const frame = runwayEndFrame(syntheticAirport(), '09/27', '09');
  const plan = takeoffSpawnPlan({ frame, baseOffset: [300, 900], anchorBase: [50, 100] });
  assert.equal(plan.x, -1050); // -1400 + 100 + 300 - 50
  assert.equal(plan.z, 800); // 0 + 0 + 900 - 100
  assert.equal(plan.y, 20.5); // 17 + 3.5
  assert.deepEqual([plan.vx, plan.vy, plan.vz], [0, 0, 0]);
  assert.equal(plan.speedMps, 0);
  close(plan.yaw, -Math.PI / 2);
  assert.equal(plan.headingDeg, 90);
  assert.equal(plan.state, 'runway');

  const custom = takeoffSpawnPlan({ frame, groundClearanceM: 6 });
  assert.equal(custom.y, 23);
  assert.equal(custom.x, -1300);
  close(custom.z, 0);
});

test('cruise spawn projects WGS84 into the anchored world frame with the right speed', () => {
  const point = { latitude: 37.5054, longitude: 127.137, headingDeg: 284, altitudeM: 1150 };
  const [localX, localZ] = projectToLocal(point.latitude, point.longitude);
  const plan = cruiseSpawnPlan({ ...point, aircraftId: 'F16', anchorBase: [120, -80] });
  assert.equal(plan.x, localX - 120);
  assert.equal(plan.z, localZ + 80);
  assert.equal(plan.y, 1150);
  assert.equal(plan.vy, 0);
  close(plan.vx, 180 * Math.sin(284 * Math.PI / 180));
  close(plan.vz, -180 * Math.cos(284 * Math.PI / 180));
  close(Math.hypot(plan.vx, plan.vz), 180);
  close(plan.yaw, -284 * Math.PI / 180);
  assert.equal(plan.headingDeg, 284);
  assert.equal(plan.state, 'cruise');

  assert.equal(cruiseSpawnPlan({ latitude: point.latitude, longitude: point.longitude, headingDeg: 0, altitudeM: 1000 }).vx, 0);
  close(cruiseSpawnPlan({ ...point, aircraftId: 'C172' }).vx, 48 * Math.sin(284 * Math.PI / 180));
  close(Math.hypot(
    cruiseSpawnPlan({ ...point, aircraftId: 'B738' }).vx,
    cruiseSpawnPlan({ ...point, aircraftId: 'B738' }).vz,
  ), 108);
  close(Math.hypot(
    cruiseSpawnPlan({ ...point, aircraftId: 'Another' }).vx,
    cruiseSpawnPlan({ ...point, aircraftId: 'Another' }).vz,
  ), 108);
  // The Incheon projection origin is a known zero point.
  const origin = cruiseSpawnPlan({ latitude: 37.448, longitude: 126.455, headingDeg: 0, altitudeM: 900, anchorBase: [40, 60] });
  assert.equal(origin.x, -40);
  assert.equal(origin.z, -60);
});

test('approach spawn applies distance, glideslope, cross-track and intercept yaw', () => {
  const frame = runwayEndFrame(syntheticAirport(), '09/27', '09');
  const plan = approachSpawnPlan({
    frame, baseOffset: [300, 900], anchorBase: [50, 100], distanceM: 5556,
    glideslopeDeg: 3, lateralOffsetM: 200, interceptOffsetDeg: 10, aircraftId: 'B738',
  });
  close(plan.x, -1400 - 5556 + 300 - 50, 1e-6, 'x'); // direction.x = 1, right.x ~ 0
  close(plan.z, 200 + 900 - 100, 1e-6, 'z'); // threshold.z = 0, direction.z = 0, right.z = 1
  close(plan.y, 17 + 3.5 + 5556 * Math.tan(3 * Math.PI / 180), 1e-9, 'y');
  close(Math.hypot(plan.vx, plan.vz), 74.5);
  close(plan.vx, 74.5);
  close(plan.vz, 0);
  close(plan.vy, -74.5 * Math.tan(3 * Math.PI / 180));
  close(Math.abs(plan.vy / plan.vx), Math.tan(3 * Math.PI / 180), 1e-12, 'sink ratio');
  close(plan.yaw, yawForHeading(100));
  assert.equal(plan.headingDeg, 100);
  assert.equal(plan.state, 'approach');

  const defaults = approachSpawnPlan({ frame });
  close(defaults.x, -1400 - 5556);
  close(defaults.z, 0);
  close(defaults.y, 20.5 + 5556 * Math.tan(3 * Math.PI / 180));
  assert.equal(defaults.state, 'approach');
  assert.equal(approachSpawnPlan({ frame, aircraftId: 'C172' }).vx, 33);
  assert.equal(approachSpawnPlan({ frame, aircraftId: 'F16' }).vx, 90);
  assert.equal(approachSpawnPlan({ frame, aircraftId: 'Other' }).vx, 74.5);
});

test('runway and approach starts use the first indexed end when direction is automatic', () => {
  const airport = syntheticAirport();
  for (const state of ['runway', 'approach']) {
    const automatic = resolveMapFlightPlan({ airport, state });
    const explicit = resolveMapFlightPlan({ airport, state, runwayId: '09/27', endId: '09' });
    assert.ok(automatic);
    assert.deepEqual(automatic, explicit);
  }
});

test('resolveMapFlightPlan builds each scenario and rejects invalid selections', () => {
  const airport = syntheticAirport();
  const point = { latitude: 37.413, longitude: 127.027, headingDeg: 303, altitudeM: 1300 };
  const options = { airport, runwayId: '09/27', endId: '09', baseOffset: [300, 900], anchorBase: [50, 100] };
  const runway = resolveMapFlightPlan({ ...options, state: 'runway' });
  assert.equal(runway.scenario, 'runway');
  assert.deepEqual(runway.spawn, takeoffSpawnPlan({ ...options, frame: runwayEndFrame(airport, '09/27', '09') }));
  const approach = resolveMapFlightPlan({ ...options, state: 'approach', aircraftId: 'C172' });
  assert.equal(approach.scenario, 'approach');
  assert.equal(approach.spawn.vx, 33);
  assert.equal(approach.spawn.state, 'approach');
  const cruise = resolveMapFlightPlan({ state: 'cruise', point, anchorBase: [50, 100], aircraftId: 'F16' });
  assert.equal(cruise.scenario, 'cruise');
  assert.deepEqual(cruise.spawn, cruiseSpawnPlan({ ...point, anchorBase: [50, 100], aircraftId: 'F16' }));

  assert.equal(resolveMapFlightPlan({ ...options, state: 'unknown' }), null);
  assert.equal(resolveMapFlightPlan({ ...options, state: 'runway', runwayId: 'missing' }), null);
  assert.equal(resolveMapFlightPlan({ ...options, state: 'approach', endId: 'missing' }), null);
  assert.equal(resolveMapFlightPlan({ state: 'runway' }), null);
  assert.equal(resolveMapFlightPlan({ state: 'cruise' }), null);
  assert.equal(resolveMapFlightPlan(), null);
});

test('incomplete runway data and invalid spawns return null', () => {
  const airport = syntheticAirport();
  assert.equal(runwayEndFrame(null, '09/27', '09'), null);
  assert.equal(runwayEndFrame(airport, 'missing', '09'), null);
  assert.equal(runwayEndFrame(airport, '09/27', 'missing'), null);
  assert.equal(runwayEndFrame({}, '09/27', '09'), null);
  assert.equal(runwayEndFrame({ runways: [{ id: 'X', ends: [{ ident: 'A' }] }] }, 'X', 'A'), null);
  const degenerate = { runways: [{ id: 'X', ends: [
    { ident: 'A', physical: { x: 0, z: 0 }, threshold: { x: 0, z: 0 } },
    { ident: 'B', physical: { x: 0, z: 0 }, threshold: { x: 0, z: 0 } },
  ] }] };
  assert.equal(runwayEndFrame(degenerate, 'X', 'A'), null);
  const missingThreshold = structuredClone(airport);
  delete missingThreshold.runways[0].ends[0].threshold;
  assert.equal(runwayEndFrame(missingThreshold, '09/27', '09'), null);
  assert.equal(takeoffSpawnPlan({}), null);
  assert.equal(takeoffSpawnPlan({ frame: null }), null);
  assert.equal(approachSpawnPlan({}), null);
  assert.equal(cruiseSpawnPlan({ latitude: NaN, longitude: 127, headingDeg: 0, altitudeM: 100 }), null);
});

test('planning never mutates its inputs', () => {
  const airport = deepFreeze(syntheticAirport());
  const point = deepFreeze({ latitude: 37.5054, longitude: 127.137, headingDeg: 284, altitudeM: 1150 });
  const baseOffset = deepFreeze([300, 900]);
  const anchorBase = deepFreeze([50, 100]);
  const frame = runwayEndFrame(airport, '09/27', '09');
  takeoffSpawnPlan({ frame, baseOffset, anchorBase });
  approachSpawnPlan({ frame, baseOffset, anchorBase, lateralOffsetM: 200, interceptOffsetDeg: 10 });
  cruiseSpawnPlan({ ...point, anchorBase });
  resolveMapFlightPlan({ state: 'runway', airport, runwayId: '09/27', endId: '09', baseOffset, anchorBase });
  resolveMapFlightPlan({ state: 'approach', airport, runwayId: '09/27', endId: '09', baseOffset, anchorBase });
  resolveMapFlightPlan({ state: 'cruise', point, anchorBase });
  assert.deepEqual(baseOffset, [300, 900]);
  assert.deepEqual(anchorBase, [50, 100]);
  assert.equal(airport.runways[0].ends[0].threshold.x, -1400);
  assert.equal(point.headingDeg, 284);
});

test('runway starts use the aircraft-specific resting gear height', () => {
  const frame = runwayEndFrame(syntheticAirport(), '09/27', '09');
  const b738 = takeoffSpawnPlan({ frame, aircraftId: 'B738' });
  const c172 = takeoffSpawnPlan({ frame, aircraftId: 'C172' });
  close(b738.y - frame.threshold.elevationM, 3.5, 1e-9, 'B738 clearance');
  close(c172.y - frame.threshold.elevationM, 1.35, 1e-9, 'C172 clearance');
  const approach = approachSpawnPlan({ frame, distanceM: 0, aircraftId: 'C172' });
  close(approach.y - frame.threshold.elevationM, 1.35, 1e-9, 'C172 approach clearance');
});

test('map plans select the geographic anchor that can stream their location', () => {
  assert.equal(mapPlanRegion({ state: 'cruise', pointId: 'jamsil' }, {
    points: [{ id: 'jamsil', airport: 'incheon' }],
  }), 'incheon');
  assert.equal(mapPlanRegion({ state: 'approach', airportCode: 'RKPC' }, {
    airports: [{ code: 'RKPC', latitude: 33.512, longitude: 126.493 }],
  }), 'jeju');
  assert.equal(mapPlanRegion({ state: 'runway', airportCode: 'RKSS' }, {
    airports: [{ code: 'RKSS', latitude: 37.558, longitude: 126.791 }],
  }), 'incheon');
});
