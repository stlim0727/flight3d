import * as THREE from 'three';
import { requestProceduralAsset } from '../core/proceduralAssetPool.js';
import { generateAllTerrainTextureBuffers } from './terrainTextureData.js';

/**
 * Procedural PBR Texture Generator for Flight3D Terrain
 * Generates seamless, periodic, high-resolution PBR textures (Albedo, Normal, Roughness)
 * packed into RGBA DataTextures:
 * - Albedo in RGB, Roughness in Alpha
 * - Tangent-space Normal in RGB (128, 128, 255 = flat)
 *
 * Uses deterministic hashing and periodic lattice noise so textures tile 100% seamlessly
 * with zero boundary seams and zero network/external asset dependencies.
 */

const ALBEDO_KEYS = new Set(['grassMap', 'sandMap', 'rockMap', 'snowMap', 'runwayMap']);
const PLACEHOLDER_RGBA = {
  grassMap: [56, 102, 49, 232],
  sandMap: [204, 176, 130, 214],
  rockMap: [90, 84, 76, 200],
  snowMap: [232, 238, 247, 140],
  runwayMap: [51, 61, 54, 208],
};

function createDataTexture(data, w, h, isSRGB = true) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function texturesFromBuffers(buffers) {
  const textures = {};
  for (const [key, entry] of Object.entries(buffers)) {
    textures[key] = createDataTexture(entry.data, entry.width, entry.height, ALBEDO_KEYS.has(key));
  }
  return textures;
}

function createPlaceholderTextures() {
  const textures = {};
  for (const key of [
    'grassMap', 'grassNormal', 'sandMap', 'sandNormal', 'rockMap', 'rockNormal',
    'snowMap', 'snowNormal', 'runwayMap', 'runwayNormal', 'microNormal',
  ]) {
    const rgba = PLACEHOLDER_RGBA[key] ?? [128, 128, 255, 255];
    textures[key] = createDataTexture(new Uint8Array(rgba), 1, 1, ALBEDO_KEYS.has(key));
  }
  return textures;
}

function disposeTextureSet(textures) {
  if (!textures) return;
  Object.values(textures).forEach(tex => {
    if (tex && typeof tex.dispose === 'function') {
      tex.dispose();
    }
  });
}

let cachedTextures = null;
let placeholderTextures = null;
let pendingLoad = null;
let generation = 0;
const pendingCallbacks = new Set();

export class TerrainTextures {
  static getTextures(forceRegenerate = false) {
    if (cachedTextures && !forceRegenerate) {
      return cachedTextures;
    }
    if (forceRegenerate) {
      generation++;
      disposeTextureSet(cachedTextures);
      cachedTextures = null;
    }
    pendingCallbacks.clear();
    disposeTextureSet(placeholderTextures);
    placeholderTextures = null;
    pendingLoad = null;
    cachedTextures = texturesFromBuffers(generateAllTerrainTextureBuffers());
    return cachedTextures;
  }

  /**
   * Return cached textures immediately if built, or 1x1 neutral placeholders while
   * generating the full 512x512 / 256x256 PBR maps on a background Web Worker.
   */
  static getTexturesAsync(onReady) {
    if (cachedTextures) {
      return cachedTextures;
    }
    if (typeof onReady === 'function') {
      pendingCallbacks.add(onReady);
    }
    if (!placeholderTextures) {
      placeholderTextures = createPlaceholderTextures();
    }
    if (!pendingLoad) {
      const requestGen = generation;
      pendingLoad = requestProceduralAsset('terrain-textures')
        .then(buffers => {
          if (requestGen !== generation) return null;
          if (!cachedTextures) {
            cachedTextures = texturesFromBuffers(buffers);
          }
          const callbacks = [...pendingCallbacks];
          pendingCallbacks.clear();
          const stalePlaceholders = placeholderTextures;
          placeholderTextures = null;
          pendingLoad = null;
          // Callers rebind uniforms to the fresh DataTextures before disposing placeholders
          // so WebGL2 immutable texStorage2D textures are never mutated in place.
          for (const cb of callbacks) {
            cb(cachedTextures);
          }
          disposeTextureSet(stalePlaceholders);
          return cachedTextures;
        })
        .catch(() => {
          pendingLoad = null;
          pendingCallbacks.clear();
          return null;
        });
    }
    return placeholderTextures;
  }

  static dispose() {
    generation++;
    pendingLoad = null;
    pendingCallbacks.clear();
    disposeTextureSet(cachedTextures);
    cachedTextures = null;
    disposeTextureSet(placeholderTextures);
    placeholderTextures = null;
  }
}
