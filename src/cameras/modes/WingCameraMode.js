import * as THREE from 'three';

/**
 * WingCameraMode — passenger window view overlooking left wing and engine.
 */
export class WingCameraMode {
  static snap(camera, aircraftMesh, cs) {
    const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
    const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
    camera.position.copy(eyeWorld);
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
    camera.up.copy(upWorld);
    const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
    lookLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), cs.wingLookYaw);
    lookLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), cs.wingLookPitch);
    const lookWorld = eyeWorld.clone().add(lookLocal.applyQuaternion(aircraftMesh.quaternion));
    camera.lookAt(lookWorld);
  }

  static update(camera, aircraftMesh, cs) {
    const planeQuat = aircraftMesh.quaternion;
    const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
    windowLocal.y += cs.vibrationOffset.y * 0.75;
    windowLocal.x += cs.vibrationOffset.x * 0.75;
    const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
    camera.position.copy(eyeWorld);

    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
    camera.up.copy(upWorld);

    const cursorWingYaw = cs.enableCursorTrack ? (-cs.cursorNormX * 0.16) : 0;
    const cursorWingPitch = cs.enableCursorTrack ? (-cs.cursorNormY * 0.12) : 0;
    const totalWingYaw = cs.wingLookYaw + cursorWingYaw;
    const totalWingPitch = cs.wingLookPitch + cursorWingPitch;

    const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
    lookLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), totalWingYaw);
    lookLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), totalWingPitch);

    const lookWorld = eyeWorld.clone().add(lookLocal.applyQuaternion(planeQuat));
    camera.lookAt(lookWorld);
  }
}
