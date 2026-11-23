import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  CHUJA_EMERGENCY_STRIP,
  isWithinChujaEmergencyStrip,
  JEJU_ORIGIN,
  wgs84ToJejuLocal,
} from '../src/geospatial/CorridorCoordinateSystem.js';
import { CorridorFlightSurface } from '../src/environment/CorridorFlightSurface.js';
import { WaterDitching } from '../src/physics/WaterDitching.js';
import { BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';
import { airportSpawnPlan } from '../src/config/airportSpawnPlan.js';
import { OpenWorldRegionSurface } from '../src/environment/OpenWorldRegionSurface.js';
import { CorridorTileStreamer } from '../src/environment/CorridorTileStreamer.js';
import { REGION_SURFACES } from '../src/config/regionSurfaces.js';
import { DEV_SCENARIOS } from '../src/dev/scenarios/index.js';
import { setLanguage, t } from '../src/i18n/index.js';

test('CHUJA_EMERGENCY_STRIP geometry and bounds detection', () => {
  const strip = CHUJA_EMERGENCY_STRIP;
  assert.equal(strip.elevationM, 12.0);
  assert.equal(strip.headingDeg, 45.0);
  assert.equal(strip.lengthM, 900.0);
  assert.equal(strip.widthM, 45.0);
  assert.equal(strip.safetyLengthM, 1100.0);
  assert.equal(strip.safetyWidthM, 80.0);

  const centerLat = strip.center.latitude;
  const centerLon = strip.center.longitude;

  // Center point is within runway
  assert.equal(isWithinChujaEmergencyStrip(centerLat, centerLon, false), true);
  assert.equal(isWithinChujaEmergencyStrip(centerLat, centerLon, true), true);

  // Runway threshold (400m along 045° heading)
  // dLat ~ 400 * cos(45°) / 111000 ~ 0.002548
  // dLon ~ 400 * sin(45°) / (111320 * cos(34°)) ~ 0.003069
  const thresholdLat = centerLat + 0.0025;
  const thresholdLon = centerLon + 0.0030;
  assert.equal(isWithinChujaEmergencyStrip(thresholdLat, thresholdLon, false), true);

  // Point beyond runway end but within safety area (500m along runway)
  const overrunLat = centerLat + 0.00318;
  const overrunLon = centerLon + 0.00383;
  assert.equal(isWithinChujaEmergencyStrip(overrunLat, overrunLon, false), false);
  assert.equal(isWithinChujaEmergencyStrip(overrunLat, overrunLon, true), true);

  // Point far away (e.g. 2km out in the ocean)
  assert.equal(isWithinChujaEmergencyStrip(centerLat + 0.02, centerLon, false), false);
  assert.equal(isWithinChujaEmergencyStrip(centerLat + 0.02, centerLon, true), false);
});

test('CorridorFlightSurface flattens Chuja emergency strip and recognizes runway containment', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });

  const centerLat = CHUJA_EMERGENCY_STRIP.center.latitude;
  const centerLon = CHUJA_EMERGENCY_STRIP.center.longitude;
  const [cx, cz] = wgs84ToJejuLocal(centerLat, centerLon);

  // Runway center elevation must be exactly 12.0m
  const runwayElev = surface.getHeight(cx, cz);
  assert.equal(runwayElev, 12.0, `Runway elevation must be 12.0m, got ${runwayElev}`);

  // Must be recognized as runway and safety area
  assert.equal(surface.isOnRunway(cx, cz), true);
  assert.equal(surface.isRunwaySafetyArea(cx, cz), true);
  assert.equal(surface.isWater(cx, cz), false);

  // Natural mountain ridge ~1.5km east of emergency strip (Mount Bonggu)
  const [mx, mz] = wgs84ToJejuLocal(centerLat, centerLon + 0.016);
  const mountainElev = surface.getHeight(mx, mz);
  assert.ok(mountainElev > 50.0, `Mountain elevation should be > 50m, got ${mountainElev}`);
  assert.equal(surface.isOnRunway(mx, mz), false);
  assert.equal(surface.isRunwaySafetyArea(mx, mz), false);
});

test('common RKPC challenge pose initializes dual engine-out glide towards Chuja Island', () => {
  const spawnB738 = airportSpawnPlan('RKPC', 'challenge', { groundClearanceM: 3.5, aircraftId: 'B738' });
  assert.equal(spawnB738.y, 2400, 'Challenge altitude should be 2,400m MSL (~7,870 ft)');
  assert.ok(Math.abs(spawnB738.vx) < 1e-9, 'Heading is due south');
  assert.equal(spawnB738.vz, 110, 'Glide forward velocity should be 110 m/s');
  assert.equal(spawnB738.vy, -2.8, 'Descent velocity should be -2.8 m/s (~550 fpm)');

  // Verify position is ~15km north of Chuja Island
  const [cx, cz] = wgs84ToJejuLocal(CHUJA_EMERGENCY_STRIP.center.latitude, CHUJA_EMERGENCY_STRIP.center.longitude);
  const distToChuja = Math.hypot(spawnB738.x - cx, spawnB738.z - cz);
  assert.ok(distToChuja > 14000 && distToChuja < 16000, `Distance to Chuja should be ~15km, got ${distToChuja}m`);

  // Light aircraft C172 configuration
  const spawnC172 = airportSpawnPlan('RKPC', 'challenge', { groundClearanceM: 1.8, aircraftId: 'C172' });
  assert.equal(spawnC172.vz, 45, 'C172 glide speed should be 45 m/s');
});

test('Corridor water ditching physical simulation produces non-catastrophic hydroplaning and debrief trigger', () => {
  const surface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  const ditching = new WaterDitching();

  const mockMesh = new THREE.Object3D();
  mockMesh.position.set(-18000, 0.5, -40000); // 0.5m above water in the Korea Strait
  mockMesh.quaternion.setFromEuler(new THREE.Euler(0.08, Math.PI, 0, 'YXZ')); // 4.5° nose-up pitch
  mockMesh.updateMatrixWorld(true);

  const linearVelocity = new THREE.Vector3(0, -1.0, 68); // 1.0 m/s sink rate, 68 m/s forward
  const angularVelocity = new THREE.Vector3(0, 0, 0);

  const aero = {
    mass: 65000,
    invIxx: 1 / 1650000,
    invIyy: 1 / 3450000,
    invIzz: 1 / 4850000,
    cg: { x: 0, y: 0, z: 0 },
  };

  // Touchdown frame
  const dt = 0.05;
  const result = ditching.update(
    dt,
    mockMesh,
    linearVelocity,
    angularVelocity,
    surface,
    aero,
    BODY_SUPPORT_POINTS,
    0, // gear retracted
    4.5, // pitch deg
    0.0 // roll deg
  );

  assert.equal(result.catastrophic, false, 'Controlled ditching must not be catastrophic');
  assert.equal(result.ditchingContact, true, 'Ditching contact must be latched');
  assert.ok(result.forces.y > 0, `Buoyant and planing forces must be positive upward, got ${result.forces.y}`);
  assert.equal(ditching.ditchingPhase, 'planing');

  // Fast forward 10 seconds of water contact to simulate hydroplaning deceleration and flooding
  for (let step = 0; step < 200; step++) {
    linearVelocity.z = Math.max(0, linearVelocity.z - 0.4);
    linearVelocity.y = -0.05;
    mockMesh.position.y = -0.5; // submerged hull
    ditching.update(
      dt,
      mockMesh,
      linearVelocity,
      angularVelocity,
      surface,
      aero,
      BODY_SUPPORT_POINTS,
      0,
      2.0,
      0.0
    );
  }

  assert.ok(ditching.flooding > 0.1, `Hull must take on water, got flooding ${ditching.flooding}`);
  assert.ok(ditching.timeOnWater > 9.0, 'Time on water must accumulate');
});

test('DEV_SCENARIOS.corridor-ditching is registered and properly configured', () => {
  const scenario = DEV_SCENARIOS['corridor-ditching'];
  assert.ok(scenario, 'corridor-ditching must exist in DEV_SCENARIOS');
  assert.deepEqual(scenario.airports, ['jeju']);
  assert.deepEqual(scenario.aircraft, ['B738']);
  assert.equal(scenario.kind, 'physical');
  assert.equal(scenario.duration, 35);

  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    assert.notEqual(t(scenario.labelKey), scenario.labelKey);
    assert.notEqual(t(scenario.descriptionKey), scenario.descriptionKey);
  }
  setLanguage('en');

  // Verify setup injects dual engine failure and zero throttle
  const mockSim = {
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    controls: { throttle: 1, setParkingBrake() {} },
    autopilot: { disengage() {} },
    engines: {
      failed: [false, false],
      n1: [0, 0],
      n2: [0, 0],
      egt: [0, 0],
      fuelFlow: [0, 0],
      setEngineFailure(idx, state) { this.failed[idx] = state; },
      setThrottle(v) { this.throttle = v; },
    },
    gear: { setGearTarget() {}, gearState: 1, contacts: [] },
    currentTerrain: { getHeight: () => 0.0, getWaterLevel: () => 0.0 },
    waterDitching: { ditchingContact: true, flooding: 0.45 },
  };

  scenario.setup(mockSim);
  assert.equal(mockSim.engines.failed[0], true, 'Engine 1 must fail');
  assert.equal(mockSim.engines.failed[1], true, 'Engine 2 must fail');
  assert.equal(mockSim.controls.throttle, 0, 'Throttle must be 0');
  assert.equal(mockSim.gear.gearState, 0, 'Gear must be retracted');

  const obs = { speed: 1.0, crashed: false };
  scenario.observe(mockSim, obs);
  assert.equal(obs.ditched, true);
  assert.equal(scenario.verdict(obs), true, 'Verdict must pass on safe ditching with flooding');
});

test('common Jeju anchor mounts the Chuja strip and keeps corridor tiles clear of Hallasan', async () => {
  const config = REGION_SURFACES.jeju;
  const surface = new OpenWorldRegionSurface({
    ...config,
    fallback: new CorridorFlightSurface({ activeOrigin: config.origin }),
  });
  assert.equal(surface.stripMeshes.length, 1, 'Chuja strip mesh must be present');
  const corridorSurface = new CorridorFlightSurface({ activeOrigin: JEJU_ORIGIN });
  assert.ok(corridorSurface.corridorLengthM > 450000);
  const corridorStreamer = new CorridorTileStreamer(corridorSurface, { origin: JEJU_ORIGIN });

  // Chuja strip geometry is owned by the common anchor surface, not the island mesh.

  // Verify background tile geometry near Chuja does not bulge above 12.0m on the runway
  const { geo } = corridorStreamer.createTileGeometry({ x: 871, y: 409, zoom: 10 });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.hypot(x - (-18300), z - (-50007)) < 2500) {
      assert.ok(y <= 12.0001, `Background tile vertex near Chuja must not exceed 12m, got ${y}m`);
    }
  }

  // Verify that tile covering Jeju Island mainland excludes triangles over the high-res mesh
  const jejuTile = corridorStreamer.createTileGeometry({ x: 871, y: 410, zoom: 10 });
  const jejuIndices = jejuTile.geo.index.array;
  const jejuPos = jejuTile.geo.attributes.position;
  for (let i = 0; i < jejuIndices.length; i += 3) {
    const idx0 = jejuIndices[i];
    const idx1 = jejuIndices[i + 1];
    const idx2 = jejuIndices[i + 2];
    const triCenterX = (jejuPos.getX(idx0) + jejuPos.getX(idx1) + jejuPos.getX(idx2)) / 3;
    const triCenterZ = (jejuPos.getZ(idx0) + jejuPos.getZ(idx1) + jejuPos.getZ(idx2)) / 3;

    // No triangle should exist over central Jeju (e.g. Hallasan x=10000, z=15000)
    const isHallasanTriangle = Math.hypot(triCenterX - 10000, triCenterZ - 15000) < 5000;
    assert.equal(isHallasanTriangle, false, 'No low-res corridor triangle should exist over Hallasan');
  }
  surface.dispose();
});


