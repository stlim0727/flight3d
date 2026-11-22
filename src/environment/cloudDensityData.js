export const CLOUD_DENSITY_SIZE = 48;
export const CLOUD_VARIANTS = 4;

function smoothstep(x, min, max) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

/**
 * Pure CPU 3D cloud density generator (no Three.js or DOM dependencies).
 * Each variant has two empty Z slices so linear filtering cannot bleed across volumes.
 */
export function createCloudDensityData(size = CLOUD_DENSITY_SIZE) {
  const hash = (x, y, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const lattice = new Float32Array(32 ** 3);
  for (let z = 0; z < 32; z++) {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) lattice[(z * 32 + y) * 32 + x] = hash(x, y, z);
    }
  }
  const smooth = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const value = (x, y, z) => lattice[((z & 31) * 32 + (y & 31)) * 32 + (x & 31)];
  const noise = (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const fz = smooth(z - iz);
    return lerp(
      lerp(lerp(value(ix, iy, iz), value(ix + 1, iy, iz), fx), lerp(value(ix, iy + 1, iz), value(ix + 1, iy + 1, iz), fx), fy),
      lerp(lerp(value(ix, iy, iz + 1), value(ix + 1, iy, iz + 1), fx), lerp(value(ix, iy + 1, iz + 1), value(ix + 1, iy + 1, iz + 1), fx), fy),
      fz
    );
  };
  const stride = size + 2;
  const data = new Uint8Array(size * size * stride * CLOUD_VARIANTS);
  for (let variant = 0; variant < CLOUD_VARIANTS; variant++) {
    const lobes = [
      [-0.19, -0.14, 0, 0.25, 0.27, 0.28],
      [0.02 + Math.sin(variant * 2) * 0.08, -0.015, 0.015, 0.26, 0.34 + variant * 0.03, 0.27],
      [0.23, -0.15, -0.02, 0.23, 0.25, 0.24],
      [-0.06, -0.14, 0.23, 0.27, 0.26, 0.21],
      [0.04, -0.16, -0.24, 0.26, 0.25, 0.20],
    ];
    for (let z = 1; z < size - 1; z++) {
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const px = x / (size - 1) - 0.5;
          const py = y / (size - 1) - 0.5;
          const pz = z / (size - 1) - 0.5;
          let shape = -10;
          for (const [cx, cy, cz, rx, ry, rz] of lobes) {
            shape = Math.max(shape, 1 - ((px - cx) / rx) ** 2 - ((py - cy) / ry) ** 2 - ((pz - cz) / rz) ** 2);
          }
          const offset = variant * 7.71;
          const billows = noise(px * 6 + offset, py * 6 + offset, pz * 6 + offset);
          const detail = noise(px * 19 + offset, py * 19 + offset, pz * 19 + offset);
          const body = shape - 0.40 + billows * 0.85 - (1 - detail) * 0.42;
          const base = smoothstep(py, -0.43, -0.28);
          const boundary = 1 - smoothstep(Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)), 0.44, 0.48);
          const density = smoothstep(body, 0, 0.28) * base * boundary;
          data[((variant * stride + z + 1) * size + y) * size + x] = Math.round(density * 255);
        }
      }
    }
  }
  return data;
}
