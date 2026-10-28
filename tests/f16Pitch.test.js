import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { solveTrim } from '../src/physics/TrimSolver.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';

describe('F-16 longitudinal response', () => {
  it('preserves its configured zero pitching moment at zero alpha', () => {
    const aero = new Aerodynamics(F16_FALCON);
    assert.equal(aero.Cm0, 0);
  });

  it('does not inherit the transport thrust pitch-up moment at reference CG', () => {
    const aero = new Aerodynamics(F16_FALCON);
    Object.assign(aero.cg, { x: 0, y: 0, z: 0 });
    const mesh = new THREE.Object3D();
    const velocity = new THREE.Vector3(0, 0, -150);
    const rates = new THREE.Vector3();
    const moments = [0, 65000, 131000, 65000, 0].map(thrust =>
      aero.computeAero(1 / 120, mesh, velocity, rates, 1000, 1000, thrust, 0).momentBody.x);
    for (const moment of moments) {
      assert.ok(Math.abs(moment - moments[0]) < 1e-6, `thrust pitch increment ${moment - moments[0]} Nm`);
    }
    // CG shifts still produce the physical thrust moment.
    aero.cg.y = 0.2;
    const idle = aero.computeAero(0, mesh, velocity, rates, 1000, 1000, 0, 0).momentBody.x;
    const powered = aero.computeAero(0, mesh, velocity, rates, 1000, 1000, 65000, 0).momentBody.x;
    assert.ok(Math.abs(powered - idle - 13000) < 1e-6);
  });

  for (const iasKnots of [210, 300, 450]) {
    it(`holds aerodynamic cruise trim for 30 seconds at ${iasKnots} knots`, () => {
      const aero = new Aerodynamics(F16_FALCON);
      const trim = solveTrim(aero, new EngineModel(F16_FALCON), { iasKnots, altitudeMeters: 1000 });
      assert.ok(trim.feasible && !trim.surfaceLimited, JSON.stringify(trim));
      // Use the solved thrust to isolate aero equilibrium; the engine idle floor
      // can exceed level-flight drag at these speeds.
      aero.pitchTrim = trim.handsOffTrimDeg;
      const mesh = new THREE.Object3D();
      mesh.rotation.x = THREE.MathUtils.degToRad(trim.alphaDeg);
      const velocity = new THREE.Vector3(0, 0, -trim.tas);
      const rates = new THREE.Vector3();
      const axis = new THREE.Vector3();
      for (let i = 0; i < 3600; i++) {
        const dt = 1 / 120;
        const result = aero.computeAero(dt, mesh, velocity, rates, 1000, 1000, trim.thrustN, 0);
        const force = result.forceWorld.clone().add(new THREE.Vector3(0, 0, -trim.thrustN).applyQuaternion(mesh.quaternion));
        force.y -= aero.mass * 9.80665;
        velocity.addScaledVector(force, dt / aero.mass);
        rates.x += result.momentBody.x * aero.invIyy * dt;
        axis.copy(rates);
        const angle = axis.length() * dt;
        if (angle > 0) mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle)).normalize();
      }
      assert.ok(Math.abs(rates.x) < 0.001, `pitch rate ${rates.x}`);
      assert.ok(Math.abs(mesh.rotation.x - THREE.MathUtils.degToRad(trim.alphaDeg)) < 0.01, `pitch ${mesh.rotation.x}`);
      assert.ok(Math.abs(velocity.y) < 0.5, `vertical speed ${velocity.y}`);
    });
  }
});
