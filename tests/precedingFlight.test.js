import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PrecedingFlight, TRAFFIC_PHASES as P } from '../src/environment/PrecedingFlight.js';
import { buildPrecedingFlightVisuals } from '../src/environment/PrecedingFlightVisuals.js';
import { PRECEDING_TRAFFIC, TRAFFIC_SPACING } from '../src/config/precedingTraffic.js';
import { samplePathCurvature } from '../src/geospatial/departureRoutePath.js';

const dt = 1 / 60;
function run(flight, seconds, each = () => {}) {
  for (let t = 0; t < seconds; t += dt) { each(flight); flight.update(dt); }
}
function runUntil(flight, predicate, limit = 900, each = () => {}) {
  for (let t = 0; t < limit; t += dt) { if (predicate(flight)) return t; each(flight); flight.update(dt); }
  assert.fail(`condition not reached in ${limit}s (phase ${flight.phase})`);
}

test('KE653 identity matches the agreed design', () => {
  assert.equal(PRECEDING_TRAFFIC.flight, 'KE653');
  assert.equal(PRECEDING_TRAFFIC.squawk, '5108');
  assert.equal(PRECEDING_TRAFFIC.livery, 'korean');
  assert.equal(PRECEDING_TRAFFIC.headStartMeters, 250);
  assert.equal(TRAFFIC_SPACING.watchdogSeconds, 120);
});

test('standby traffic waits at its head start until started', () => {
  const flight = new PrecedingFlight();
  assert.equal(flight.phase, P.STANDBY);
  assert.equal(flight.s, 250);
  run(flight, 30);
  assert.equal(flight.s, 250);
  assert.equal(flight.speed, 0);
});

test('taxi respects the cruise and turn speed limits and stops exactly at hold short', () => {
  const flight = new PrecedingFlight();
  flight.start();
  let maximum = 0, turnExcess = 0;
  runUntil(flight, f => f.phase === P.HOLD_SHORT, 600, f => {
    maximum = Math.max(maximum, f.speed);
    const curvature = Math.abs(samplePathCurvature(f.path, f.s, 16));
    if (curvature > 0.02) turnExcess = Math.max(turnExcess, f.speed - Math.sqrt(PRECEDING_TRAFFIC.lateralAcceleration / curvature) - 1);
  });
  assert.ok(maximum <= PRECEDING_TRAFFIC.taxiSpeed + 1e-9, `max taxi speed ${maximum}`);
  assert.ok(turnExcess <= 0, `turn speed exceeded by ${turnExcess}`);
  assert.ok(Math.abs(flight.s - flight.path.holdShort) < 0.05);
  assert.equal(flight.speed, 0);
});

test('hold short persists without release, then lines up and waits without takeoff clearance', () => {
  const flight = new PrecedingFlight();
  flight.start();
  runUntil(flight, f => f.phase === P.HOLD_SHORT);
  run(flight, 300);
  assert.equal(flight.phase, P.HOLD_SHORT, 'no release, no line-up');
  flight.release();
  run(flight, PRECEDING_TRAFFIC.lineUpDelaySeconds - 0.5);
  assert.equal(flight.phase, P.HOLD_SHORT, 'line-up delay applies after release');
  runUntil(flight, f => f.s >= f.path.lineUp - 0.05 && f.speed === 0);
  run(flight, 120);
  assert.equal(flight.phase, P.LINEUP, 'line up and wait until cleared');
  assert.equal(flight.onGround, true);
});

test('takeoff roll rotates at Vr, retracts gear, spaces the player 15 s after rotation and vacates', () => {
  const flight = new PrecedingFlight();
  flight.start(); flight.clearForTakeoff();
  runUntil(flight, f => f.phase === P.ROLL);
  assert.equal(flight.hasSpacedForPlayer(), false);
  runUntil(flight, f => f.hasRotated);
  assert.ok(flight.speed >= PRECEDING_TRAFFIC.rotateSpeed);
  assert.ok(flight.s < flight.path.runwayEnd - 1500, 'rotation leaves most of the runway behind it');
  runUntil(flight, f => f.phase === P.CLIMB);
  assert.equal(flight.onGround, false);
  assert.ok(flight.pitch > 0);
  run(flight, TRAFFIC_SPACING.rotationSpacingSeconds - flight.rotationElapsed - 0.5);
  assert.equal(flight.hasSpacedForPlayer(), false, 'not yet spaced just before 15 s');
  run(flight, 1);
  assert.equal(flight.hasSpacedForPlayer(), true);
  runUntil(flight, f => !f.gearDown);
  assert.ok(flight.height >= PRECEDING_TRAFFIC.gearRetractHeight);
  runUntil(flight, f => f.phase === P.VACATED);
  assert.equal(flight.runwayVacated, true);
  const frozen = flight.s;
  run(flight, 5);
  assert.equal(flight.s, frozen, 'vacated traffic no longer moves');
});

test('phase ordering, separation and ahead queries', () => {
  const flight = new PrecedingFlight();
  assert.equal(flight.phaseAtLeast(P.STANDBY), true);
  assert.equal(flight.phaseAtLeast(P.TAXI), false);
  flight.start();
  assert.equal(flight.phaseAtLeast(P.TAXI), true);
  assert.equal(flight.phaseAtLeast(P.ROLL), false);
  const { x, z, heading } = flight.pose;
  const behind = { x: x - Math.sin(heading) * 40, y: 0, z: z + Math.cos(heading) * 40 };
  assert.ok(Math.abs(flight.separationFrom(behind).horizontal - 40) < 1e-9);
  assert.equal(flight.isAheadOf(behind, heading), true);
  const ahead = { x: x + Math.sin(heading) * 40, y: 0, z: z - Math.cos(heading) * 40 };
  assert.equal(flight.isAheadOf(ahead, heading), false);
});

test('reset returns to standby at the head start', () => {
  const flight = new PrecedingFlight();
  flight.start(); flight.clearForTakeoff();
  run(flight, 200);
  flight.reset();
  assert.equal(flight.phase, P.STANDBY);
  assert.equal(flight.s, 250);
  assert.equal(flight.hasRotated, false);
  assert.equal(flight.released, false);
});

function fakeAssets() {
  const geometry = new THREE.BoxGeometry(4, 4, 38), decals = new THREE.BoxGeometry(1, 1, 1), gear = new THREE.BoxGeometry(6, 2, 18);
  gear.translate(0, -2.5, -6); // Main gear aft at z = +3.
  const material = () => new THREE.MeshStandardMaterial();
  return { geometry, decals, gear, liveries: { korean: { body: material(), decal: material() }, jeju: { body: material(), decal: material() } } };
}

test('visuals reuse shared parked assets, pivot on the main gear and hide gear after retraction', () => {
  const assets = fakeAssets(), gearMaterial = new THREE.MeshStandardMaterial();
  const visuals = buildPrecedingFlightVisuals(assets, { gearMaterial, groundY: 7 });
  const body = visuals.group.getObjectByName('preceding-flight-body');
  assert.equal(body.geometry, assets.geometry);
  assert.equal(body.material, assets.liveries.korean.body);
  assert.equal(visuals.gear.material, gearMaterial);
  assert.ok(Math.abs(visuals.pivotZ - 2.5) < 1e-9);
  const flight = new PrecedingFlight();
  flight.attachVisuals(visuals);
  const { x, z, heading } = flight.pose;
  // The model centre (aircraft origin, 3.5 m above pavement) coincides with the path pose.
  const centre = new THREE.Vector3(0, 3.5, -visuals.pivotZ).applyQuaternion(visuals.group.quaternion).add(visuals.group.position);
  assert.ok(Math.hypot(centre.x - x, centre.z - z) < 1e-9);
  assert.ok(Math.abs(centre.y - 10.5) < 1e-9);
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(visuals.group.quaternion);
  assert.ok(Math.abs(Math.atan2(nose.x, -nose.z) - heading) < 1e-9);
  flight.height = 30; flight.pitch = 0.1; flight.updatePose();
  assert.equal(visuals.gear.visible, false);
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(visuals.group.quaternion).y > 0, 'positive pitch raises the nose');
  flight.phase = P.VACATED; flight.updatePose();
  assert.equal(visuals.group.visible, false);
});

test('dispose detaches visuals without freeing shared parked geometry or materials', () => {
  const assets = fakeAssets(), scene = new THREE.Scene(), disposed = [];
  for (const resource of [assets.geometry, assets.decals, assets.gear, assets.liveries.korean.body, assets.liveries.korean.decal]) {
    resource.addEventListener('dispose', () => disposed.push(resource));
  }
  const visuals = buildPrecedingFlightVisuals(assets, { gearMaterial: new THREE.MeshStandardMaterial() });
  scene.add(visuals.group);
  const flight = new PrecedingFlight();
  flight.attachVisuals(visuals);
  flight.dispose();
  assert.equal(visuals.group.parent, null);
  assert.equal(flight.visuals, null);
  assert.deepEqual(disposed, []);
});
