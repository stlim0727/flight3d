import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterDitching, WATER_DITCHING_LIMITS } from '../src/physics/WaterDitching.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';

test('WaterDitching (Hydrodynamic Emergency Water Landing & Gradual Sinking)', async (t) => {
  const mockTerrain = {
    getHeight: (x, z) => (z > 2000 ? -25.0 : 12.0),
    getWaterLevel: (x, z) => 0.0,
  };

  const aero = {
    mass: 66000,
    invIxx: 1 / 1650000,
    invIyy: 1 / 3450000,
    invIzz: 1 / 4850000,
    cg: { x: 0, y: 0, z: 0 },
  };

  await t.test('permits gentle emergency water landing without catastrophic destruction', () => {
    const ditching = new WaterDitching();
    const mesh = new THREE.Object3D();
    // Aircraft approaching water surface at z = 3000 (ocean), y = 1.0m (belly near waterLevel 0.0)
    mesh.position.set(0, 1.0, 3000);
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(4.0)); // 4° pitch up

    const linearVel = new THREE.Vector3(0, -1.2, -65); // 1.2 m/s sink rate, 65 m/s (~126 kt) forward speed
    const angularVel = new THREE.Vector3(0, 0, 0);

    const result = ditching.update(
      0.016,
      mesh,
      linearVel,
      angularVel,
      mockTerrain,
      aero,
      BODY_SUPPORT_POINTS,
      0.0, // Gear up (belly landing)
      4.0, // Pitch 4 deg
      0.0  // Roll 0 deg
    );

    assert.equal(result.catastrophic, false, 'Gentle water landing must not be catastrophic');
    assert.equal(result.ditchingContact, true, 'Ditching contact must be initiated');
    assert.equal(result.onWater, true, 'Airframe must register water contact');
    assert.ok(result.forces.y > 0, 'Buoyant normal force must push upward');
    assert.ok(result.forces.z > 0, 'Water drag must oppose forward motion (-Z)');
    assert.ok(result.sprayIntensity > 0, 'High-speed water planing must generate spray intensity');
    assert.equal(result.ditchingPhase, 'planing');
  });

  await t.test('detects catastrophic crash when sink rate exceeds safety limits', () => {
    const ditching = new WaterDitching();
    const mesh = new THREE.Object3D();
    mesh.position.set(0, 0.5, 3000);

    // Hard slam into water: sink rate 6.0 m/s > 4.5 m/s limit
    const linearVel = new THREE.Vector3(0, -6.0, -70);
    const angularVel = new THREE.Vector3(0, 0, 0);

    const result = ditching.update(
      0.016,
      mesh,
      linearVel,
      angularVel,
      mockTerrain,
      aero,
      BODY_SUPPORT_POINTS,
      0.0,
      3.0,
      0.0
    );

    assert.equal(result.catastrophic, true, 'Excessive sink rate must be flagged as catastrophic');
    assert.equal(result.ditchingContact, false, 'Catastrophic crash must not latch safe ditching');
  });

  await t.test('detects catastrophic crash on nose-down dive or steep bank angle', () => {
    const ditchingNoseDive = new WaterDitching();
    const meshNoseDive = new THREE.Object3D();
    meshNoseDive.position.set(0, 0.5, 3000);

    // Nose-down -8 deg dive into water
    const resultNoseDive = ditchingNoseDive.update(
      0.016,
      meshNoseDive,
      new THREE.Vector3(0, -2.0, -70),
      new THREE.Vector3(0, 0, 0),
      mockTerrain,
      aero,
      BODY_SUPPORT_POINTS,
      0.0,
      -8.0,
      0.0
    );
    assert.equal(resultNoseDive.catastrophic, true, 'Nose-down dive must trigger catastrophic crash');

    const ditchingBank = new WaterDitching();
    const meshBank = new THREE.Object3D();
    meshBank.position.set(0, 0.5, 3000);

    // Steep 25 deg bank angle
    const resultBank = ditchingBank.update(
      0.016,
      meshBank,
      new THREE.Vector3(0, -1.5, -70),
      new THREE.Vector3(0, 0, 0),
      mockTerrain,
      aero,
      BODY_SUPPORT_POINTS,
      0.0,
      3.0,
      25.0
    );
    assert.equal(resultBank.catastrophic, true, 'Excessive roll angle must trigger wingtip cartwheel crash');
  });

  await t.test('hydrodynamic drag decelerates aircraft to a stop', () => {
    const ditching = new WaterDitching();
    const mesh = new THREE.Object3D();
    mesh.position.set(0, -0.3, 3000);

    const linearVel = new THREE.Vector3(0, 0, -40); // 40 m/s (~78 kt)
    const angularVel = new THREE.Vector3(0, 0, 0);

    // Run 0.1s of hydrodynamic forces
    const result = ditching.update(
      0.1,
      mesh,
      linearVel,
      angularVel,
      mockTerrain,
      aero,
      BODY_SUPPORT_POINTS,
      0.0,
      2.0,
      0.0
    );

    // Drag along +Z (opposing -Z velocity)
    assert.ok(result.forces.z > 50000, 'Water drag must apply substantial braking force');
  });

  await t.test('flooding increases continuously and causes aircraft to slowly sink', () => {
    const ditching = new WaterDitching();
    const mesh = new THREE.Object3D();
    mesh.position.set(0, -0.2, 3000);

    // Initial touchdown at low speed
    const vel = new THREE.Vector3(0, 0, -5);
    const angVel = new THREE.Vector3(0, 0, 0);

    assert.equal(ditching.flooding, 0.0);
    ditching.update(0.1, mesh, vel, angVel, mockTerrain, aero, BODY_SUPPORT_POINTS, 0.0, 2.0, 0.0);
    assert.equal(ditching.ditchingContact, true);
    assert.ok(ditching.flooding > 0.0, 'Flooding begins upon water contact');

    // Simulate 10 seconds of floating on water
    for (let t = 0; t < 100; t++) {
      ditching.update(0.1, mesh, vel, angVel, mockTerrain, aero, BODY_SUPPORT_POINTS, 0.0, 2.0, 0.0);
    }

    assert.ok(ditching.flooding > 0.35, 'Flooding must increase over time');
    assert.equal(ditching.ditchingPhase, 'sinking', 'Phase should transition to sinking');

    // Simulate another 15 seconds until fully flooded
    for (let t = 0; t < 150; t++) {
      ditching.update(0.1, mesh, new THREE.Vector3(0, -0.1, 0), angVel, mockTerrain, aero, BODY_SUPPORT_POINTS, 0.0, 0.0, 0.0);
    }

    assert.ok(ditching.flooding >= 0.95, 'Flooding must approach 1.0');
    assert.equal(ditching.submerged, true, 'Aircraft must register as submerged');
    assert.equal(ditching.ditchingPhase, 'submerged');
  });

  await t.test('CollisionDetector distinguishes safe water ditching from catastrophic impact', () => {
    const detector = new CollisionDetector(mockTerrain, null, null, null, null);

    const pos = new THREE.Vector3(0, 0.2, 3000);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(0, -1.0, -60); // Gentle 1.0 m/s sink rate, 60 m/s speed

    // 1. With active solver in safe ditching mode
    const waterDitching = new WaterDitching();
    waterDitching.ditchingContact = true;
    waterDitching.catastrophic = false;

    const safeContact = {
      onGround: true,
      catastrophicImpact: false,
      waterDitching
    };

    const safeResult = detector.checkCollision(pos, quat, vel, 0.0, 4.0, 0.0, safeContact);
    assert.equal(safeResult, null, 'Safe ditching with solver must not trigger collision crash');

    // 2. With catastrophic water impact in solver
    const fatalDitching = new WaterDitching();
    fatalDitching.ditchingContact = false;
    fatalDitching.catastrophic = true;

    const fatalContact = {
      onGround: true,
      catastrophicImpact: false,
      waterDitching: fatalDitching
    };

    const fatalResult = detector.checkCollision(pos, quat, vel, 0.0, 4.0, 0.0, fatalContact);
    assert.ok(fatalResult !== null, 'Catastrophic water impact must trigger collision');
    assert.equal(fatalResult.type, 'WATER');

    // 3. Detection-only check (without solver) still detects water collision at speed
    const detectionOnlyResult = detector.checkCollision(pos, quat, vel, 0.0, 4.0, 0.0, null);
    assert.ok(detectionOnlyResult !== null, 'Detection-only caller must detect water impact');
    assert.equal(detectionOnlyResult.type, 'WATER');
  });
});
