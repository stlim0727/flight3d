import { generateEffectAtlasData } from '../effects/effectFlipbookData.js';
import { createCloudDensityData } from '../environment/cloudDensityData.js';
import { generateAllTerrainTextureBuffers } from '../environment/terrainTextureData.js';

self.addEventListener('message', (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'cloud-density') {
      const data = createCloudDensityData(payload?.size);
      self.postMessage({ id, ok: true, result: data }, [data.buffer]);
    } else if (type === 'effect-atlas') {
      // Slice a transferable copy so the worker's per-kind cache stays intact across requests.
      const cached = generateEffectAtlasData(payload?.kind, { useCache: true });
      const data = cached.slice();
      self.postMessage({ id, ok: true, result: data }, [data.buffer]);
    } else if (type === 'terrain-textures') {
      const buffers = generateAllTerrainTextureBuffers();
      const transfer = Object.values(buffers).map(entry => entry.data.buffer);
      self.postMessage({ id, ok: true, result: buffers }, transfer);
    } else {
      throw new Error(`Unknown procedural asset task: ${type}`);
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
