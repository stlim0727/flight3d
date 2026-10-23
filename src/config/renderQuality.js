export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2, shadowMapSize: 4096 },
  balanced: { terrain: 'low', maxDpr: 1.5, shadowMapSize: 2048 },
  performance: { terrain: 'low', maxDpr: 1, shadowMapSize: 1024 },
});

export function resolveRenderQuality(value) {
  return Object.hasOwn(RENDER_QUALITY, value) ? value : 'balanced';
}
