import * as THREE from 'three';
const COCKPIT_PITCH_LIMIT = Math.PI * 0.48;

/**
 * CockpitCameraMode — first-person captain's eye POV.
 *
 * Owns: G-force head inertia, stall buffet vibration, touchdown shock jolt,
 * look-direction (yaw/pitch) management, photo-cockpit eye offset selection,
 * optical-zoom lean, and all cockpit-specific quaternion math.
 *
 * Receives a context object from CameraSystem on each update() call that
 * contains the shared state it reads and writes.
 */
export class CockpitCameraMode {
  /**
   * Snap the camera to the cockpit eye point without damping.
   * Called from CameraSystem.snapToTarget().
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} cs – CameraSystem instance (shared state)
   */
  static snap(camera, aircraftMesh, cs) {
    const eyeLocal = cs.cockpitHeadOffset.clone();
    if (camera && camera.aspect < 1.0) {
      eyeLocal.x = cs.cockpitPortraitEyeX;
      if (cs.cockpitPortraitEyeY !== null && cs.cockpitPortraitEyeY !== undefined) {
        eyeLocal.y = cs.cockpitPortraitEyeY;
      } else {
        eyeLocal.y += 0.03;
      }
    }
    eyeLocal.add(cs.cockpitUserOffset);
    const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
    camera.position.copy(eyeWorld);
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
    camera.up.copy(upWorld);
    const headYaw = cs.headLookActive ? cs.headLookYaw : 0;
    const headPitch = cs.headLookActive ? cs.headLookPitch : 0;
    const forwardLocal = new THREE.Vector3(0, 0, -100);
    const pitch = THREE.MathUtils.clamp(cs.lookPitch + headPitch + (cs.chartPitchOffset || 0), -COCKPIT_PITCH_LIMIT, COCKPIT_PITCH_LIMIT);
    forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    const forwardWorld = forwardLocal.applyQuaternion(aircraftMesh.quaternion);
    camera.lookAt(eyeWorld.clone().add(forwardWorld));
  }

  /**
   * Update the cockpit view each frame.
   *
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} aircraftMesh
   * @param {object} flightState
   * @param {object} cs – CameraSystem instance (shared state)
   */
  static update(camera, aircraftMesh, flightState, cs) {
    const planeQuat = aircraftMesh.quaternion;

    // 1. G-force head inertia
    // On ground, suppress landing-gear oscillation to prevent instrument jitter.
    const gForce = flightState.onGround ? 1.0 : (flightState.gForce || 1.0);
    const targetGOffset = Math.max(-0.02, Math.min(0.02, -(gForce - 1.0) * 0.015));
    cs.headGForceOffset.y += (targetGOffset - cs.headGForceOffset.y) * Math.min(1.0, cs._frameDt * 4.0);

    // 2. Stall buffet vibration + pre-stall stick-shaker buzz
    let buffetX = 0, buffetY = 0;
    if (!cs.motionFrozen && flightState.isStalled && !flightState.onGround) {
      const t = performance.now() * 0.03;
      const severity = flightState.buffetVibration || 0.5;
      buffetX = (Math.sin(t * 1.7) + Math.cos(t * 3.1)) * 0.015 * severity;
      buffetY = (Math.cos(t * 2.3) + Math.sin(t * 4.2)) * 0.015 * severity;
    } else if (!cs.motionFrozen && flightState.isPreStall && !flightState.onGround) {
      const t = performance.now() * 0.09;
      buffetX = Math.sin(t) * 0.0035;
    }

    // 3. Build eye-point in aircraft-local space
    const eyeLocal = cs.cockpitHeadOffset.clone();
    if (camera && camera.aspect < 1.0) {
      eyeLocal.x = cs.cockpitPortraitEyeX;
      if (cs.cockpitPortraitEyeY !== null && cs.cockpitPortraitEyeY !== undefined) {
        eyeLocal.y = cs.cockpitPortraitEyeY;
      } else {
        eyeLocal.y += 0.03;
      }
    }
    if (cs.photoCockpit && cs.supportsPhotoCockpit) {
      eyeLocal.set(-0.48, 0.88, -12.02);
    }
    eyeLocal.add(cs.cockpitUserOffset);

    // Optical zoom forward lean (non-photo cockpit only)
    if (!(cs.photoCockpit && cs.supportsPhotoCockpit)) {
      const lean = (1 - 1 / cs.opticalZoom) / (1 - 1 / cs.opticalZoomMax);
      eyeLocal.addScaledVector(cs.cockpitZoomLean, lean);
    }

    // 4. Apply dynamics: G-force, stall buffet, touchdown jolt, vibration
    eyeLocal.y += cs.headGForceOffset.y + buffetY + cs.touchJoltOffset + cs.vibrationOffset.y;
    eyeLocal.x += buffetX + cs.vibrationOffset.x;

    // 5. Transform to world space
    const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
    camera.position.copy(eyeWorld);

    // 6. Up vector tracks aircraft roll (must be set BEFORE lookAt)
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
    camera.up.copy(upWorld);

    // 7. Forward look direction: yaw + pitch + cursor and head-tracking offsets
    const cursorYaw   = cs.enableCursorTrack ? (-cs.cursorNormX * 0.18) : 0;
    const cursorPitch = cs.enableCursorTrack ? (-cs.cursorNormY * 0.12) : 0;
    const headYaw = cs.headLookActive ? cs.headLookYaw : 0;
    const headPitch = cs.headLookActive ? cs.headLookPitch : 0;

    const effectiveYaw = cs.lookYaw + cursorYaw + headYaw;
    const isPhoto = cs.photoCockpit && cs.supportsPhotoCockpit;
    const basePitch = (isPhoto && !cs.isLookingAwayFromCenter())
      ? (cs.lookPitch * 0.2 - 0.04)
      : cs.lookPitch;

    // Zoom gaze lift fades out when looking away from center
    const zoomGazeLift = isPhoto
      ? 0
      : (cs.opticalZoom - 1) * cs.cockpitZoomGazeLift * cs.zoomGazeBlend();
    const effectivePitch = THREE.MathUtils.clamp(
      basePitch + zoomGazeLift + cursorPitch + headPitch + (cs.chartPitchOffset || 0),
      -COCKPIT_PITCH_LIMIT,
      COCKPIT_PITCH_LIMIT
    );

    const forwardLocal = new THREE.Vector3(0, 0, -100);
    forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), effectivePitch);
    forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), effectiveYaw);
    const forwardWorld = forwardLocal.applyQuaternion(planeQuat);

    camera.lookAt(eyeWorld.clone().add(forwardWorld));
  }
}
