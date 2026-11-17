import * as THREE from 'three';

/**
 * BanditCameraMode — over-the-shoulder framing on the nearest live bandit.
 */
export class BanditCameraMode {
  static snap(camera, aircraftMesh, cs) {
    this.update(camera, aircraftMesh, cs);
  }

  static update(camera, aircraftMesh, cs) {
    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;
    const bandit = cs.nearestLiveBandit(planePos);

    if (!bandit) {
      cs.mode = cs.constructor.MODES.CHASE;
      const planeForward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
      cs.chasePos.copy(planePos).addScaledVector(planeForward, -cs.chaseDistance);
      cs.chasePos.y += cs.chaseHeight;
      camera.position.copy(cs.chasePos);
      camera.up.set(0, 1, 0);
      camera.lookAt(planePos.clone().add(new THREE.Vector3(0, 1.5, 0)));
      return;
    }

    const banditPos = bandit.position.clone();
    const playerBearing = planePos.clone().sub(banditPos);
    playerBearing.y = 0;
    const side = new THREE.Vector3();
    if (playerBearing.lengthSq() > 1e-6) {
      playerBearing.normalize();
      side.set(-playerBearing.z, 0, playerBearing.x);
    } else {
      playerBearing.set(0, 0, -1);
      side.set(1, 0, 0);
    }
    const range = planePos.distanceTo(banditPos);
    const backM = 22.0 + THREE.MathUtils.clamp(range * 0.01, 0, 20.0);
    const sideM = 8.0 + THREE.MathUtils.clamp(range * 0.003, 0, 6.0);
    camera.position.copy(banditPos)
      .addScaledVector(playerBearing, -backM)
      .addScaledVector(side, sideM)
      .addScaledVector(new THREE.Vector3(0, 1, 0), 5.0);
    camera.up.set(0, 1, 0);
    camera.lookAt(banditPos.clone().addScaledVector(playerBearing, 6.0)
      .addScaledVector(new THREE.Vector3(0, 1, 0), 1.0));
  }
}
