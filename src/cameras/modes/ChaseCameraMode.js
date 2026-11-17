import * as THREE from 'three';

/**
 * ChaseCameraMode — third-person exterior chase camera.
 *
 * Owns: spring-damper lag, terrain elevation clamping, orbit mouse/touch input,
 * inertial speed lag, and ground avoidance.
 */
export class ChaseCameraMode {
  /**
   * Snap chase camera immediately to target position.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs - CameraSystem instance
   */
  static snap(camera, aircraftMesh, cs) {
    const behindLocal = new THREE.Vector3(0, cs.chaseHeight, cs.chaseDistance);
    behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), cs.chasePitch);
    behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), cs.chaseYaw);
    cs.chasePos.copy(behindLocal.applyMatrix4(aircraftMesh.matrixWorld));
    cs.chaseTarget.copy(aircraftMesh.position);
    cs.chaseTargetInitialized = true;

    const groundH = cs.queryGroundHeight(cs.chasePos.x, cs.chasePos.z);
    if (cs.chasePos.y < groundH + 1.8) {
      cs.chasePos.y = groundH + 1.8;
    }
    camera.position.copy(cs.chasePos);
    const lookTarget = aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTarget);
  }

  /**
   * Update chase camera each frame.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs - CameraSystem instance
   * @param {number} dt
   */
  static update(camera, aircraftMesh, cs, dt) {
    const planePos = aircraftMesh.position;
    const cursorChaseYaw = cs.enableCursorTrack ? (-cs.cursorNormX * 0.18) : 0;
    const cursorChasePitch = cs.enableCursorTrack ? (-cs.cursorNormY * 0.12) : 0;

    const totalYaw = cs.chaseYaw + cursorChaseYaw;
    const totalPitch = Math.max(-1.1, Math.min(cs.constructor.CHASE_PITCH_LOW_LIMIT, cs.chasePitch + cursorChasePitch));

    const effectiveChaseDist = cs.chaseDistance + cs.chaseSpeedLag;
    const behindLocal = new THREE.Vector3(0, cs.chaseHeight, effectiveChaseDist);
    behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), totalPitch);
    behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);

    const targetBehindWorld = behindLocal.applyMatrix4(aircraftMesh.matrixWorld);

    // Ground safety clamp: prevent exterior camera from clipping into terrain or runway
    const groundH = cs.queryGroundHeight(targetBehindWorld.x, targetBehindWorld.z);
    if (targetBehindWorld.y < groundH + 1.8) {
      targetBehindWorld.y = groundH + 1.8;
    }

    // Damped interpolation to smooth camera motion
    cs.chasePos.lerp(targetBehindWorld, 1 - Math.exp(-Math.max(0, dt) * 6.5));
    // Clamp the final smoothed position too, especially along steep terrain.
    cs.chasePos.y = Math.max(cs.chasePos.y, cs.queryGroundHeight(cs.chasePos.x, cs.chasePos.z) + 1.8);
    camera.position.copy(cs.chasePos);

    const lookTarget = planePos.clone().add(new THREE.Vector3(
      cs.chaseVibration.x,
      1.5 + cs.chaseVibration.y,
      cs.chaseVibration.z
    ));
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTarget);
  }
}
