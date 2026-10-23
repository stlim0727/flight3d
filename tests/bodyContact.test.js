import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { BODY_SUPPORT_POINTS } from '../src/physics/groundContacts.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel, asymmetricThrustYawMoment } from '../src/physics/EngineModel.js';
import { BODY_DAMAGE_LIMITS, updateBodyDamage } from '../src/physics/bodyDamage.js';
import { bodyClearances, constrainBodyContact, BODY_PENETRATION_LIMIT } from '../src/physics/bodyContactConstraint.js';

const inertia = { x: 1 / 3450000, y: 1 / 4850000, z: 1 / 1650000 };
const demand = { firstContact: false, sinkRate: 0, frictionWork: 0 };
describe('Post-collapse body damage', () => {
  it('accumulates load-weighted work consistently, preserves damage at rest and while airborne', () => {
    const values = [60, 120, 240].map(hz => {
      let damage = 0;
      for (let i = 0; i < 10 * hz; i++) damage = updateBodyDamage(damage,
        { ...demand, frictionWork: 150000 * 20 / hz }, BODY_DAMAGE_LIMITS.engineL);
      const atRest = updateBodyDamage(damage, demand, BODY_DAMAGE_LIMITS.engineL);
      assert.equal(atRest, damage);
      return damage;
    });
    assert.ok(values[0] > 0.3 && values[0] < 1);
    assert.ok(Math.max(...values) - Math.min(...values) < 1e-10);
    const light = updateBodyDamage(0, { ...demand, frictionWork: 30000 }, BODY_DAMAGE_LIMITS.engineL);
    const heavy = updateBodyDamage(0, { ...demand, frictionWork: 300000 }, BODY_DAMAGE_LIMITS.engineL);
    assert.ok(heavy > light);
  });

  it('counts impact once and counts a later reimpact without repairing the part', () => {
    const hit = { ...demand, firstContact: true, sinkRate: 6 };
    const first = updateBodyDamage(0, hit, BODY_DAMAGE_LIMITS.wingL);
    const held = updateBodyDamage(first, { ...hit, firstContact: false }, BODY_DAMAGE_LIMITS.wingL);
    assert.equal(held, first);
    assert.ok(updateBodyDamage(held, hit, BODY_DAMAGE_LIMITS.wingL) > held);
    assert.equal(updateBodyDamage(0, { ...hit, sinkRate: 8 }, BODY_DAMAGE_LIMITS.wingL), 1);
  });

  it('captures imminent catastrophic impact before constraint cancellation and resets all parts', () => {
    const gear = new LandingGear();
    gear.gearState = gear.targetGearState = 0;
    const mesh = new THREE.Object3D();
    mesh.position.y = 3.05;
    mesh.updateMatrixWorld(true);
    const result = gear.update(1 / 120, mesh, new THREE.Vector3(0, -20, -30), new THREE.Vector3(), () => 0);
    assert.equal(result.catastrophicImpact, true);
    assert.equal(result.bodyDamage.engineL, 1);
    assert.equal(result.bodyDamage.engineR, 1);
    assert.equal(result.bodyDamageEvents.filter(e => e.id === 'engineL').length, 1);
    mesh.position.y = 20;
    mesh.updateMatrixWorld(true);
    gear.update(1 / 120, mesh, new THREE.Vector3(), new THREE.Vector3(), () => 0);
    assert.equal(gear.bodyDamage.engineL, 1);
    gear.resetDamage();
    assert.ok(Object.values(gear.bodyDamage).every(d => d === 0));
    assert.equal(gear.bodyGrounded.size, 0);
  });

  it('turns severe wing and tail strikes into structural failure independently', () => {
    for (const [part, position, rotation] of [
      ['wingL', [0, 5, 0], [0, 0, 0.4]],
      ['wingR', [0, 5, 0], [0, 0, -0.4]],
      ['tail', [0, 4.5, 0], [0.3, 0, 0]],
    ]) {
      const gear = new LandingGear();
      gear.gearState = gear.targetGearState = 0;
      const mesh = new THREE.Object3D();
      mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.updateMatrixWorld(true);
      const result = gear.update(1 / 120, mesh, new THREE.Vector3(0, -9, -20), new THREE.Vector3(), () => 0);
      assert.equal(result.bodyDamage[part], 1, part);
      assert.equal(result.catastrophicImpact, true, part);
      assert.equal(result.bodyDamageEvents.filter(e => e.id === part).length, 1);
    }
  });

  it('reduces only the damaged engine continuously, keeps damage through restart and permits repair', () => {
    const engines = new EngineModel();
    engines.setThrottle(1);
    for (let i = 0; i < 2400; i++) engines.update(1 / 120, 0, 50, 1);
    const thrusts = [];
    for (const damage of [0, 0.25, 0.5, 0.75, 1]) {
      engines.contactDamage[0] = damage;
      const data = engines.update(1 / 120, 0, 50, 1);
      thrusts.push(data.engine1.thrust);
      if (damage) assert.ok(asymmetricThrustYawMoment(data.engine1.thrust, data.engine2.thrust) > 0);
    }
    assert.ok(thrusts.every((value, i) => i === 0 || value < thrusts[i - 1]));
    engines.setEngineFailure(0, false);
    assert.equal(engines.update(1 / 120, 0, 50, 1).engine1.thrust, 0);
    engines.contactDamage.fill(0);
    assert.ok(engines.update(1 / 120, 0, 50, 1).engine1.thrust > 0);
  });
});

describe('Body penetration constraint', () => {
  // Start with a known minimum vertical clearance; test the resulting clearance,
  // not merely a lower bound that also accepts an aircraft lifted off the ground.
  function correctOnSurface(height, surfaceNormal, x = 0, z = 0, points = BODY_SUPPORT_POINTS) {
    const position = new THREE.Vector3(x, 0, z);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal(x, z));
    const minimum = () => Math.min(...bodyClearances(position, quaternion, height, points).map(p => p.clearance));
    position.y -= minimum() + 0.24;
    constrainBodyContact(position, quaternion, new THREE.Vector3(3, -1, 4), new THREE.Vector3(0.1, -0.05, 0.02),
      66000, inertia, height, surfaceNormal, points);
    return minimum();
  }

  it('lands exactly on the penetration limit on flat, signed and compound planar slopes', () => {
    const single = [{ id: 'belly', position: [0, 0, 0] }];
    const slopes = [[0, 0], [0, 0.1176], [0, -0.1176], [0, 0.5], [0, -0.5],
      [0, 1], [0, -1], [1, 0], [-1, 0], [0.4, 0.8], [-0.4, -0.8]];
    for (const [sx, sz] of slopes) for (const points of [single, BODY_SUPPORT_POINTS]) {
      const height = (x, z) => sx * x + sz * z;
      const normal = () => new THREE.Vector3(-sx, 1, -sz).normalize();
      const clearance = correctOnSurface(height, normal, 3, -7, points);
      assert.ok(Math.abs(clearance + BODY_PENETRATION_LIMIT) < 1e-8,
        `slope (${sx}, ${sz}), ${points.length} patches: clearance ${clearance}`);
    }
  });

  it('rechecks nonlinear surface clearance across repeated corrections', () => {
    const height = (x, z) => 0.12 * z + 0.002 * z * z + 0.001 * x * x + 0.05 * Math.sin(x / 3);
    const normal = (x, z) => new THREE.Vector3(-(0.002 * x + 0.05 / 3 * Math.cos(x / 3)),
      1, -(0.12 + 0.004 * z)).normalize();
    const single = [{ id: 'belly', position: [0, 0, 0] }];
    for (const x of [-20, -10, 0, 10, 20]) for (const z of [-20, -10, 0, 10, 20]) {
      for (const points of [single, BODY_SUPPORT_POINTS]) {
        const clearance = correctOnSurface(height, normal, x, z, points);
        assert.ok(Math.abs(clearance + BODY_PENETRATION_LIMIT) < 1e-8,
          `curved surface (${x}, ${z}), ${points.length} patches: clearance ${clearance}`);
      }
    }
  });

  it('keeps loaded Lukla DEM and airport-boundary samples within 2mm of the contact limit', () => {
    const bytes = readFileSync(new URL('../public/terrain/lukla_dem.bin', import.meta.url));
    const elevations = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const terrain = new LuklaTerrain(undefined, 16, elevations);
    assert.equal(terrain.isLoaded, true, 'Use the bundled DEM, not the flat loading fallback');
    const sites = [];
    for (const s of [-200, 0, 200]) for (const w of [0, 25, 50]) {
      sites.push([s * 0.848048 + w * 0.529919, -s * 0.529919 + w * 0.848048]);
    }
    for (const x of [-1000, -500, 0, 500, 1000]) for (const z of [-1000, -500, 0, 500, 1000]) sites.push([x, z]);
    try {
      for (const [x, z] of sites) {
        const clearance = correctOnSurface((x, z) => terrain.getHeight(x, z),
          (x, z) => terrain.getNormal(x, z), x, z);
        // Normals use 2m finite differences across DEM cells/graded boundaries;
        // these fixtures permit 2mm residual, unlike the exact planar cases.
        assert.ok(clearance >= -BODY_PENETRATION_LIMIT - 1e-8
          && clearance <= -BODY_PENETRATION_LIMIT + 0.002,
        `loaded DEM (${x}, ${z}): clearance ${clearance}`);
      }
    } finally {
      terrain.geometry.dispose();
      terrain.localTerraceGeometry.dispose();
      terrain.mesh.material.dispose();
    }
  });

  it('bounds every patch on flat and sloped terrain in rolled and pitched attitudes', () => {
    for (const slope of [0, 0.12, -0.12]) for (const roll of [-0.3, 0, 0.3]) {
      const position = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0.6, roll));
      const velocity = new THREE.Vector3(0, -8, -30);
      const omega = new THREE.Vector3(0.1, 0, -0.2);
      const energy = () => 66000 * velocity.lengthSq() + omega.x ** 2 / inertia.x
        + omega.y ** 2 / inertia.y + omega.z ** 2 / inertia.z;
      const before = energy();
      const height = (x, z) => slope * z;
      constrainBodyContact(position, quaternion, velocity, omega, 66000, inertia, height,
        () => new THREE.Vector3(0, 1, -slope).normalize());
      assert.ok(bodyClearances(position, quaternion, height).every(p => p.clearance >= -BODY_PENETRATION_LIMIT - 1e-8));
      assert.ok(energy() <= before + 1e-6, 'normal constraint must not add kinetic energy');
    }
  });

  it('does not alter airborne motion', () => {
    const p = new THREE.Vector3(0, 100, 0), q = new THREE.Quaternion();
    const v = new THREE.Vector3(0, -10, -60), w = new THREE.Vector3(0.1, 0, 0);
    constrainBodyContact(p, q, v, w, 66000, inertia, () => 0);
    assert.deepEqual(p.toArray(), [0, 100, 0]);
    assert.deepEqual(v.toArray(), [0, -10, -60]);
    assert.deepEqual(w.toArray(), [0.1, 0, 0]);
  });
});
