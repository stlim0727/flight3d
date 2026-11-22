// SPDX-License-Identifier: MIT
// See public/licenses/effect-atlas-MIT.txt (generator and generated atlases).

export const FLIPBOOK_GRID = 4;
export const FLIPBOOK_FRAMES = 16;
export const FLIPBOOK_TILE = 64;
export const FLIPBOOK_SIZE = FLIPBOOK_GRID * FLIPBOOK_TILE;

const EFFECT_KINDS = new Set(['fire', 'smoke', 'water', 'tire']);
const atlasBufferCache = new Map();

function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const hash = (a, b) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const sx = x - ix;
  const sy = y - iy;
  const fx = sx * sx * (3 - 2 * sx);
  const fy = sy * sy * (3 - 2 * sy);
  const bottom = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const top = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return bottom * (1 - fy) + top * fy;
}

/**
 * Pure CPU generator for flipbook RGBA bytes (no Three.js / DOM dependency).
 * Cached by effect kind so shared atlases are generated at most once per thread.
 */
export function generateEffectAtlasData(kind, { useCache = true } = {}) {
  if (!EFFECT_KINDS.has(kind)) throw new Error(`Unknown effect: ${kind}`);
  if (useCache && atlasBufferCache.has(kind)) {
    return atlasBufferCache.get(kind);
  }
  const size = FLIPBOOK_SIZE;
  const data = new Uint8Array(size * size * 4);
  const isFire = kind === 'fire';
  const isSmoke = kind === 'smoke';
  const isWater = kind === 'water';

  const lobeCx = new Float64Array(12);
  const lobeCy = new Float64Array(12);
  const lobeR2 = new Float64Array(12);

  for (let frame = 0; frame < FLIPBOOK_FRAMES; frame++) {
    const age = frame / (FLIPBOOK_FRAMES - 1);
    const fireAgeOffset = isFire ? age * 0.12 : 0;
    for (let lobe = 0; lobe < 12; lobe++) {
      const angle = lobe * 2.39996 + age * (lobe % 2 ? 0.45 : -0.35);
      const spread = (0.14 + age * 0.23) * (0.5 + (lobe % 4) / 4);
      lobeCx[lobe] = Math.cos(angle) * spread;
      lobeCy[lobe] = Math.sin(angle) * spread + fireAgeOffset;
      const radius = 0.19 + (lobe % 3) * 0.045 + age * 0.06;
      lobeR2[lobe] = radius ** 2;
    }

    const tileOffsetX = (frame % FLIPBOOK_GRID) * FLIPBOOK_TILE;
    const tileOffsetY = Math.floor(frame / FLIPBOOK_GRID) * FLIPBOOK_TILE;

    for (let y = 0; y < FLIPBOOK_TILE; y++) {
      const v = (y + 0.5) / FLIPBOOK_TILE * 2 - 1;
      const py = tileOffsetY + y;
      for (let x = 0; x < FLIPBOOK_TILE; x++) {
        const u = (x + 0.5) / FLIPBOOK_TILE * 2 - 1;
        let density = 0;
        for (let lobe = 0; lobe < 12; lobe++) {
          const du = u - lobeCx[lobe];
          const dv = v - lobeCy[lobe];
          const distance = (du * du + dv * dv) / lobeR2[lobe];
          density += Math.exp(-distance * 2) * 0.36;
        }
        const turbulence = 0.35 + 0.85 * noise(u * 9 + age, v * 9 - age * 2)
          + 0.25 * noise(u * 21 - age, v * 21 + age);
        const edge = Math.max(0, Math.min(1, (0.92 - Math.hypot(u, v)) * 8));
        let alpha = Math.min(1, density * turbulence) * edge;
        if (isWater) alpha *= 0.5 + 0.5 * noise(u * 35 + age, v * 35 - age);
        const shade = Math.min(1, density);
        let r, g, b;
        if (isFire) {
          r = 255;
          g = 75 + shade * 160 * (1 - age * 0.5);
          b = 12 + shade * 65;
        } else if (isSmoke) {
          r = 36 + shade * 25;
          g = 38 + shade * 25;
          b = 42 + shade * 25;
        } else if (isWater) {
          r = 170 + shade * 65;
          g = 205 + shade * 40;
          b = 235 + shade * 20;
        } else {
          r = 185 + shade * 55;
          g = 190 + shade * 55;
          b = 200 + shade * 50;
        }
        const px = tileOffsetX + x;
        const index = (py * size + px) * 4;
        data[index] = Math.round(r);
        data[index + 1] = Math.round(g);
        data[index + 2] = Math.round(b);
        data[index + 3] = Math.round(alpha * 255);
      }
    }
  }
  if (useCache) atlasBufferCache.set(kind, data);
  return data;
}
