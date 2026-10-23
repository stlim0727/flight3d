import * as THREE from 'three';

/** Painted overlays keep their real position for lighting and shadow lookup. */
export function createRunwayMarkingMaterial(parameters = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
    ...parameters
  });
  material.onBeforeCompile = shader => {
    // Native polygon offset alone is not a dependable separation when the
    // fragment shader writes logarithmic depth. Bias the same depth encoding
    // explicitly, by a bounded 5 cm toward the camera rather than a normalized
    // constant whose world-space displacement grows with viewing distance.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <logdepthbuf_fragment>',
      `#include <logdepthbuf_fragment>
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        if (vIsPerspective != 0.0) {
          gl_FragDepth = log2(max(1.0, vFragDepth - 0.05)) * logDepthBufFC * 0.5;
        }
      #endif`
    );
  };
  material.customProgramCacheKey = () => 'runway-marking-depth-v1';
  return material;
}
