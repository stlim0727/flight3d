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

// --- Sight lines that leave the meshes: the sea out to the horizon ---------------------
//
// No mesh reaches the horizon, so the sky pass draws the sea beyond them and needs the
// haze a line crosses on its way to sea level over a sphere. While its length t is much
// less than the radius R, the height along a line that starts at h with vertical
// direction cosine dy is h + dy*t + t^2/(2R), which makes that integral a Gaussian.

export const EARTH_RADIUS_M = 6371000;

const HAZE_COLUMN = Math.sqrt(Math.PI * EARTH_RADIUS_M / (2 * HAZE_HEIGHT_FALLOFF)); // m
const HAZE_SLANT = Math.sqrt(HAZE_HEIGHT_FALLOFF * EARTH_RADIUS_M / 2);
const ERFCX_A = 2.911;
const SQRT_PI = Math.sqrt(Math.PI);

/** exp(x^2) * erfc(x) for x >= 0, within 0.4% (Ren & MacKenzie 2007). */
export function erfcx(x) {
  return ERFCX_A / ((ERFCX_A - 1) * SQRT_PI * x + Math.sqrt(Math.PI * x * x + ERFCX_A * ERFCX_A));
}

/** Squared sine of the horizon's dip below eye level. */
export const horizonDrop = eyeY => 2 * eyeY / EARTH_RADIUS_M;

/** Whether a sight line with vertical direction cosine `dy` strikes sea level. */
export const strikesSea = (eyeY, dy) => dy < 0 && dy * dy > horizonDrop(eyeY);

/** Distance (m) to sea level along a sight line that strikes it. */
export function seaDistance(eyeY, dy) {
  return EARTH_RADIUS_M * (-dy - Math.sqrt(Math.max(dy * dy - horizonDrop(eyeY), 0)));
}

/**
 * Density integrated along a sight line that ends on the sea, per unit sea-level density
 * (m). Multiply by `SkyAtmosphere.baseDensity`; contrast falls as exp(-(that product)^2).
 */
export function seaReach(eyeY, dy) {
  const atEye = Math.exp(-Math.min(HAZE_HEIGHT_FALLOFF * eyeY, MAX_EXPONENT));
  const grazing = Math.sqrt(Math.max(dy * dy - horizonDrop(eyeY), 0));
  return HAZE_COLUMN * (erfcx(HAZE_SLANT * grazing) - atEye * erfcx(-HAZE_SLANT * dy));
}

const glsl = value => {
  const text = value.toPrecision(9);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const AERIAL_SEA_GLSL = /* glsl */`
  const float AERIAL_EARTH_RADIUS = ${glsl(EARTH_RADIUS_M)};

  float aerialErfcx(float x) {
    return ${glsl(ERFCX_A)} / (${glsl((ERFCX_A - 1) * SQRT_PI)} * x + sqrt(${glsl(Math.PI)} * x * x + ${glsl(ERFCX_A * ERFCX_A)}));
  }

  // grazing2 = dy * dy - 2 * eyeY / AERIAL_EARTH_RADIUS, positive where the line strikes the sea.
  float aerialSeaReach(float eyeY, float dy, float grazing2) {
    float atEye = exp(-min(${glsl(HAZE_HEIGHT_FALLOFF)} * eyeY, ${glsl(MAX_EXPONENT)}));
    return ${glsl(HAZE_COLUMN)} * (aerialErfcx(${glsl(HAZE_SLANT)} * sqrt(max(grazing2, 0.0))) - atEye * aerialErfcx(${glsl(-HAZE_SLANT)} * dy));
  }
`;

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
