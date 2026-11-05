import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LandingGear } from '../src/physics/LandingGear.js';

// Minimal ground-roll rig: a 66 t airframe with gravity, the gear/contact forces
// and a pitch degree of freedom, on flat terrain. Enough to exercise the graded
// excursion chain (soft-soil drag -> leg collapse -> nacelle grind -> belly
// abrasion -> hull loss) without the full simulator.
const MASS = 66000, G = 9.80665, I_PITCH = 4.85e6, GROUND = 12;

function rollOffRunway({ speed, inSafetyArea, seconds = 6, hz = 120, preCollapse = false }) {
  const gear = new LandingGear();
  if (preCollapse) gear.contacts.forEach(c => { c.damage = 1; c.damageState = 'collapsed'; });
  const mesh = new THREE.Object3D();
  const vel = new THREE.Vector3(0, 0, -speed);
  const omega = new THREE.Vector3();
  let y = preCollapse ? 14.98 : 15.45;
  let pitch = 0, z = 0;
  const dt = 1 / hz;
  const events = { collapseT: null, catastrophicT: null };
  const samples = [];
  for (let i = 0; i < seconds / dt; i++) {
    mesh.position.set(0, y, z);
    mesh.rotation.set(pitch, 0, 0);
    mesh.updateMatrixWorld(true);
    const result = gear.update(dt, mesh, vel, omega, () => GROUND,
      () => new THREE.Vector3(0, 1, 0), () => false, new THREE.Vector3(), true,
      () => inSafetyArea);
    const acc = result.forces.clone().divideScalar(MASS);
    acc.y -= G;
    vel.addScaledVector(acc, dt);
    omega.x += (result.moments.x / I_PITCH) * dt;
    pitch += omega.x * dt;
    y += vel.y * dt;
    z += vel.z * dt;
    if (!preCollapse && events.collapseT === null
      && Object.values(result.gearDamage).some(state => state === 'collapsed')) {
      events.collapseT = i * dt;
    }
    if (events.catastrophicT === null && result.catastrophicImpact) events.catastrophicT = i * dt;
    samples.push(gear.structuralDamage);
  }
  return { gear, speed: Math.abs(vel.z), pitch, events, samples };
}

describe('Graded runway excursion', () => {
  it('relaxes soil engagement continuously to ground-class steady states at any rate', () => {
    for (const hz of [60, 120, 240]) {
      const gear = new LandingGear();
      const mesh = new THREE.Object3D();
      mesh.position.set(0, 15.45, 0);
      mesh.updateMatrixWorld(true);
      const step = (inSafety) => gear.update(1 / hz, mesh, new THREE.Vector3(0, 0, -20),
        new THREE.Vector3(), () => GROUND, () => new THREE.Vector3(0, 1, 0), () => false,
        new THREE.Vector3(), true, () => inSafety);
      let previous = 0, maxJump = 0;
      for (let i = 0; i < 3 * hz; i++) {
        step(true);
        const soil = gear.contacts[0].soilEngagement;
        maxJump = Math.max(maxJump, soil - previous);
        assert.ok(soil >= previous - 1e-12, 'engagement on the same surface never decreases');
        previous = soil;
      }
      assert.ok(Math.abs(previous - 0.45) < 0.01, `RSA class at ${hz} Hz settled at ${previous}`);
      assert.ok(maxJump < 0.45, `RSA engagement arrived by relaxation, not a step (${maxJump})`);
      for (let i = 0; i < 3 * hz; i++) step(false);
      assert.ok(Math.abs(gear.contacts[0].soilEngagement - 1) < 0.01, `soft soil at ${hz} Hz`);
    }
  });

  it('defaults an airport without a safety-area sampler to the mild RSA class', () => {
    const gear = new LandingGear();
    const mesh = new THREE.Object3D();
    mesh.position.set(0, 15.45, 0);
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < 240; i++) {
      gear.update(1 / 120, mesh, new THREE.Vector3(0, 0, -20), new THREE.Vector3(),
        () => GROUND, () => new THREE.Vector3(0, 1, 0), () => false, new THREE.Vector3(), true);
    }
    assert.ok(gear.contacts[0].soilEngagement < 0.6, 'no deep-soft-soil assumption');
  });

  it('decelerates a 15 m/s drift into the safety area without damage', () => {
    const run = rollOffRunway({ speed: 15, inSafetyArea: true, seconds: 6 });
    assert.ok(run.speed < 0.5, `should stop, still moving at ${run.speed} m/s`);
    assert.equal(run.events.collapseT, null, 'intact legs at 29 kt over firm grass');
    assert.equal(run.gear.structuralDamage, 0);
    assert.equal(run.events.catastrophicT, null);
  });

  it('stops a 15 m/s drift on soft soil beyond the safety area without collapsing legs', () => {
    const run = rollOffRunway({ speed: 15, inSafetyArea: false, seconds: 6 });
    assert.ok(run.speed < 0.5, 'soft-ground drag arrests the aircraft');
    assert.equal(run.events.collapseT, null);
    assert.equal(run.events.catastrophicT, null);
  });

  it('collapses legs gradually, not instantly, on a 45 m/s plow beyond the safety area', () => {
    const run = rollOffRunway({ speed: 45, inSafetyArea: false, seconds: 6 });
    assert.ok(run.events.collapseT !== null, 'sustained soft-ground shocks fail the legs');
    assert.ok(run.events.collapseT > 0.1, 'collapse takes an engagement ramp, not one frame');
    assert.ok(run.events.collapseT < 3, 'and does fail at 87 kt');
    assert.equal(run.events.catastrophicT, null, 'the 45 m/s excursion stays below hull loss');
    assert.ok(run.gear.bodyDamage.engineL >= 1, 'nacelles grind first');
  });

  it('escalates a 72 m/s belly slide to hull loss through staged wear', () => {
    const run = rollOffRunway({ speed: 72, inSafetyArea: false, seconds: 8, preCollapse: true });
    assert.ok(run.events.catastrophicT !== null, 'a 140 kt soft-ground plow exhausts the hull');
    assert.ok(run.events.catastrophicT > 1, 'after engine failure and hull abrasion, not at once');
    const enginesGroundFirst = run.gear.bodyDamage.engineL >= 1;
    const hullWearFrames = run.samples.indexOf(1);
    assert.ok(enginesGroundFirst, 'engines are destroyed during the slide');
    assert.ok(hullWearFrames > 0);
  });

  it('survives a 30 m/s belly slide on soft soil with damaged structure', () => {
    const run = rollOffRunway({ speed: 30, inSafetyArea: false, seconds: 8, preCollapse: true });
    assert.ok(run.speed < 0.5, 'comes to rest');
    assert.equal(run.events.catastrophicT, null, '58 kt slide is survivable');
    assert.ok(run.gear.structuralDamage >= 0, run.samples[run.samples.length - 1] > 0);
  });

  it('accumulates no meaningful abrasion once the wreck is at rest', () => {
    const held = rollOffRunway({ speed: 0.1, inSafetyArea: false, seconds: 4, preCollapse: true });
    assert.ok(held.speed < 0.1);
    assert.ok(held.gear.bodyDamage.belly < 1e-4,
      `abrasion needs slip, not just rest weight (${held.gear.bodyDamage.belly})`);
    assert.ok(held.gear.structuralDamage < 1e-4);
    assert.equal(held.events.catastrophicT, null);
  });

  it('produces the same hull abrasion outcome at 60, 120 and 240 Hz', () => {
    const outcomes = [60, 120, 240].map(hz => {
      const run = rollOffRunway({ speed: 72, inSafetyArea: false, seconds: 8, hz, preCollapse: true });
      return run.events.catastrophicT !== null;
    });
    assert.deepEqual(outcomes, [true, true, true]);
  });
});
