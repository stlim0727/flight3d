import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './shipAssetManifest.json' with { type: 'json' };

export { manifest as shipAssetManifest };

export function shipBounds(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

export function createShipFallback(type) {
  const { min, max } = manifest[type].bounds;
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(max[0] - min[0], 2 - min[1], max[2] - min[2]),
    new THREE.MeshStandardMaterial({ color: type === 'speedboat' ? 0x367e91 : 0x273e48 })
  );
  hull.position.set((min[0] + max[0]) / 2, (min[1] + 2) / 2, (min[2] + max[2]) / 2);
  group.add(hull);
  return group;
}

// Metres, +Y up, -Z bow, waterline-centred origin. Clones share GPU resources.
export function createShipAssetLoader() {
  const loader = new GLTFLoader(),
    cache = new Map();
  return (type) => {
    if (!cache.has(type)) {
      const base = import.meta.env?.BASE_URL || '/';
      cache.set(
        type,
        loader.loadAsync(`${base}${manifest[type].url}`).then((gltf) => {
          const bounds = shipBounds(gltf.scene);
          if (
            bounds.isEmpty() ||
            ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
          ) {
            throw new Error(`Invalid ${type} bounds`);
          }
          gltf.scene.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          return gltf.scene;
        })
      );
    }
    return cache.get(type).then((scene) => scene.clone(true));
  };
}

export function createWakeTexture() {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = y / (size - 1),
        across = Math.abs((2 * x) / (size - 1) - 1),
        spread = 0.12 + 0.78 * t;
      const edge = Math.exp(-(((across - spread) / 0.085) ** 2));
      const churn = Math.exp(-((across / (0.12 + 0.22 * t)) ** 2)) * 0.6;
      const grain = 0.65 + 0.35 * Math.sin(x * 12.9898 + y * 78.233) ** 2;
      const alpha = Math.min(1, (edge + churn) * grain * Math.sin(Math.PI * t) ** 0.6);
      data.set([255, 255, 255, Math.round(255 * alpha)], (y * size + x) * 4);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
