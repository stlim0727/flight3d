export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2, maxPixels: 3840 * 2160, shadowMapSize: 4096, farShadowMapSize: 4096, farShadowRange: 4000, shadows: true, ao: true, clouds: true, greenSpace: true, terrainSegments: 256, waterSegments: 180, terrainDetailTiles: 7, terrainHighDetailTiles: 4, terrainUltraDetailTiles: 1, terrainAnisotropy: 8, antialias: true, flatShading: false },
  balanced: { simpleF16Canopy: true, limitF16AirportLights: true, terrain: 'low', maxDpr: 1.5, maxPixels: 2560 * 1440, shadowMapSize: 2048, farShadowMapSize: 2048, farShadowRange: 3000, shadows: true, ao: true, clouds: true, greenSpace: true, terrainSegments: 192, waterSegments: 144, terrainDetailTiles: 6, terrainHighDetailTiles: 3, terrainUltraDetailTiles: 1, terrainAnisotropy: 8, antialias: true, flatShading: false },
  performance: { simpleF16Canopy: true, limitF16AirportLights: true, terrain: 'low', maxDpr: 1, maxPixels: 1280 * 720, shadowMapSize: 1024, farShadowMapSize: 0, farShadowRange: 0, shadows: true, ao: false, clouds: true, greenSpace: false, terrainSegments: 128, waterSegments: 96, terrainDetailTiles: 4, terrainHighDetailTiles: 1, terrainUltraDetailTiles: 0, terrainAnisotropy: 4, antialias: true, flatShading: false },
  ultraLow: { simpleF16Canopy: true, limitF16AirportLights: true, terrain: 'ultraLow', maxDpr: 0.75, maxPixels: 1280 * 720, shadowMapSize: 0, farShadowMapSize: 0, farShadowRange: 0, shadows: false, ao: false, clouds: false, greenSpace: false, terrainSegments: 64, waterSegments: 64, terrainDetailTiles: 2, terrainHighDetailTiles: 0, terrainUltraDetailTiles: 0, terrainAnisotropy: 2, antialias: false, flatShading: true },
});

// farShadowRange is the half-width in metres of the coarse sun-shadow map around the camera
// (src/environment/FarSunShadow.js); shadows hold full strength to 0.7 of it. Off below balanced.
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
export function renderPixelRatio(quality, width, height, devicePixelRatio = 1, aircraftId) {
  const resolved = resolveRenderQuality(quality);
  const preset = RENDER_QUALITY[resolved];
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const area = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? width * height : 1;
  const ratio = Math.min(dpr, preset.maxDpr, Math.sqrt(preset.maxPixels / area));
  if (aircraftId !== 'F16' || resolved === 'high') return ratio;
  const f16Scale = 0.85;
  return resolved === 'balanced' ? ratio * f16Scale : Math.min(ratio, dpr * f16Scale);
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
