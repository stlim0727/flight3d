import * as THREE from 'three';

/**
 * FlybyCameraMode — cinematic flyby camera.
 *
 * Owns: fixed vantage point selection, runway/airborne tracking,
 * timing/cut logic, ground speed regime determination ('parked' vs 'rollout' vs 'airborne').
 */
export class FlybyCameraMode {
  /**
   * Snap flyby camera to initial position.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs - CameraSystem instance
   */
  static snap(camera, aircraftMesh, cs) {
    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) forward.normalize();
    else forward.set(1, 0, 0);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
    const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
    const groundH = cs.queryGroundHeight(targetX, targetZ);
    const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

    cs.flybyPos.set(targetX, targetY, targetZ);
    camera.position.copy(cs.flybyPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(planePos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    cs.flybySet = true;
    cs.flybyRegime = 'parked';
  }

  /**
   * Update flyby camera each frame.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} flightState
   * @param {object} cs - CameraSystem instance
   * @param {number} dt
   */
  static update(camera, aircraftMesh, flightState, cs, dt) {
    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;

    const onGround = !!(flightState && flightState.onGround);
    const groundSpeed = flightState
      ? (flightState.groundSpeed !== undefined
          ? flightState.groundSpeed
          : (flightState.groundSpeedKnots !== undefined
              ? flightState.groundSpeedKnots * 0.514444
              : (flightState.iasKnots ? flightState.iasKnots * 0.514444 : 0)))
      : 0;

    // Determine current flight regime:
    // 'parked': on ground & low speed (< 12 m/s / ~23 kts) -> 45m front 3/4 showcase
    // 'rollout': on ground & high speed (>= 12 m/s) -> 120m runway-edge spotter
    // 'airborne': in flight -> 260m flyby along flight path
    let currentRegime = 'airborne';
    if (onGround) {
      if (cs.flybyRegime === 'rollout') {
        currentRegime = groundSpeed < 9.0 ? 'parked' : 'rollout';
      } else {
        currentRegime = groundSpeed >= 12.0 ? 'rollout' : 'parked';
      }
    }

    // Reinitialize flyby shot when flight regime changes
    if (cs.flybyRegime !== currentRegime) {
      cs.flybyRegime = currentRegime;
      cs.flybySet = false;
    }

    // Aircraft forward vector projected onto horizontal plane
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) {
      forward.normalize();
    } else {
      forward.set(1, 0, 0);
    }
    // Lateral right vector orthogonal to forward on horizontal plane
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    if (currentRegime === 'parked') {
      // Case 1: Landed, parked, or slow taxiing on runway / apron
      // Position camera 45m ahead of nose, 9m to side for an impressive front 3/4 showcase view
      const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
      const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
      const groundH = cs.queryGroundHeight(targetX, targetZ);
      const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

      const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
      if (!cs.flybySet || cs.flybyPos.distanceTo(targetPos) > 75.0) {
        cs.flybyPos.copy(targetPos);
        cs.flybySet = true;
      } else {
        // Smoothly track in front of aircraft if taxiing or turning
        cs.flybyPos.lerp(targetPos, 1 - Math.exp(-Math.max(0, dt) * 6.0));
      }
    } else if (currentRegime === 'rollout') {
      // Case 2: Active takeoff roll or landing rollout at high speed (>= 12 m/s / ~23 kts)
      // Runway-side spotter camera positioned ~120m ahead and 20m off centerline at runway edge
      if (!cs.flybySet) {
        const targetX = planePos.x + forward.x * 120.0 + right.x * 20.0;
        const targetZ = planePos.z + forward.z * 120.0 + right.z * 20.0;
        const groundH = cs.queryGroundHeight(targetX, targetZ);
        const targetY = groundH + 1.8; // Eye level at runway edge
        cs.flybyPos.set(targetX, targetY, targetZ);
        cs.flybySet = true;
      }

      // Reset ahead once aircraft rolls past camera by > 140m
      const toPlane = planePos.clone().sub(cs.flybyPos);
      if (camera.position.distanceTo(planePos) > 180 && forward.dot(toPlane) > 0) {
        cs.flybySet = false;
      }
    } else {
      // Case 3: In flight (airborne)
      // Position camera ahead along flight path, safely above ground and sea level
      if (!cs.flybySet) {
        const targetX = planePos.x + forward.x * 260.0 + right.x * 28.0;
        const targetZ = planePos.z + forward.z * 260.0 + right.z * 28.0;
        const groundH = cs.queryGroundHeight(targetX, targetZ);
        // Height slightly below flight path, but strictly clamped above terrain and water
        const targetY = Math.max(groundH + 4.5, 4.5, planePos.y - 8.0);
        cs.flybyPos.set(targetX, targetY, targetZ);
        cs.flybySet = true;
      }

      // Reset if aircraft passes far beyond
      if (camera.position.distanceTo(planePos) > 600) {
        cs.flybySet = false;
      }
    }

    // Final safety clamp: camera Y must NEVER be below terrain height or water surface
    const currentGroundH = cs.queryGroundHeight(cs.flybyPos.x, cs.flybyPos.z);
    if (cs.flybyPos.y < currentGroundH + 1.5) {
      cs.flybyPos.y = currentGroundH + 1.5;
    }

    camera.position.copy(cs.flybyPos);
    camera.up.set(0, 1, 0);

    // Look at aircraft center with slight vertical offset for good framing
    const lookTarget = planePos.clone().add(new THREE.Vector3(0, 1.2, 0));
    camera.lookAt(lookTarget);
  }
}
