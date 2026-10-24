import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

test('CollisionDetector (Multi-Obstacle & Crash Detection System)', async (t) => {
  // Mock terrain: flat runway plateau (12m) with hills in positive Z and ocean at Z > 3000
  const mockTerrain = {
    getHeight: (x, z) => {
      if (z > 3000) return -10.0; // Ocean
      if (Math.abs(x) < 2000 && Math.abs(z) < 400) return 12.0; // Runway plateau
      if (x > 2500) return 150.0; // High mountain ridge
      return 25.0; // Rolling hills
    }
  };

  const mockAirport = {
    elevation: 12.0,
    controlTowerData: { x: 120, y: 12.0, z: 280, radius: 11.5, height: 85.0 },
    terminalData: { x: -80, y: 12.0, z: 340, width: 350, height: 22, depth: 70 },
    hangarsData: [
      { x: -450, y: 12.0, z: 310, width: 90, height: 35, depth: 70 },
      { x: -580, y: 12.0, z: 310, width: 90, height: 35, depth: 70 }
    ]
  };

  const mockFoliage = {
    treeData: [
      { x: 1000, y: 25.0, z: 1500, height: 12.0, radius: 4.0 },
      { x: -1200, y: 30.0, z: -1800, height: 10.0, radius: 3.5 }
    ],
    buildingData: [
      { x: 2800, y: 25.0, z: 1400, width: 30, height: 95, depth: 30 }
    ]
  };

  const mockShips = {
    vessels: [
      {
        mesh: { position: new THREE.Vector3(800, 0, 4200), rotation: { y: 0 } },
        length: 220,
        width: 34,
        height: 35
      }
    ]
  };

  const detector = new CollisionDetector(mockTerrain, mockAirport, mockFoliage, mockShips, null);

  await t.test('should permit safe runway operations with gear down (no false crash)', () => {
    // Aircraft on Runway 09L at 15.5m (12m ground + 3.5m wheel geometry), rolling at 70 m/s (136 KT)
    const pos = new THREE.Vector3(-1000, 15.5, 0);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
    const vel = new THREE.Vector3(70, -0.5, 0); // Gentle 100 FPM descent
    const gearState = 1.0;
    const pitchDeg = 3.0;
    const rollDeg = 0.0;

    const result = detector.checkCollision(pos, quat, vel, gearState, pitchDeg, rollDeg);
    assert.equal(result, null, 'Safe runway roll should not trigger collision');
  });

  await t.test('should detect off-runway excursion when moving on ground outside runway', () => {
    // Aircraft outside runway at z = 80m (in grass), on ground at 15.5m (12m ground + 3.5m gear), rolling at 50 m/s
    const pos = new THREE.Vector3(-1000, 15.5, 80);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
    const vel = new THREE.Vector3(50, 0, 0);
    const gearState = 1.0;
    const pitchDeg = 0.0;
    const rollDeg = 0.0;

    const result = detector.checkCollision(pos, quat, vel, gearState, pitchDeg, rollDeg);
    assert.ok(result !== null, 'Ground roll outside runway must trigger collision');
    assert.equal(result.type, 'TERRAIN');
    assert.match(result.name, /RUNWAY EXCURSION|활주로 이탈/);
  });

  await t.test('should permit safe flight over terrain outside runway when airborne', () => {
    // Aircraft in flight over hills at z = 1000m (ground is 25m), altitude 200m
    const pos = new THREE.Vector3(0, 200, 1000);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(80, 0, 0);
    const gearState = 1.0;

    const result = detector.checkCollision(pos, quat, vel, gearState, 0, 0, { onGround: false });
    assert.equal(result, null, 'Airborne flight outside runway must not trigger collision');
  });

  await t.test('should detect collision when landing gear wheel runs off the runway', () => {
    // Aircraft center at z = 30m, but right main gear wheel is at z = 42m (outside runway)
    const pos = new THREE.Vector3(-1000, 15.5, 30);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(30, 0, 0);
    const groundContact = {
      onGround: true,
      contacts: [
        { id: 'nose', isGrounded: true, worldPos: new THREE.Vector3(-1000, 12, 30) },
        { id: 'mainLeft', isGrounded: true, worldPos: new THREE.Vector3(-1000, 12, 27) },
        { id: 'mainRight', isGrounded: true, worldPos: new THREE.Vector3(-1000, 12, 42) } // outside runway (>40m)
      ]
    };

    const result = detector.checkCollision(pos, quat, vel, 1.0, 0, 0, groundContact);
    assert.ok(result !== null, 'Wheel off runway while moving must trigger collision');
    assert.equal(result.type, 'TERRAIN');
    assert.match(result.name, /RUNWAY EXCURSION|활주로 이탈/);
  });

  await t.test('gear-up approach stays airborne until the engine nacelle reaches the runway', () => {
    const quat = new THREE.Quaternion();
    const velocity = new THREE.Vector3(70, -2, 0);
    for (const clearance of [4, 3.5, 3.1]) {
      assert.equal(detector.checkCollision(new THREE.Vector3(-1000, 12 + clearance, 0),
        quat, velocity, 0, 0, 0), null, `Gear-up aircraft is clear at ${clearance}m CG height`);
    }
    const impact = detector.checkCollision(new THREE.Vector3(-1000, 14.9, 0), quat, velocity, 0, 0, 0);
    assert.ok(impact, 'Nacelle ground contact must trigger a crash');
    assert.match(impact.name, /GEAR-UP/);
  });

  await t.test('should detect control tower collision', () => {
    // Flying directly into control tower cab at (120, 50, 280)
    const pos = new THREE.Vector3(120, 50, 280);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(80, 0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect collision with control tower');
    assert.equal(result.type, 'TOWER');
  });

  await t.test('should detect airport terminal concourse collision', () => {
    // Flying into terminal concourse at (-80, 20, 340)
    const pos = new THREE.Vector3(-80, 20, 340);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(80, 0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect collision with terminal concourse');
    assert.equal(result.type, 'BUILDING');
  });

  await t.test('should detect city skyscraper collision', () => {
    // Flying into skyscraper at (2800, 50, 1400)
    const pos = new THREE.Vector3(2800, 50, 1400);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(100, 0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect collision with skyscraper');
    assert.equal(result.type, 'BUILDING');
  });

  await t.test('should detect tree collision in forest', () => {
    // Flying into tree at (1000, 30, 1500)
    const pos = new THREE.Vector3(1000, 30, 1500);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(60, 0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect collision with tree');
    assert.equal(result.type, 'TREE');
  });

  await t.test('should detect ocean water crash at speed', () => {
    // Flying into sea at (0, 0, 4000) with 80 m/s forward speed
    const pos = new THREE.Vector3(0, 0.2, 4000);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(80, -2.0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect ocean water crash');
    assert.equal(result.type, 'WATER');
  });

  await t.test('detection-only caller detects deeply penetrating body probes', () => {
    // Body geometry fixture: starts deeply inside the runway, not at first wheel contact.
    const pos = new THREE.Vector3(0, 12.5, 0);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(65, -7.5, 0);
    const result = detector.checkCollision(pos, quat, vel, 1.0, 2.0, 0);

    assert.ok(result !== null, 'Should detect hard landing crash');
    assert.equal(result.type, 'TERRAIN');
  });

  await t.test('should detect wingtip strike when banking excessively near ground', () => {
    // 30 degree bank angle at 13m altitude near 12m ground
    const pos = new THREE.Vector3(0, 13.0, 0);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(65, -0.5, 0);
    const result = detector.checkCollision(pos, quat, vel, 1.0, 2.0, 30.0);

    assert.ok(result !== null, 'Should detect wingtip strike');
    assert.equal(result.type, 'TERRAIN');
  });

  await t.test('should detect high-speed mountain ridge collision', () => {
    // Flying into mountain ridge at x = 2600, y = 80m (mountain is at 150m)
    const pos = new THREE.Vector3(2600, 80, 0);
    const quat = new THREE.Quaternion();
    const vel = new THREE.Vector3(90, 0, 0);
    const result = detector.checkCollision(pos, quat, vel, 0.0, 0, 0);

    assert.ok(result !== null, 'Should detect mountain ridge collision');
    assert.equal(result.type, 'TERRAIN');
  });
});
