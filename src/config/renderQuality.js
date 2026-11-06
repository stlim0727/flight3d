export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2, maxPixels: 3840 * 2160, shadowMapSize: 4096, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  balanced: { terrain: 'low', maxDpr: 1.5, maxPixels: 2560 * 1440, shadowMapSize: 2048, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  performance: { terrain: 'low', maxDpr: 1, maxPixels: 1920 * 1080, shadowMapSize: 1024, shadows: true, ao: false, clouds: true, terrainSegments: 256, waterSegments: 180, antialias: true, flatShading: false },
  ultraLow: { terrain: 'ultraLow', maxDpr: 0.75, maxPixels: 1280 * 720, shadowMapSize: 0, shadows: false, ao: false, clouds: false, terrainSegments: 64, waterSegments: 64, antialias: false, flatShading: true },
});

export function resolveRenderQuality(value) {
  return Object.hasOwn(RENDER_QUALITY, value) ? value : 'balanced';
}

// Capability hints are conservative defaults, not GPU performance measurements.
// A valid saved/manual selection always wins, including on touch devices.
export function initialRenderQuality(saved, { coarsePointer = false, deviceMemory } = {}) {
  if (Object.hasOwn(RENDER_QUALITY, saved)) return saved;
  return coarsePointer || (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4)
    ? 'performance' : 'balanced';
}

/** Bound physical framebuffer area as well as DPR; CSS/HUD size stays unchanged. */
export function renderPixelRatio(quality, width, height, devicePixelRatio = 1) {
  const preset = RENDER_QUALITY[resolveRenderQuality(quality)];
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const area = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width * height : 1;
  return Math.min(dpr, preset.maxDpr, Math.sqrt(preset.maxPixels / area));
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
