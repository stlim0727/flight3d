import * as THREE from 'three';

/**
 * Apply an explicit logarithmic depth bias (2.5 cm per unit along the view ray)
 * alongside hardware polygonOffset so coplanar surfaces stay separated when
 * Three.js writes gl_FragDepth under logarithmicDepthBuffer.
 */
export function applyLogDepthOffset(material, units = -(material?.polygonOffsetFactor || -1)) {
  if (!material || !Number.isFinite(units) || units === 0) return material;
  material.userData = material.userData || {};
  material.userData.logDepthOffsetUnits = units;
  if (!material.polygonOffset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -units;
    material.polygonOffsetUnits = -units;
  }
  const offset = Number((0.025 * units).toFixed(4));
  const scale = Number((1 - 0.0005 * units).toFixed(6));
  const offsetExpr = offset >= 0 ? `- ${offset}` : `+ ${Math.abs(offset)}`;
  const previousCompile = material.onBeforeCompile;
  const previousKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof previousCompile === 'function') {
      previousCompile.call(this, shader, renderer);
    }
    if (!shader?.fragmentShader?.includes('#include <logdepthbuf_fragment>')) return;
    // Native polygon offset alone is not a dependable separation when the
    // fragment shader writes logarithmic depth. Bias the same depth encoding
    // explicitly along the view ray with both near-field and distance-invariant terms.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <logdepthbuf_fragment>',
      `#include <logdepthbuf_fragment>
      #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
        if (vIsPerspective != 0.0) {
          gl_FragDepth = log2(max(1.0, vFragDepth * ${scale} ${offsetExpr})) * logDepthBufFC * 0.5;
        }
      #endif`
    );
  };
  const suffix = `log-depth-offset:${offset}`;
  material.customProgramCacheKey = function () {
    const baseKey = previousKey ? previousKey() : '';
    return baseKey ? `${baseKey}:${suffix}` : suffix;
  };
  return material;
}

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
  const units = -(material.polygonOffsetFactor || -2);
  applyLogDepthOffset(material, units);
  material.customProgramCacheKey = () => (units === 2 ? 'runway-marking-depth-v1' : `runway-marking-depth-v1:${units}`);
  return material;
}
