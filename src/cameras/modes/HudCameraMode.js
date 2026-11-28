import * as THREE from 'three';

const HUD_PITCH_LIMIT = Math.PI * 0.45;
const HUD_YAW_LIMIT = Math.PI * 0.48;

/**
 * HudCameraMode — head-up display perspective at the captain's eye point.
 * The eye stays on the aircraft axis, but the view turns with the same look
 * state as the cockpit so drag, hat switching and head tracking work here too.
 */
export class HudCameraMode {
  static snap(camera, aircraftMesh, cs) {
    this.update(camera, aircraftMesh, cs);
  }

  static update(camera, aircraftMesh, cs) {
    camera.position.copy(cs.cockpitHeadOffset).applyMatrix4(aircraftMesh.matrixWorld);
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
    camera.up.copy(upWorld);
    const yaw = cs.lookYaw + (cs.headLookActive ? cs.headLookYaw : 0);
    const boundedYaw = THREE.MathUtils.clamp(yaw, -HUD_YAW_LIMIT, HUD_YAW_LIMIT);
    const lookPitch = (cs.lookPitch ?? -0.25) - (cs.aircraftLookPitch ?? -0.25);
    const pitch = THREE.MathUtils.clamp(
      lookPitch + (cs.headLookActive ? cs.headLookPitch : 0),
      -HUD_PITCH_LIMIT, HUD_PITCH_LIMIT
    );
    const forwardLocal = new THREE.Vector3(0, 0, -100);
    forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), boundedYaw);
    const forwardWorld = forwardLocal.applyQuaternion(aircraftMesh.quaternion);
    camera.lookAt(camera.position.clone().add(forwardWorld));
  }

}
