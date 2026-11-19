import * as THREE from 'three';
import { applyFarSunShadow } from './FarSunShadow.js';

// Illustration only: these colours do not claim surveyed land cover. The DSM,
// coastline, pavement and collision sampler remain the source of geometry.
function noise(x, z, period = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const hash = (a, b) => {
    if (period) {
      a = ((a % period) + period) % period;
      b = ((b % period) + period) % period;
    }
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), sx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz);
}

/** World-sized colour variation reveals hills without changing their height. */
export function colourIncheonGround(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colours = new Float32Array(position.count * 3);
  const grass = new THREE.Color(0x65734b);
  const dryGrass = new THREE.Color(0x918263);
  const woodland = new THREE.Color(0x304d35);
  const rock = new THREE.Color(0x77786b);
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), y = position.getY(i);
    const broad = noise(x / 430, z / 430);
    const patches = noise(x / 95 + 17, z / 95 - 31);
    colour.copy(grass).lerp(dryGrass, broad * .65);
    // A gradual transition preserves flat airport grass and brings out the
    // actual surrounding ridges. No invented mountains or building footprints.
    const hills = THREE.MathUtils.smoothstep(y, 14, 65);
    colour.lerp(woodland, hills * (.65 + patches * .35));
    const slope = 1 - normal.getY(i);
    colour.lerp(rock, THREE.MathUtils.smoothstep(slope, .12, .4) * .55);
    colour.multiplyScalar(.8 + patches * .25);
    colour.toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** A small seamless 128m tile: metre-scale grain plus larger grass clumps.
 * Mipmaps suppress distant shimmer; no per-frame generation or extra draw calls.
 */
export function createIncheonGroundTexture(worldSize = 12000) {
  const fallback = () => {
    const data = new Uint8Array([200, 205, 195, 255]);
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(worldSize / 128, worldSize / 128);
    texture.needsUpdate = true;
    return texture;
  };
  if (typeof document === 'undefined' || !document?.createElement) {
    return fallback();
  }
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext?.('2d');
  const pixels = context?.createImageData?.(size, size);
  if (!pixels?.data) {
    return fallback();
  }
  // Wrap each noise lattice, so every mip level repeats without a seam.
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const clumps = noise(x / size * 8, z / size * 8, 8);
    const blades = noise(x / size * 32, z / size * 32, 32);
    const grain = noise(x / size * 128, z / size * 128, 128);
    const value = Math.round(199 + clumps * 25 + blades * 20 + grain * 11);
    const i = (z * size + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(worldSize / 128, worldSize / 128);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Surface material for Incheon terrain.
 * Supports satellite orthoimagery draping across the 12 km area when available,
 * with graceful fallback to procedural ground noise and vertex colours.
 * Close-up procedural micro-grain prevents satellite pixelation at low altitudes.
 */
export function incheonSurfaceMaterial({
  map = null,
  satelliteTexture = null,
  alphaMap = null,
  roughness = 0.94,
  metalness = 0,
  detailDistance = 2200,
  applyShadows = true,
  worldSize = 12000,
} = {}) {
  const activeSatellite = satelliteTexture ?? (map && map.wrapS === THREE.ClampToEdgeWrapping ? map : null);
  const isSatellite = Boolean(activeSatellite);
  const baseMap = activeSatellite ?? map ?? createIncheonGroundTexture(worldSize);

  const material = new THREE.MeshStandardMaterial({
    map: baseMap,
    alphaMap: alphaMap ?? null,
    alphaTest: alphaMap ? 0.5 : 0,
    color: 0xffffff,
    vertexColors: !isSatellite,
    roughness,
    metalness,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vIncheonPosition;
        varying vec3 vIncheonNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vIncheonPosition = position;
        vIncheonNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vIncheonPosition;
        varying vec3 vIncheonNormal;
        float incheonHash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float incheonNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(incheonHash(i), incheonHash(i + vec3(1, 0, 0)), f.x),
                         mix(incheonHash(i + vec3(0, 1, 0)), incheonHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(incheonHash(i + vec3(0, 0, 1)), incheonHash(i + vec3(1, 0, 1)), f.x),
                         mix(incheonHash(i + vec3(0, 1, 1)), incheonHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float incheonDist = length(vViewPosition);
        float incheonFade = 1.0 - smoothstep(150.0, ${Number(detailDistance).toFixed(1)}, incheonDist);
        if (incheonFade > 0.0) {
          float microGrain = incheonNoise(vIncheonPosition * 0.7);
          float grassClump = incheonNoise(vIncheonPosition * 0.12);
          float slope = 1.0 - abs(normalize(vIncheonNormal).y);
          float rockFactor = smoothstep(0.18, 0.55, slope);
          vec3 groundTint = mix(vec3(0.92, 0.98, 0.88), vec3(1.05, 0.98, 0.86), rockFactor);
          float detailMod = 0.85 + 0.22 * microGrain + 0.14 * grassClump;
          diffuseColor.rgb *= mix(vec3(1.0), groundTint * detailMod, incheonFade);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float incheonBumpDist = length(vViewPosition);
        float incheonBumpFade = 1.0 - smoothstep(150.0, ${Number(detailDistance).toFixed(1)}, incheonBumpDist);
        if (incheonBumpFade > 0.0) {
          float relief = incheonNoise(vIncheonPosition * 0.7) * 0.08 * incheonBumpFade;
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          vec3 rx = cross(dpdy, normal), ry = cross(normal, dpdx);
          float det = dot(dpdx, rx);
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(relief) * rx + dFdy(relief) * ry));
        }`);
  };

  material.customProgramCacheKey = () => (isSatellite ? 'incheon-surface-satellite-v1' : 'incheon-surface-procedural-v1');
  return applyShadows ? applyFarSunShadow(material) : material;
}

/**
 * Configure and assign satellite texture to an existing Incheon ground material.
 */
export function applyIncheonSatelliteTexture(material, satelliteTexture) {
  if (!material || !satelliteTexture) return;
  satelliteTexture.colorSpace = THREE.SRGBColorSpace;
  satelliteTexture.wrapS = THREE.ClampToEdgeWrapping;
  satelliteTexture.wrapT = THREE.ClampToEdgeWrapping;
  satelliteTexture.anisotropy = 4;
  material.map = satelliteTexture;
  material.vertexColors = false;
  material.color.setHex(0xffffff);
  material.needsUpdate = true;
}

/**
 * Asynchronously load satellite texture if available; returns null on 404/offline.
 */
export async function loadIncheonSatelliteTexture(base, loader = new THREE.TextureLoader()) {
  try {
    const url = `${String(base).replace(/\/?$/, '/')}satellite.jpg`;
    const texture = await loader.loadAsync(url);
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 4;
      return texture;
    }
  } catch {
    // Offline resilience: satellite image is optional.
  }
  return null;
}

