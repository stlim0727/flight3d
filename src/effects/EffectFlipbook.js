// SPDX-License-Identifier: MIT
// See public/licenses/effect-atlas-MIT.txt (generator and generated atlases).
import * as THREE from 'three';

export const FLIPBOOK_GRID = 4;
export const FLIPBOOK_FRAMES = 16;
export const FLIPBOOK_TILE = 64;

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const hash = (a, b) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const sx = x - ix, sy = y - iy;
  const fx = sx * sx * (3 - 2 * sx), fy = sy * sy * (3 - 2 * sy);
  const bottom = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const top = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return bottom * (1 - fy) + top * fy;
}

// Original, deterministic code-generated assets. No downloaded image dependency.
// Transparent gutters and half-texel UV insets isolate adjacent frames.
export function createEffectAtlas(kind) {
  if (!['fire', 'smoke', 'water', 'tire'].includes(kind)) throw new Error(`Unknown effect: ${kind}`);
  const size = FLIPBOOK_GRID * FLIPBOOK_TILE;
  const data = new Uint8Array(size * size * 4);
  for (let frame = 0; frame < FLIPBOOK_FRAMES; frame++) {
    const age = frame / (FLIPBOOK_FRAMES - 1);
    for (let y = 0; y < FLIPBOOK_TILE; y++) {
      for (let x = 0; x < FLIPBOOK_TILE; x++) {
        const u = (x + 0.5) / FLIPBOOK_TILE * 2 - 1;
        const v = (y + 0.5) / FLIPBOOK_TILE * 2 - 1;
        let density = 0;
        for (let lobe = 0; lobe < 12; lobe++) {
          const angle = lobe * 2.39996 + age * (lobe % 2 ? 0.45 : -0.35);
          const spread = (0.14 + age * 0.23) * (0.5 + (lobe % 4) / 4);
          const cx = Math.cos(angle) * spread;
          const cy = Math.sin(angle) * spread + (kind === 'fire' ? age * 0.12 : 0);
          const radius = 0.19 + (lobe % 3) * 0.045 + age * 0.06;
          const distance = ((u - cx) ** 2 + (v - cy) ** 2) / radius ** 2;
          density += Math.exp(-distance * 2) * 0.36;
        }
        const turbulence = 0.35 + 0.85 * noise(u * 9 + age, v * 9 - age * 2)
          + 0.25 * noise(u * 21 - age, v * 21 + age);
        const edge = Math.max(0, Math.min(1, (0.92 - Math.hypot(u, v)) * 8));
        let alpha = Math.min(1, density * turbulence) * edge;
        if (kind === 'water') alpha *= 0.5 + 0.5 * noise(u * 35 + age, v * 35 - age);
        const shade = Math.min(1, density);
        const rgb = kind === 'fire' ? [255, 75 + shade * 160 * (1 - age * 0.5), 12 + shade * 65]
          : kind === 'smoke' ? [36 + shade * 25, 38 + shade * 25, 42 + shade * 25]
            : kind === 'water' ? [170 + shade * 65, 205 + shade * 40, 235 + shade * 20]
              : [185 + shade * 55, 190 + shade * 55, 200 + shade * 50];
        const px = (frame % FLIPBOOK_GRID) * FLIPBOOK_TILE + x;
        const py = Math.floor(frame / FLIPBOOK_GRID) * FLIPBOOK_TILE + y;
        const index = (py * size + px) * 4;
        data.set([...rgb.map(Math.round), Math.round(alpha * 255)], index);
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = `effect-flipbook-${kind}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
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
