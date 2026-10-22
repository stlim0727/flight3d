import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';

describe('Aerodynamics (6-DOF Flight Physics Model)', () => {
  function createTestAircraft(rotationEuler = new THREE.Euler(0, 0, 0)) {
    const obj = new THREE.Object3D();
    obj.quaternion.setFromEuler(rotationEuler);
    return obj;
  }

  it('should compute linear lift and drag at zero alpha (cruise speed 80 m/s)', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // Aircraft heading -Z in level flight at 80 m/s (approx 155 knots)
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(Math.abs(res.alphaDeg) < 0.01, 'AoA should be zero');
    assert.ok(res.iasKnots > 150 && res.iasKnots < 160, 'IAS should be ~155 knots');
    assert.strictEqual(res.isStalled, false, 'Should not be stalled at zero AoA');
    assert.ok(res.lift > 80000, 'Zero-alpha camber produces positive lift');
    assert.ok(res.drag > 5000, 'Parasite + induced drag must be positive');
  });

  it('should increase lift proportionally with positive angle of attack', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // 80 m/s forward (-Z), 7 m/s downward (+Y relative to flight path -> w > 0, approx +5° AoA)
    const velocity = new THREE.Vector3(0, -7, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(res.alphaDeg > 4.5 && res.alphaDeg < 5.5, 'AoA should be ~5 degrees');
    // At 5 deg AoA, lift should be much higher than at 0 deg
    assert.ok(res.lift > 250000, 'Lift at 5° AoA should exceed 250 kN');
  });

  it('should detect aerodynamic stall beyond critical angle of attack', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // High angle of attack (~20°, w = 29 m/s, u = 80 m/s)
    const velocity = new THREE.Vector3(0, -32, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(res.alphaDeg > 18.0, 'AoA exceeds 18 degrees');
    assert.strictEqual(res.isStalled, true, 'isStalled flag must be true');
    assert.ok(res.stallSeverity > 0.0, 'Stall severity must be non-zero');
    assert.ok(res.buffetVibration > 0.0, 'Buffet vibration must be triggered');
  });

  it('should set the pre-stall flag within the shaker margin and clear it outside', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    const angVel = new THREE.Vector3(0, 0, 0);

    // ~13.9 deg AoA: inside the 2-degree shaker margin below the 15.5 deg stall
    const nearStall = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -19.6, -80), angVel, 0, 500, 0, 0.0);
    assert.strictEqual(nearStall.isStalled, false);
    assert.strictEqual(nearStall.isPreStall, true, 'Shaker margin must activate before the stall');

    // ~5 deg AoA: normal cruise AoA, no warning
    const cruise = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -7, -80), angVel, 0, 500, 0, 0.0);
    assert.strictEqual(cruise.isPreStall, false);

    // Deep stall: the stalled flag owns the annunciation, not the pre-stall flag
    const stalled = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -32, -80), angVel, 0, 500, 0, 0.0);
    assert.strictEqual(stalled.isPreStall, false);
  });

  it('should inhibit the stall annunciation when there is too little relative airflow', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    const angVel = new THREE.Vector3(0, 0, 0);
    // ~4 kt sliding with a steep body-down velocity component: AoA is meaningless here
    const res = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -1.2, -2.0), angVel, 0, 0, 0, 1.0);
    assert.ok(Math.abs(res.alphaDeg) > 15.5, 'Raw AoA geometry exceeds the stall angle');
    assert.strictEqual(res.isStalled, false, 'Stall flag must be inhibited below the airflow threshold');
    assert.strictEqual(res.isPreStall, false, 'Shaker must be inhibited below the airflow threshold');
  });

  it('should break nose-down in the stall even with the stick held fully aft', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    const angVel = new THREE.Vector3(0, 0, 0);
    // ~20 deg AoA, full aft stick, ~155 knots
    aero.elevator = 1.0;
    const res = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -32, -80), angVel, 0, 5000, 100000, 0.0);
    assert.strictEqual(res.isStalled, true);
    assert.ok(res.momentBody.x < 0, `Post-stall pitch moment must be nose-down with full aft stick, got ${res.momentBody.x}`);
  });

  it('should lose elevator pitch authority after the stall', () => {
    const aircraft = createTestAircraft();
    const angVel = new THREE.Vector3(0, 0, 0);
    const measure = (alphaVertical) => {
      const aero = new Aerodynamics();
      aero.elevator = 0.0;
      const neutral = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -alphaVertical, -80), angVel, 0, 5000, 0, 0.0);
      aero.elevator = 1.0;
      const aft = aero.computeAero(0.01, aircraft, new THREE.Vector3(0, -alphaVertical, -80), angVel, 0, 5000, 0, 0.0);
      // Compare non-dimensional effectiveness (moment gain per Pa of dynamic pressure)
      return { neutral, aft, gain: (aft.momentBody.x - neutral.momentBody.x) / aft.qDyn };
    };
    // ~5 deg AoA: unstalled, elevator is fully effective
    const clean = measure(7);
    // ~24 deg AoA: deep stall, tail is in the separated wake
    const deep = measure(35.6);
    assert.strictEqual(deep.neutral.isStalled, true);
    assert.ok(deep.gain > 0, 'Aft stick still unloads the tail partially');
    assert.ok(deep.gain < clean.gain * 0.5, 'Post-stall elevator must be far less effective than unstalled');
  });

  it('should reverse roll stability with sideslip after the stall (wing drop)', () => {
    const aircraft = createTestAircraft();
    const angVel = new THREE.Vector3(0, 0, 0);
    const atBeta = (vertical) => {
      const aero = new Aerodynamics();
      // rightward lateral velocity = right sideslip
      return aero.computeAero(0.01, aircraft, new THREE.Vector3(2.5, -vertical, -80), angVel, 0, 500, 0, 0.0);
    };
    const unstalled = atBeta(7); // ~5 deg AoA, same sideslip
    const stalled = atBeta(32); // ~20 deg AoA, same sideslip
    assert.strictEqual(stalled.isStalled, true);
    assert.ok(unstalled.momentBody.z * stalled.momentBody.z < 0, 'Sideslip must roll the wing down after stall, opposite to unstalled dihedral response');
  });

  it('should model ground effect (reduced induced drag near surface)', () => {
    const aero1 = new Aerodynamics();
    const aero2 = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, -7, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    // Case 1: In ground effect at 5m AGL (wingspan is 35.8m)
    const inGroundEffect = aero1.computeAero(0.01, aircraft, velocity, angVel, 50, 5, 0, 0.0);

    // Case 2: Out of ground effect at 500m AGL
    const outOfGroundEffect = aero2.computeAero(0.01, aircraft, velocity, angVel, 50, 500, 0, 0.0);

    assert.ok(inGroundEffect.cd < outOfGroundEffect.cd, 'Ground effect must reduce overall drag coefficient');
  });

  it('should increase parasite drag when flaps, gear, or spoilers are deployed', () => {
    const aeroClean = new Aerodynamics();
    const aeroDirty = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const resClean = aeroClean.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);

    // Deploy flaps to 30, gear to 1.0, spoilers to 1.0
    aeroDirty.setFlapPosition(5); // Flaps 30
    aeroDirty.currentFlapAngle = 30; // Instantly set angle for test
    aeroDirty.spoilers = 1.0;
    const resDirty = aeroDirty.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 1.0);

    assert.ok(resDirty.drag > resClean.drag * 2.0, 'Dirty config must produce more than double the drag');
  });

  it('should generate control moments and support live tuning sensitivity multipliers', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    // Baseline elevator deflection: stick back (+1.0)
    aero.elevator = 1.0;
    const resBaseline = aero.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);
    const baselinePitchMoment = resBaseline.momentBody.x;

    // Apply live tuning multiplier: 1.8x sensitivity
    aero.tuning.elevatorSensitivity = 1.8;
    const resTuned = aero.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);
    const tunedPitchMoment = resTuned.momentBody.x;

    assert.ok(Math.abs(baselinePitchMoment) > 1000, 'Elevator deflection must generate pitch moment');
    assert.ok(Math.abs(tunedPitchMoment) > Math.abs(baselinePitchMoment) * 1.5, 'Tuning sensitivity must scale pitching moment');
  });
});
