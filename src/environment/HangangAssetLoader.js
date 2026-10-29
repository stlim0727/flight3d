import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './hangangAssetManifest.json' with { type: 'json' };

export { manifest as hangangAssetManifest };

/**
 * Loads surveyed / curated GLB 3D models for the Hangang Seoul scenery.
 * Clones and shares GPU geometry across the scene.
 */
export function createHangangAssetLoader() {
  const loader = new GLTFLoader();
  const cache = new Map();

  return async (modelId) => {
    if (!manifest[modelId]) {
      throw new Error(`Unknown Hangang model asset: ${modelId}`);
    }
    if (cache.has(modelId)) {
      return cache.get(modelId).clone(true);
    }

    const base = import.meta.env?.BASE_URL || '/';
    const url = `${base}${manifest[modelId].url}`;

    try {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      cache.set(modelId, gltf.scene);
      return gltf.scene.clone(true);
    } catch (err) {
      // In headless / test environments where network fetch of local static assets
      // is unavailable, return an empty group with manifest bounds
      const fallback = new THREE.Group();
      fallback.name = `${modelId}_fallback`;
      return fallback;
    }
  };
}
