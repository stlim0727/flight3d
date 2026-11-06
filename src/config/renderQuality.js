export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2, shadowMapSize: 4096, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  balanced: { terrain: 'low', maxDpr: 1.5, shadowMapSize: 2048, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  performance: { terrain: 'low', maxDpr: 1, shadowMapSize: 1024, shadows: true, ao: false, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  ultraLow: { terrain: 'ultraLow', maxDpr: 0.75, shadowMapSize: 0, shadows: false, ao: false, clouds: false, terrainSegments: 64, waterSegments: 64, antialias: false, flatShading: true },
});

export function resolveRenderQuality(value) {
  return Object.hasOwn(RENDER_QUALITY, value) ? value : 'balanced';
}

/**
 * Traverses an Object3D hierarchy and toggles flatShading on all standard materials.
 * Toggling flatShading enables the retro low-poly aesthetic (VF1/VF2 style) where
 * polygon facets stand out cleanly without smooth normal interpolation.
 *
 * @param {import('three').Object3D} root
 * @param {boolean} flatShading
 */
export function applyFlatShading(root, flatShading) {
  if (!root?.traverse) return;
  const target = Boolean(flatShading);
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (mat && 'flatShading' in mat && mat.flatShading !== target) {
        mat.flatShading = target;
        mat.needsUpdate = true;
      }
    }
  });
}
