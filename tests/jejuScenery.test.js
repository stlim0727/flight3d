import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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

import { APPROACH_DATA, approachDeviation } from '../src/config/approachData.js';
import { CDUCanvas } from '../src/aircraft/CDUCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { JEJU_AIRFIELD, JejuFlightSurface, jejuSpawn } from '../src/geospatial/JejuFlightSurface.js';
import { loadJejuAirport } from '../src/environment/JejuAirport.js';
import { scenariosForAirport } from '../src/config/scenarioRegistry.js';
import { airportSpec } from '../src/ui/lobbySpecs.js';
import jejuMetadata from '../public/scenery/jeju/terrain-metadata.json' with { type: 'json' };

test('APPROACH_DATA.jeju defines Runway 07 geometry and elevation', () => {
  const jeju = APPROACH_DATA.jeju;
  assert.ok(jeju, 'APPROACH_DATA.jeju must be defined');
  assert.equal(jeju.headingDeg, 67);
  assert.equal(jeju.gsAngleDeg, 3.0);
  assert.equal(jeju.elevationFt, 118);
  assert.ok(jeju.threshold && Number.isFinite(jeju.threshold.x) && Number.isFinite(jeju.threshold.z));
  assert.ok(jeju.end && Number.isFinite(jeju.end.x) && Number.isFinite(jeju.end.z));

  // Threshold to end distance should match RW07 length (~3,180 m)
  const length = Math.hypot(jeju.end.x - jeju.threshold.x, jeju.end.z - jeju.threshold.z);
  assert.ok(Math.abs(length - 3180) < 10, `Runway length should be ~3,180 m, got ${length}`);

  // Test approach deviation calculation
  const onCourse = approachDeviation('jeju', { x: jeju.threshold.x, altitudeFt: 118, z: jeju.threshold.z });
  assert.equal(onCourse.courseDeg, 67);
  assert.equal(onCourse.crossTrackM, 0);
  assert.ok(Math.abs(onCourse.distanceToThresholdM) < 0.01);
  assert.ok(Math.abs(onCourse.glideslopeErrorFt) < 0.01);
  assert.ok(Number.isFinite(onCourse.referenceSinkFpm));
});

test('CDUCanvas supports Jeju and Incheon airport waypoint sequencing', () => {
  const cdu = new CDUCanvas();
  cdu.setAirport('jeju');
  assert.equal(cdu.airportId, 'jeju');
  assert.equal(cdu.activeWpt, 'RW07');

  cdu.setAirport('incheon');
  assert.equal(cdu.airportId, 'incheon');
  assert.equal(cdu.activeWpt, 'RW15R');
});

test('NDCanvas renders in Jeju mode without error', () => {
  const nd = new NDCanvas();
  nd.setAirport('jeju');
  assert.equal(nd.airportId, 'jeju');
  assert.doesNotThrow(() => nd.render());
});

test('public/scenery/jeju/terrain-metadata.json contains valid runway and Hallasan specs', () => {
  assert.equal(jejuMetadata.schemaVersion, 1);
  assert.equal(jejuMetadata.origin.latitude, 33.5113);
  assert.equal(jejuMetadata.origin.longitude, 126.4930);
  assert.equal(jejuMetadata.elevationM, 36.0);
  assert.equal(jejuMetadata.hallasan.elevationM, 1947.0);

  // Check runways
  assert.equal(jejuMetadata.runways.length, 2);
  const rw07 = jejuMetadata.runways.find(r => r.id === '07/25');
  assert.ok(rw07);
  assert.equal(rw07.lengthM, 3180);
  assert.equal(rw07.headingDeg, 67);

  const rw13 = jejuMetadata.runways.find(r => r.id === '13/31');
  assert.ok(rw13);
  assert.equal(rw13.lengthM, 1900);
  assert.equal(rw13.headingDeg, 132);
});

test('JejuFlightSurface models airport grade, Hallasan volcanic topography, and runway containment', () => {
  const surface = new JejuFlightSurface(JEJU_AIRFIELD);

  // Runway containment
  assert.equal(surface.isOnRunway(-1000, 424), true); // on RW07
  assert.equal(surface.isOnRunway(0, 0), true); // midpoint of RW07/25
  assert.equal(surface.isOnRunway(0, 500), false); // 500m south of runway
  assert.equal(surface.isRunwaySafetyArea(-1000, 424), true);

  // Leveled airport grade on runway
  assert.equal(surface.getHeight(-1000, 424), 36.0);

  // Hallasan summit elevation (around x=3741, z=16592)
  const summitH = surface.getHeight(3741.4, 16591.7);
  assert.ok(summitH > 1800, `Hallasan summit should exceed 1800m, got ${summitH}`);

  // Ocean / sea level outside island
  const oceanH = surface.getHeight(50000, 50000);
  assert.equal(oceanH, 0.0);

  // Normal vector calculation
  const normal = surface.getNormal(0, 0);
  assert.ok(normal.y > 0.9, 'Airport surface normal should point nearly vertical');
});

test('jejuSpawn computes valid state vectors for all Jeju scenarios', () => {
  const runwaySpawn = jejuSpawn('runway', 3.5, 'B738');
  assert.equal(runwaySpawn.vx, 0);
  assert.equal(runwaySpawn.vz, 0);
  assert.equal(runwaySpawn.y, 39.5); // 36m elevation + 3.5m clearance
  assert.ok(Math.abs(runwaySpawn.yaw - (-67 * Math.PI / 180)) < 0.01);

  const approachSpawn = jejuSpawn('approach', 3.5, 'B738');
  assert.ok(approachSpawn.y > 300, `Approach altitude should be > 300m, got ${approachSpawn.y}`);
  assert.ok(approachSpawn.vy < 0, 'Approach should have descending velocity');

  const cruiseSpawn = jejuSpawn('cruise', 3.5, 'B738');
  assert.equal(cruiseSpawn.y, 3048); // 10,000 ft
  assert.equal(cruiseSpawn.yaw, -Math.PI); // heading South
  assert.ok(cruiseSpawn.vz > 100);

  const challengeSpawn = jejuSpawn('challenge', 3.5, 'B738');
  assert.ok(challengeSpawn.y > 300);
  assert.ok(challengeSpawn.vy < 0);
});

test('loadJejuAirport builds 3D runways, terminal, tower, and lighting', async () => {
  const airport = await loadJejuAirport('', { loadSatellite: false });
  assert.ok(airport.terrain);
  assert.ok(airport.group);
  assert.ok(airport.nightLighting);
  assert.ok(airport.towerCab);

  // Collision checks with terminal and tower
  const towerProbe = [{ pos: new THREE.Vector3(-80, 50, 260), radius: 2, desc: 'cockpit' }];
  const towerHit = airport.checkBuildingCollision(towerProbe);
  assert.ok(towerHit);
  assert.equal(towerHit.part, 'tower');

  const terminalProbe = [{ pos: new THREE.Vector3(150, 45, 320), radius: 2, desc: 'wing' }];
  const terminalHit = airport.checkBuildingCollision(terminalProbe);
  assert.ok(terminalHit);
  assert.equal(terminalHit.part, 'terminal');

  const skyProbe = [{ pos: new THREE.Vector3(0, 1000, 0), radius: 2, desc: 'gear' }];
  assert.equal(airport.checkBuildingCollision(skyProbe), null);
});

test('scenarioRegistry and lobbySpecs expose Jeju scenarios and specs', () => {
  const scenarios = scenariosForAirport('jeju');
  assert.deepEqual(scenarios, ['runway', 'approach', 'challenge', 'cruise', 'demo']);

  const spec = airportSpec('jeju');
  assert.equal(spec, 'RWY 067° · 118 FT · GS 3°');
});

