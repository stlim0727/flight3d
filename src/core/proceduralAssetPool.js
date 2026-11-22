import { generateEffectAtlasData } from '../effects/effectFlipbookData.js';
import { createCloudDensityData } from '../environment/cloudDensityData.js';
import { generateAllTerrainTextureBuffers } from '../environment/terrainTextureData.js';

let worker = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map();

function runSyncFallback(type, payload) {
  if (type === 'cloud-density') return createCloudDensityData(payload?.size);
  if (type === 'effect-atlas') return generateEffectAtlasData(payload?.kind);
  if (type === 'terrain-textures') return generateAllTerrainTextureBuffers();
  throw new Error(`Unknown procedural asset task: ${type}`);
}

function getWorker() {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./proceduralAssets.worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { id, ok, result, error } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Worker task failed'));
    });
    worker.addEventListener('error', (event) => {
      workerFailed = true;
      const err = new Error(event?.message || 'Procedural asset worker failed');
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
      worker?.terminate?.();
      worker = null;
    });
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/**
 * Offload heavy procedural texture/voxel generation onto a module Web Worker,
 * falling back to synchronous execution when Workers are unavailable (e.g. Node).
 */
export function requestProceduralAsset(type, payload = {}) {
  const activeWorker = getWorker();
  if (!activeWorker) {
    return Promise.resolve().then(() => runSyncFallback(type, payload));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage({ id, type, payload });
  }).catch(() => runSyncFallback(type, payload));
}
