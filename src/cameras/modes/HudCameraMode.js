/**
 * HudCameraMode — boresight head-up display perspective locked to aircraft attitude.
 */
export class HudCameraMode {
  static snap(camera, aircraftMesh, cs) {
    this.update(camera, aircraftMesh, cs);
  }

  static update(camera, aircraftMesh, cs) {
    camera.position.copy(cs.cockpitHeadOffset).applyMatrix4(aircraftMesh.matrixWorld);
    camera.quaternion.copy(aircraftMesh.quaternion);
    camera.up.set(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
  }
}
