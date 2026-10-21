export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2 },
  balanced: { terrain: 'low', maxDpr: 1.5 },
  performance: { terrain: 'low', maxDpr: 1 },
});

export function resolveRenderQuality(value) {
  return Object.hasOwn(RENDER_QUALITY, value) ? value : 'balanced';
}
