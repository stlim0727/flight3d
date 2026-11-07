import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compliantNormalForce, inverseContactMass } from '../src/physics/contactCompliance.js';
test('a stiff off-center impact dissipates energy instead of reversing contact velocity explosively', () => {
  const inverseMass = inverseContactMass({ x: 0, y: 0, z: -7.8 }, { x: 0, y: 1, z: 0 },
    12000, { x: 1 / 75000, y: 1 / 82000, z: 1 / 12800 });
  for (const hz of [60, 120, 240]) {
    const dt = 1 / hz, speed = -15;
    const force = compliantNormalForce(0, speed, 18000000, 400000, inverseMass, dt);
    const after = speed + dt * force * inverseMass;
    assert.ok(after > speed && after <= 0, `${hz} Hz: ${after}`);
    assert.ok(after ** 2 < speed ** 2);
  }
});
test('settles under weight at the physical spring compression across step rates', () => {
  for (const hz of [60, 120, 240]) {
    let depth = 0, speed = 0; const dt = 1 / hz, mass = 12000, k = 18000000;
    for (let i = 0; i < hz * 3; i++) {
      const load = compliantNormalForce(depth, speed - 9.80665 * dt, k, 400000, 1 / mass, dt);
      speed += (load / mass - 9.80665) * dt;
      depth -= speed * dt;
    }
    assert.ok(Math.abs(depth - mass * 9.80665 / k) < 1e-6);
    assert.ok(Math.abs(speed) < 1e-6);
  }
});
test('unilateral support never pulls the aircraft down and converges to the continuous force', () => {
  assert.equal(compliantNormalForce(0, 1, 18000000, 400000, .001, 1 / 120), 0);
  const load = compliantNormalForce(.01, -2, 18000000, 400000, .001, 1e-10);
  assert.ok(Math.abs(load - (180000 + 800000)) < 1);
});

test('actual F16 aft-body contact cannot inject a nose-down rebound impulse', async () => {
  const THREE = await import('three');
  const { LandingGear } = await import('../src/physics/LandingGear.js');
  const { F16_FALCON } = await import('../src/config/aircraftConfigs.js');
  for (const hz of [60, 120, 240]) {
    const gear = new LandingGear(F16_FALCON);
    gear.gearState = gear.targetGearState = 0;
    gear.bodySupportPoints = [{ id: 'engineL', key: 'aft', position: [0, -.7, 7.5], weight: 1 }];
    const mesh = new THREE.Object3D();
    mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 12.75 * Math.PI / 180);
    const patch = new THREE.Vector3(0, -.7, 7.5).applyQuaternion(mesh.quaternion);
    mesh.position.y = -patch.y + .03175; mesh.updateMatrixWorld(true);
    const v = new THREE.Vector3(0, -4.5245, 0), w = new THREE.Vector3(), mass = 12000;
    const inverseInertia = { x: 1 / 75000, y: 1 / 82000, z: 1 / 12800 };
    const dt = 1 / hz;
    const result = gear.update(dt, mesh, v, w, () => 0, null, null, undefined, false, null,
      { mass, inverseInertia });
    const load = result.forces.y;
    const arm = new THREE.Vector3(0, -.7, 7.5);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion.clone().invert());
    const invMass = inverseContactMass(arm, normal, mass, inverseInertia);
    const after = v.y + load * dt * invMass;
    assert.ok(after >= v.y && after <= 0, `${hz} Hz contact velocity ${after}`);
    // Include all returned moments; friction must not be hiding injected energy.
    const nextV = v.clone().addScaledVector(result.forces, dt / mass);
    const nextW = result.moments.clone().multiply(new THREE.Vector3(inverseInertia.x, inverseInertia.y, inverseInertia.z)).multiplyScalar(dt);
    const energy = mass * nextV.lengthSq() / 2 + (nextW.x ** 2 / inverseInertia.x
      + nextW.y ** 2 / inverseInertia.y + nextW.z ** 2 / inverseInertia.z) / 2;
    assert.ok(energy <= mass * v.lengthSq() / 2);
    if (hz <= 120) assert.ok(load > 0);
  }
});
