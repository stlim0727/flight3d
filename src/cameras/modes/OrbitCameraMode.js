import * as THREE from 'three';

/**
 * OrbitCameraMode (Drone Orbit View) — free inspection mode.
 *
 * Owns: continuous circular drone orbit, pitch/height elevation adjustment,
 * drag rotation, hovering bob motion, and terrain height clamping.
 */
export class OrbitCameraMode {
  /**
   * Snap drone orbit camera to initial position.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs - CameraSystem instance
   */
  static snap(camera, aircraftMesh, cs) {
    const px = aircraftMesh.position.x + Math.sin(cs.droneOrbitAngle) * cs.droneDistance;
    const py = aircraftMesh.position.y + cs.droneHeight;
    const pz = aircraftMesh.position.z + Math.cos(cs.droneOrbitAngle) * cs.droneDistance;
    // A paused or parked airframe sits on terrain, so the rig must not snap inside it.
    cs.dronePos.set(px, Math.max(py, cs.queryGroundHeight(px, pz) + 2.5), pz);
    cs.droneInitialized = true;
    camera.position.copy(cs.dronePos);
    camera.up.set(0, 1, 0);
    camera.lookAt(aircraftMesh.position.clone().add(cs.droneLookOffset));
  }

  /**
   * Update drone orbit camera each frame.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs - CameraSystem instance
   * @param {number} dt
   */
  static update(camera, aircraftMesh, cs, dt) {
    const planePos = aircraftMesh.position;

    // Continuous 360° circular drone orbit around aircraft from slightly above (pauses when user overrides look)
    if (!cs.userLookOverridden && !cs.autoPaused) {
      cs.droneOrbitAngle += cs.droneOrbitSpeed * dt;
    }

    // Subtle organic drone hovering bob motion
    const hoverBob = Math.sin(cs.droneOrbitAngle * 2.2) * 0.55;
    const currentHeight = planePos.y + cs.droneHeight + hoverBob;
    const targetX = planePos.x + Math.sin(cs.droneOrbitAngle) * cs.droneDistance;
    const targetZ = planePos.z + Math.cos(cs.droneOrbitAngle) * cs.droneDistance;

    const targetPos = new THREE.Vector3(targetX, currentHeight, targetZ);
    targetPos.y = Math.max(targetPos.y, cs.queryGroundHeight(targetX, targetZ) + 2.5);
    if (!cs.droneInitialized) {
      cs.dronePos.copy(targetPos);
      cs.droneInitialized = true;
    } else {
      // Smooth position interpolation to prevent abrupt jumps
      cs.dronePos.lerp(targetPos, 1 - Math.exp(-Math.max(0, dt) * 8.5));
    }
    camera.position.copy(cs.dronePos);

    camera.up.set(0, 1, 0);
    const lookTarget = planePos.clone().add(cs.droneLookOffset);
    camera.lookAt(lookTarget);
  }
}
