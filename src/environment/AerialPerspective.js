import * as THREE from 'three';

/**
 * One haze law for every surface, the far sea and the sky (#751).
 *
 * The haze thins with height as exp(-HAZE_HEIGHT_FALLOFF * y). What a sight line
 * accumulates is its "reach": the density integrated along it, a pure number. Contrast
 * then falls as exp(-reach^2), the FogExp2 law the scene was tuned with. Meshes within
 * the 45 km depth range integrate over a flat earth; the sky pass integrates over the
 * curved one, so the same law carries the picture out to the true horizon and no mesh
 * has to end in a painted fade.
 *
 * The JS functions mirror the GLSL ones below so the math is testable without a GPU.
 */

export const EARTH_RADIUS_M = 6371000;
export const HAZE_HEIGHT_FALLOFF = 0.00068; // 1/m: density is ~28% of sea level at 6,000 ft
export const DEFAULT_VISIBILITY_M = 10000;

/** Reach at which contrast has fallen to 2%, the meteorological definition of visibility. */
export const VISIBILITY_REACH = Math.sqrt(-Math.log(0.02));

// Height along a sight line over a sphere is h + dy*t + t^2/(2R) while t << R, which makes
// the reach integral a Gaussian. These are its two scales.
const HAZE_COLUMN = Math.sqrt(Math.PI * EARTH_RADIUS_M / (2 * HAZE_HEIGHT_FALLOFF)); // m
const HAZE_SLANT = Math.sqrt(HAZE_HEIGHT_FALLOFF * EARTH_RADIUS_M / 2);
const MAX_EXPONENT = 80; // keeps exp() inside float32 for an eye far above the haze

const ERFCX_A = 2.911;
const SQRT_PI = Math.sqrt(Math.PI);

export const fogFactor = reach => 1 - Math.exp(-reach * reach);

/** Sea-level haze density (1/m) that gives the stated visibility along the ground. */
export const densityForVisibility = visibilityM => VISIBILITY_REACH / visibilityM;

/** Mean density along a flat-earth sight line, relative to the density at the eye. */
export function meanDensityRatio(eyeY, pointY) {
  const s = Math.min(HAZE_HEIGHT_FALLOFF * (Math.max(eyeY, 0) - Math.max(pointY, 0)), MAX_EXPONENT);
  return Math.abs(s) < 1e-3 ? 1 + 0.5 * s : Math.expm1(s) / s;
}

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

/** Reach per unit sea-level density of a sight line that leaves the atmosphere. */
export function skyReach(eyeY, dy) {
  const x = HAZE_SLANT * dy;
  const atEye = Math.exp(-Math.min(HAZE_HEIGHT_FALLOFF * eyeY, MAX_EXPONENT));
  if (x >= 0) return HAZE_COLUMN * atEye * erfcx(x);
  // Below eye level the line dips to a tangent height and climbs out again.
  return HAZE_COLUMN * (2 * Math.exp(Math.min(x * x - HAZE_HEIGHT_FALLOFF * eyeY, 0)) - atEye * erfcx(-x));
}

/** Reach per unit sea-level density of a sight line that ends on the sea. */
export function seaReach(eyeY, dy) {
  const atEye = Math.exp(-Math.min(HAZE_HEIGHT_FALLOFF * eyeY, MAX_EXPONENT));
  const grazing = Math.sqrt(Math.max(dy * dy - horizonDrop(eyeY), 0));
  return HAZE_COLUMN * (erfcx(HAZE_SLANT * grazing) - atEye * erfcx(-HAZE_SLANT * dy));
}

const glsl = value => {
  const text = value.toPrecision(9);
  return /[.e]/.test(text) ? text : `${text}.0`;
};

export const AERIAL_GLSL = /* glsl */`
  const float AERIAL_FALLOFF = ${glsl(HAZE_HEIGHT_FALLOFF)};
  const float AERIAL_EARTH_RADIUS = ${glsl(EARTH_RADIUS_M)};
  const float AERIAL_COLUMN = ${glsl(HAZE_COLUMN)};
  const float AERIAL_SLANT = ${glsl(HAZE_SLANT)};

  float aerialMeanDensityRatio(float eyeY, float pointY) {
    float s = min(AERIAL_FALLOFF * (max(eyeY, 0.0) - max(pointY, 0.0)), ${glsl(MAX_EXPONENT)});
    return abs(s) < 1e-3 ? 1.0 + 0.5 * s : (exp(s) - 1.0) / s;
  }

  float aerialErfcx(float x) {
    return ${glsl(ERFCX_A)} / (${glsl((ERFCX_A - 1) * SQRT_PI)} * x + sqrt(${glsl(Math.PI)} * x * x + ${glsl(ERFCX_A * ERFCX_A)}));
  }

  float aerialSkyReach(float eyeY, float dy) {
    float x = AERIAL_SLANT * dy;
    float atEye = exp(-min(AERIAL_FALLOFF * eyeY, ${glsl(MAX_EXPONENT)}));
    return AERIAL_COLUMN * (x >= 0.0 ? atEye * aerialErfcx(x)
      : 2.0 * exp(min(x * x - AERIAL_FALLOFF * eyeY, 0.0)) - atEye * aerialErfcx(-x));
  }

  // grazing2 = dy * dy - 2 * eyeY / AERIAL_EARTH_RADIUS, positive where the line strikes the sea.
  float aerialSeaReach(float eyeY, float dy, float grazing2) {
    float atEye = exp(-min(AERIAL_FALLOFF * eyeY, ${glsl(MAX_EXPONENT)}));
    return AERIAL_COLUMN * (aerialErfcx(AERIAL_SLANT * sqrt(max(grazing2, 0.0))) - atEye * aerialErfcx(-AERIAL_SLANT * dy));
  }
`;

const STOCK_FOG_VERTEX = 'vFogDepth = - mvPosition.z;';
let installed = false;

/**
 * Replace three's fog chunks so every fogged material integrates the haze along its own
 * sight line. `scene.fog.density` keeps its meaning, the density at the eye. Stock fog
 * applies that one density to the whole line, so from altitude the ground stayed clear
 * while the sea, which integrated, hazed over.
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
