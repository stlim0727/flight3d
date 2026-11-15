import * as THREE from 'three';

/**
 * One haze law for every fogged surface (#751).
 *
 * The haze thins with height as exp(-HAZE_HEIGHT_FALLOFF * y). What a sight line
 * accumulates is the density integrated along it; contrast then falls as the square of
 * that, the FogExp2 law the scene was tuned with.
 *
 * The JS functions mirror the GLSL ones so the math is testable without a GPU.
 */

export const HAZE_HEIGHT_FALLOFF = 0.00068; // 1/m: density is ~28% of sea level at 6,000 ft

const MAX_EXPONENT = 80; // keeps exp() inside float32 for an eye far above the haze

/** Mean density along a flat-earth sight line, relative to the density at the eye. */
export function meanDensityRatio(eyeY, pointY) {
  const s = Math.min(HAZE_HEIGHT_FALLOFF * (Math.max(eyeY, 0) - Math.max(pointY, 0)), MAX_EXPONENT);
  return Math.abs(s) < 1e-3 ? 1 + 0.5 * s : Math.expm1(s) / s;
}

const glsl = value => {
  const text = value.toPrecision(9);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const AERIAL_GLSL = /* glsl */`
  const float AERIAL_FALLOFF = ${glsl(HAZE_HEIGHT_FALLOFF)};

  float aerialMeanDensityRatio(float eyeY, float pointY) {
    float s = min(AERIAL_FALLOFF * (max(eyeY, 0.0) - max(pointY, 0.0)), ${glsl(MAX_EXPONENT)});
    return abs(s) < 1e-3 ? 1.0 + 0.5 * s : (exp(s) - 1.0) / s;
  }
`;

const STOCK_FOG_VERTEX = 'vFogDepth = - mvPosition.z;';
let installed = false;

/**
 * Replace three's fog chunks so every fogged material integrates the haze along its own
 * sight line. `scene.fog.density` keeps its meaning, the density at the eye. Stock fog
 * applies that one density to the whole line, so from altitude the ground stayed clear
 * while the sea, which integrated, hazed over. Distance is measured from the eye rather
 * than along the view axis, as on the sea, so fog does not change as the camera turns.
 */
export function installHeightFog() {
  if (installed) return;
  if (!THREE.ShaderChunk.fog_vertex.includes(STOCK_FOG_VERTEX)) {
    throw new Error('three fog chunks no longer match the ones the height fog replaces');
  }
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
    #ifdef USE_FOG
      varying vec3 vFogOffset;
    #endif
  `;
  // Eye-to-fragment offset in world axes: the view matrix is rigid, so its transpose rotates back.
  THREE.ShaderChunk.fog_vertex = /* glsl */`
    #ifdef USE_FOG
      vFogOffset = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
    #endif
  `;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogOffset;
      #ifdef FOG_EXP2
        uniform float fogDensity;
        ${AERIAL_GLSL}
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif
  `;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogReach = fogDensity * length( vFogOffset )
          * aerialMeanDensityRatio( cameraPosition.y, cameraPosition.y + vFogOffset.y );
        float fogFactor = 1.0 - exp( - fogReach * fogReach );
      #else
        float fogFactor = smoothstep( fogNear, fogFar, length( vFogOffset ) );
      #endif
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
    #endif
  `;
}
