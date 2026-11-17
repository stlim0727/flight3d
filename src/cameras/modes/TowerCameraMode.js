import * as THREE from 'three';

/**
 * TowerCameraMode — airport control tower vantage point looking at aircraft.
 */
export class TowerCameraMode {
  static snap(camera, aircraftMesh, cs) {
    camera.position.copy(cs.towerPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
  }

  static update(camera, aircraftMesh, cs) {
    camera.position.copy(cs.towerPos);
    camera.lookAt(aircraftMesh.position);
    camera.up.set(0, 1, 0);
  }
}
