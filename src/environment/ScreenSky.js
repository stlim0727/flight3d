import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OCEAN_SURFACE_GLSL } from './WaterOcean.js';

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
const MAIN = 'void main() {';
const OUTPUT = /gl_FragColor = vec4\( texColor, 1\.0 \);\s*#include <tonemapping_fragment>\s*#include <colorspace_fragment>/;

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

  // Below the horizon the stock shader repeats its horizon colour, so every mesh that
  // ended short of the horizon showed its edge against it (#751). Each pixel's view ray
  // is already here: where it strikes sea level, draw the surface that lies there under
  // the haze law the meshes use.
  Object.assign(material.uniforms, {
    uHazeColor: { value: new THREE.Color(0xc8def4) },
    uHazeDensity: { value: 0.0002 }, // at sea level
    uSkyHazeDensity: { value: 0 },   // sea-level density beyond the atmosphere the sky model depicts
    uSeaRim: { value: 25456 },       // radius of the square sea mesh's corners: no mesh lies beyond
    uSeaBelow: { value: 1 },         // 1: open sea beyond the meshes, 0: land
    uLandColor: { value: new THREE.Color(0x4a5a48) },
    uSunColor: { value: new THREE.Color(0xffeedd) },
    uDeepColor: { value: new THREE.Color(0x0a284a) },
    uShallowColor: { value: new THREE.Color(0x136a8a) },
  });
  material.fragmentShader = replaceOnce(material.fragmentShader, MAIN, `
		uniform vec3 uHazeColor;
		uniform float uHazeDensity;
		uniform float uSkyHazeDensity;
		uniform float uSeaRim;
		uniform float uSeaBelow;
		uniform vec3 uLandColor;
		uniform vec3 uSunColor;
		uniform vec3 uDeepColor;
		uniform vec3 uShallowColor;
		${OCEAN_SURFACE_GLSL}

		void main() {`, 'main entry');
  material.fragmentShader = replaceOnce(material.fragmentShader, OUTPUT, `
			float eyeY = max( cameraPosition.y, 0.5 );
			float drop = 2.0 * eyeY / AERIAL_EARTH_RADIUS;
			float grazing2 = direction.y * direction.y - drop;
			// One pixel of antialiasing on the horizon, which is otherwise a hard step in clear air.
			float sea = direction.y < 0.0 ? clamp( grazing2 / max( fwidth( grazing2 ), 1e-12 ), 0.0, 1.0 ) : 0.0;

			gl_FragColor = vec4( texColor, 1.0 );
			#include <tonemapping_fragment>
			#include <colorspace_fragment>

			// Haze goes on after tone mapping, in display space, as three's fog chunk puts it
			// on every mesh, so that all of them fade to one colour.
			vec3 hazeColor = linearToOutputTexel( vec4( uHazeColor, 1.0 ) ).rgb;
			// The sky model already depicts the atmosphere the scene is tuned for, sunsets
			// included. Only haze thicker than that veils it, as fog closes in.
			float skyHaze = uSkyHazeDensity * aerialSkyReach( eyeY, direction.y );
			gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, 1.0 - exp( - skyHaze * skyHaze ) );
			if ( sea > 0.0 ) {
				grazing2 = max( grazing2, 0.0 );
				// Haze over the far surface is the meshes' haze colour out to the sea mesh's
				// farthest corner, and from there turns into the sky's own horizon colour by the
				// horizon: the surface joins the mesh at one end and the sky at the other
				// without a line at either.
				float rimDy = eyeY / length( vec2( eyeY, uSeaRim ) );
				float rimDistance = AERIAL_EARTH_RADIUS * ( rimDy - sqrt( max( rimDy * rimDy - drop, 0.0 ) ) );
				float seaDistance = AERIAL_EARTH_RADIUS * ( - direction.y - sqrt( grazing2 ) );
				float horizonDistance = AERIAL_EARTH_RADIUS * sqrt( drop );
				vec3 haze = mix( hazeColor, gl_FragColor.rgb,
					smoothstep( rimDistance, max( horizonDistance, rimDistance + 1.0 ), seaDistance ) );
				vec3 land = uLandColor * mix( 0.08, 0.7, smoothstep( -0.04, 0.15, vSunDirection.y ) );
				vec3 ocean = oceanFarColor( direction, grazing2, vSunDirection, uSunColor, uHazeColor, uDeepColor, uShallowColor );
				vec4 surface = vec4( mix( land, ocean, uSeaBelow ), 1.0 );
				#if defined( TONE_MAPPING )
					surface.rgb = toneMapping( surface.rgb );
				#endif
				surface = linearToOutputTexel( surface );
				float reach = uHazeDensity * aerialSeaReach( eyeY, direction.y, grazing2 );
				gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( surface.rgb, haze, 1.0 - exp( - reach * reach ) ), sea );
			}`, 'colour output');
  return sky;
}
