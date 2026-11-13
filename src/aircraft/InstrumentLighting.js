import * as THREE from 'three';
import { nightLightLevel } from '../environment/AirportNightLighting.js';

/**
 * A shielded panel wash, attached in aircraft metres and aimed below the eye.
 *
 * The light hangs beside the cockpit group, not inside it: a view that hides the interior
 * would otherwise hide the light too, and changing the visible light set recompiles every
 * lit material on screen in one blocking frame (issue #83). It goes dark by intensity
 * whenever the interior is not displayed.
 */
export function installInstrumentLighting(cockpit, eye, color = 0xffb46b, powered = () => true) {
  const light = new THREE.SpotLight(color, 0, 1.8, .85, .8, 2);
  light.name = 'Night instrument panel flood';
  light.position.set(eye.x, eye.y + .12, eye.z - .08);
  light.target.position.set(eye.x, eye.y - .4, eye.z - .7);
  (cockpit.group.parent ?? cockpit.group).add(light, light.target);
  cockpit.syncLighting = sky => {
    const lit = powered() && cockpit.group.visible;
    light.intensity = lit ? 2.4 * nightLightLevel(sky.sunPosition.y) : 0;
  };
  return light;
}
