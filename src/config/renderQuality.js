export const RENDER_QUALITY_KEY = 'flight3d.renderQuality';
export const RENDER_QUALITY = Object.freeze({
  high: { terrain: 'high', maxDpr: 2, shadowMapSize: 4096, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180 },
  balanced: { terrain: 'low', maxDpr: 1.5, shadowMapSize: 2048, shadows: true, ao: true, clouds: true, terrainSegments: 256, waterSegments: 180 },
  performance: { terrain: 'low', maxDpr: 1, shadowMapSize: 1024, shadows: true, ao: false, clouds: true, terrainSegments: 256, waterSegments: 180 },
  ultraLow: { terrain: 'ultraLow', maxDpr: 0.75, shadowMapSize: 0, shadows: false, ao: false, clouds: false, terrainSegments: 64, waterSegments: 1 },
});

export function resolveRenderQuality(value) {
  return Object.hasOwn(RENDER_QUALITY, value) ? value : 'balanced';
}
