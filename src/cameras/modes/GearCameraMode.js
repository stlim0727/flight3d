import * as THREE from 'three';

/**
 * GearCameraMode — lower fuselage oblique belly cam looking at landing gear and runway.
 */
export class GearCameraMode {
  static snap(camera, aircraftMesh, cs) {
    const eyeWorld = cs.gearCamOffset.clone().applyMatrix4(aircraftMesh.matrixWorld);
    const targetWorld = cs.gearLookTarget.clone().applyMatrix4(aircraftMesh.matrixWorld);
    camera.position.copy(eyeWorld);
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
    camera.up.copy(upWorld);
    camera.lookAt(targetWorld);
  }

  static update(camera, aircraftMesh, cs) {
    const planeQuat = aircraftMesh.quaternion;
    const eyeLocal = cs.gearCamOffset.clone();
    if (Math.abs(cs.vibrationOffset.y) > 0.0001) {
      eyeLocal.y += cs.vibrationOffset.y * 1.2;
      eyeLocal.x += cs.vibrationOffset.x * 1.2;
    }
    const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);

    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
    camera.up.copy(upWorld);

    if (Math.abs(cs.touchJoltOffset) > 0.0005) {
      eyeWorld.addScaledVector(upWorld, cs.touchJoltOffset * 1.6);
    }

    camera.position.copy(eyeWorld);

    const headYaw = cs.headLookActive ? cs.headLookYaw : 0;
    const headPitch = cs.headLookActive ? cs.headLookPitch : 0;
    const targetLocal = cs.gearLookTarget.clone();
    targetLocal.x += cs.gearLookYaw * 3.0 + headYaw * 3.0;
    targetLocal.y += cs.gearLookPitch * 3.0 + headPitch * 3.0;
    const targetWorld = targetLocal.applyMatrix4(aircraftMesh.matrixWorld);
    camera.lookAt(targetWorld);
  }
}
