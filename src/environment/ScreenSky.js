import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// three's Sky is a box anchored at the world origin. Once the camera is more than half
// its size away it is outside the box and the black clear colour replaces the whole sky
// above the horizon; a chase camera hovering at that distance flickers in and out of it
// (#636). Moving the box with the camera would keep a second hazard: the shader forces
// gl_Position.z = w, which moves the near clip plane to w = 0, so the faces that cross
// the camera plane clip to vertices at infinity, the case mobile GPUs rasterise worst.
//
// Draw the same scattering shader on one clip-space triangle instead. Its vertices sit
// at w = 1, so nothing ever clips, and each pixel's view ray is rebuilt from the
// projection. On a fixed-depth plane that ray is affine in NDC, so it interpolates
// exactly and stays free of the camera's world position.

const WORLD_POSITION = /vec4 worldPosition = modelMatrix \* vec4\( position, 1\.0 \);\s*vWorldPosition = worldPosition\.xyz;/;
const CLIP_POSITION = /gl_Position = projectionMatrix \* modelViewMatrix \* vec4\( position, 1\.0 \);\s*gl_Position\.z = gl_Position\.w;[^\n]*/;
const VIEW_DIRECTION = 'vec3 direction = normalize( vWorldPosition - cameraPosition );';

function replaceOnce(source, pattern, replacement, label) {
  const result = source.replace(pattern, replacement);
  if (result === source) throw new Error(`Sky shader no longer contains the ${label} it rewrites`);
  return result;
}

export function createScreenSky() {
  const sky = new Sky();
  sky.geometry.dispose();
  sky.geometry = new THREE.BufferGeometry();
  sky.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  sky.frustumCulled = false;

  const material = sky.material;
  material.side = THREE.DoubleSide;
  // vWorldPosition now carries the world-space view ray rather than a point on the box.
  material.vertexShader = replaceOnce(material.vertexShader, WORLD_POSITION, `
			vec3 viewRay = vec3(
				( position.x + projectionMatrix[ 2 ][ 0 ] ) / projectionMatrix[ 0 ][ 0 ],
				( position.y + projectionMatrix[ 2 ][ 1 ] ) / projectionMatrix[ 1 ][ 1 ],
				- 1.0 );
			vWorldPosition = transpose( mat3( viewMatrix ) ) * viewRay;`, 'world position');
  // Same far-plane depth as before, so the depth test against the scene is unchanged.
  material.vertexShader = replaceOnce(material.vertexShader, CLIP_POSITION,
    'gl_Position = vec4( position.xy, 1.0, 1.0 );', 'clip position');
  material.fragmentShader = replaceOnce(material.fragmentShader, VIEW_DIRECTION,
    'vec3 direction = normalize( vWorldPosition );', 'view direction');
  return sky;
}
