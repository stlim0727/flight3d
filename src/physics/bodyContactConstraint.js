import * as THREE from 'three';
import { BODY_SUPPORT_POINTS } from './groundContacts.js';

// A hard limit on the compliant body's penetration, in metres. Wheel suspension
// remains independent. This is a unilateral contact constraint, not an attitude animation.
export const BODY_PENETRATION_LIMIT = 0.04;
const point = new THREE.Vector3();
const arm = new THREE.Vector3();
const normal = new THREE.Vector3();
const normalBody = new THREE.Vector3();
const torque = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const velocity = new THREE.Vector3();

export function bodyClearances(position, quaternion, height, points = BODY_SUPPORT_POINTS) {
  return points.map(probe => {
    point.set(...probe.position).applyQuaternion(quaternion).add(position);
    return { id: probe.id, clearance: point.y - height(point.x, point.z) };
  });
}

// Called AFTER contact damage has sampled the incoming velocity and integration.
// Position correction adds no kinetic energy; normal impulses cancel only closing
// velocity, including rotation, using the same mass/inertia as the integrator.
export function constrainBodyContact(position, quaternion, linearVelocity, angularVelocity,
  mass, inverseInertia, height, terrainNormal, points = BODY_SUPPORT_POINTS) {
  inverse.copy(quaternion).invert();
  for (let iteration = 0; iteration < 4; iteration++) {
    let corrected = false;
    for (const probe of points) {
      arm.set(...probe.position).applyQuaternion(quaternion);
      point.copy(position).add(arm);
      const penetration = height(point.x, point.z) - point.y;
      if (penetration <= BODY_PENETRATION_LIMIT) continue;
      corrected = true;
      normal.copy(terrainNormal?.(point.x, point.z) || new THREE.Vector3(0, 1, 0)).normalize();
      if (normal.y < 0.1) normal.set(0, 1, 0);
      position.addScaledVector(normal, (penetration - BODY_PENETRATION_LIMIT) / normal.y);
      velocity.copy(angularVelocity).applyQuaternion(quaternion).cross(arm).add(linearVelocity);
      const closing = velocity.dot(normal);
      if (closing >= 0) continue;
      normalBody.copy(normal).applyQuaternion(inverse);
      torque.set(...probe.position).cross(normalBody);
      const denominator = 1 / mass + torque.x ** 2 * inverseInertia.x
        + torque.y ** 2 * inverseInertia.y + torque.z ** 2 * inverseInertia.z;
      const impulse = -closing / denominator;
      linearVelocity.addScaledVector(normal, impulse / mass);
      angularVelocity.x += torque.x * inverseInertia.x * impulse;
      angularVelocity.y += torque.y * inverseInertia.y * impulse;
      angularVelocity.z += torque.z * inverseInertia.z * impulse;
    }
    if (!corrected) break;
  }
}
