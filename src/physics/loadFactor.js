import * as THREE from 'three';
import { Atmosphere } from './Atmosphere.js';

const specificForce = new THREE.Vector3();
const cabinUp = new THREE.Vector3();
const midpoint = new THREE.Quaternion();

/** Step-averaged, unfiltered normal specific force at the instantaneous CG.
 * Includes contact constraint impulses; excludes a velocity rebase due only to
 * moving the CG reference. This is not a cockpit/seat sensor or a resultant G.
 */
export function normalLoadFactor(beforeVelocity, afterVelocity, beforeRotation, afterRotation, dt) {
  specificForce.copy(afterVelocity).sub(beforeVelocity).divideScalar(dt);
  specificForce.y += Atmosphere.G0;
  midpoint.copy(beforeRotation).slerp(afterRotation, 0.5);
  cabinUp.set(0, 1, 0).applyQuaternion(midpoint);
  return specificForce.dot(cabinUp) / Atmosphere.G0;
}
