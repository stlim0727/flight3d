// SPDX-License-Identifier: MIT
// See public/licenses/effect-atlas-MIT.txt (generator and generated atlases).
import * as THREE from 'three';
import {
  FLIPBOOK_FRAMES,
  FLIPBOOK_SIZE,
  generateEffectAtlasData,
} from './effectFlipbookData.js';

export function effectAtlasFromData(kind, data) {
  const texture = new THREE.DataTexture(data, FLIPBOOK_SIZE, FLIPBOOK_SIZE);
  texture.name = `effect-flipbook-${kind}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Original, deterministic code-generated assets. No downloaded image dependency.
// Transparent gutters and half-texel UV insets isolate adjacent frames.
export function createEffectAtlas(kind) {
  return effectAtlasFromData(kind, generateEffectAtlasData(kind));
}

export function flipbookFrame(life, maxLife, speed = 1) {
  if (!(maxLife > 0)) return FLIPBOOK_FRAMES - 1;
  return Math.max(0, Math.min(FLIPBOOK_FRAMES - 1, Math.floor(life / maxLife * speed * FLIPBOOK_FRAMES)));
}

let variationIndex = 0;

export function createFlipbookMaterial(map, options = {}) {
  const material = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, ...options });
  const frame = { value: 0 };
  // Keep visual variation out of the simulation's random stream.
  const variation = (++variationIndex * 0.61803398875) % 1;
  material.userData.flipbook = { frame, speed: 0.85 + variation * 0.3 };
  material.rotation = variation * Math.PI * 2;
  material.onBeforeCompile = shader => {
    shader.uniforms.effectFrame = frame;
    shader.fragmentShader = 'uniform float effectFrame;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 tile = vec2(mod(effectFrame, 4.0), floor(effectFrame / 4.0));
      vec2 atlasUv = (tile + (vec2(0.5) + vMapUv * 63.0) / 64.0) / 4.0;
      diffuseColor *= texture2D(map, atlasUv);
    `);
  };
  material.customProgramCacheKey = () => 'effect-flipbook-v1';
  return material;
}

export function updateFlipbook(particle) {
  const animation = particle.sprite.material.userData.flipbook;
  if (animation) animation.frame.value = flipbookFrame(particle.life, particle.maxLife, animation.speed);
}
