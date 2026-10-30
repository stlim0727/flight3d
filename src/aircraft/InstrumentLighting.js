import * as THREE from 'three';
import { nightLightLevel } from '../environment/AirportNightLighting.js';

/** A shielded panel wash, attached in aircraft metres and aimed below the eye. */
export function installInstrumentLighting(cockpit, eye, color = 0xffb46b, powered = () => true) {
  const light = new THREE.SpotLight(color, 0, 1.8, .85, .8, 2);
  light.name = 'Night instrument panel flood';
  light.position.set(eye.x, eye.y + .12, eye.z - .08);
  light.target.position.set(eye.x, eye.y - .4, eye.z - .7);
  cockpit.group.add(light, light.target);
  cockpit.syncLighting = sky => {
    light.intensity = powered() ? 2.4 * nightLightLevel(sky.sunPosition.y) : 0;
  };
  return light;
}
