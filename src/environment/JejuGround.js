import * as THREE from 'three';
import { applyFarSunShadow } from './FarSunShadow.js';
import { createIncheonGroundTexture, configureIncheonSatelliteTexture } from './IncheonGround.js';

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
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx),
    sz
  );
}

/**
 * Procedural land cover colour assignment for Jeju Island.
 * Colors Jeju's volcanic terrain according to elevation zones:
 * - Coastal basalt shores & beaches (0 - 8m)
 * - Manicured airport airfield grass (36m)
 * - Gotjawal lowland forests & mandarin farmland (65 - 350m)
 * - Mid-altitude evergreen Hallasan slopes (350 - 1100m)
 * - Subalpine volcanic basalt scree & oreum (1100 - 1600m)
 * - Hallasan summit & Baekrokdam crater peak (1600 - 1947m)
 */
export function colourJejuGround(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colours = new Float32Array(position.count * 3);

  const grass = new THREE.Color(0x5b7541);
  const dryGrass = new THREE.Color(0x768752);
  const lowland = new THREE.Color(0x385428);
  const woodland = new THREE.Color(0x20351b);
  const basalt = new THREE.Color(0x363432);
  const peakRock = new THREE.Color(0x56534f);
  const coast = new THREE.Color(0x5e5a50);
  const underwater = new THREE.Color(0x152229);
  const colour = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);

    const broad = noise(x / 650, z / 650);
    const patches = noise(x / 140 + 23, z / 140 - 47);

    if (y <= 0) {
      colour.copy(underwater);
    } else if (y < 8) {
      const t = y / 8;
      colour.copy(coast).lerp(grass, t * 0.7);
    } else if (y < 65) {
      // Airport plateau & coastal lowlands
      colour.copy(grass).lerp(dryGrass, broad * 0.6);
    } else if (y < 350) {
      // Gotjawal forest & farmland patchwork
      const t = (y - 65) / 285;
      colour.copy(grass).lerp(lowland, t * (0.7 + broad * 0.3));
    } else if (y < 1100) {
      // Dense evergreen & pine woodland on Hallasan slopes
      const t = (y - 350) / 750;
      colour.copy(lowland).lerp(woodland, t * (0.8 + patches * 0.2));
    } else if (y < 1600) {
      // Subalpine volcanic basalt scree
      const t = (y - 1100) / 500;
      colour.copy(woodland).lerp(basalt, t);
    } else {
      // Summit crater rim & Baekrokdam
      const t = Math.min(1, (y - 1600) / 347);
      colour.copy(basalt).lerp(peakRock, t);
    }

    // Exposed basalt cliffs on steep slopes
    if (normal) {
      const slope = 1 - Math.abs(normal.getY(i));
      const rockFactor = THREE.MathUtils.smoothstep(slope, 0.16, 0.48);
      if (rockFactor > 0 && y > 0) {
        colour.lerp(basalt, rockFactor * 0.75);
      }
    }

    // Micro-contrast variation across patches
    colour.multiplyScalar(0.85 + patches * 0.25);
    colour.toArray(colours, i * 3);
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/**
 * Surface material for Jeju terrain with procedural micro-grain and optional satellite texture.
 */
export function jejuSurfaceMaterial({
  map = null,
  satelliteTexture = null,
  alphaMap = null,
  roughness = 0.92,
  metalness = 0.04,
  detailDistance = 2500,
  applyShadows = true,
  worldSize = 80000,
} = {}) {
  const activeSatellite = satelliteTexture ?? (map && map.wrapS === THREE.ClampToEdgeWrapping ? map : null);
  const isSatellite = Boolean(activeSatellite);
  if (activeSatellite) {
    configureIncheonSatelliteTexture(activeSatellite);
  }
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
        varying vec3 vJejuPosition;
        varying vec3 vJejuNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vJejuPosition = position;
        vJejuNormal = normal;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vJejuPosition;
        varying vec3 vJejuNormal;
        float jejuHash(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float jejuNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(jejuHash(i), jejuHash(i + vec3(1, 0, 0)), f.x),
                         mix(jejuHash(i + vec3(0, 1, 0)), jejuHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(jejuHash(i + vec3(0, 0, 1)), jejuHash(i + vec3(1, 0, 1)), f.x),
                         mix(jejuHash(i + vec3(0, 1, 1)), jejuHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float jejuDist = length(vViewPosition);
        float jejuFade = 1.0 - smoothstep(150.0, ${Number(detailDistance).toFixed(1)}, jejuDist);
        if (jejuFade > 0.0) {
          float microGrain = jejuNoise(vJejuPosition * 0.6);
          float grassClump = jejuNoise(vJejuPosition * 0.1);
          float slope = 1.0 - abs(normalize(vJejuNormal).y);
          float rockFactor = smoothstep(0.16, 0.5, slope);
          vec3 groundTint = mix(vec3(0.94, 0.99, 0.91), vec3(1.02, 0.97, 0.88), rockFactor);
          float detailMod = 0.86 + 0.20 * microGrain + 0.12 * grassClump;
          diffuseColor.rgb *= mix(vec3(1.0), groundTint * detailMod, jejuFade);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float jejuBumpDist = length(vViewPosition);
        float jejuBumpFade = 1.0 - smoothstep(150.0, ${Number(detailDistance).toFixed(1)}, jejuBumpDist);
        if (jejuBumpFade > 0.0) {
          float relief = jejuNoise(vJejuPosition * 0.6) * 0.07 * jejuBumpFade;
          vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
          vec3 rx = cross(dpdy, normal), ry = cross(normal, dpdx);
          float det = dot(dpdx, rx);
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(relief) * rx + dFdy(relief) * ry));
        }`);
  };

  material.customProgramCacheKey = () => (isSatellite ? 'jeju-surface-satellite-v1' : 'jeju-surface-procedural-v1');
  return applyShadows ? applyFarSunShadow(material) : material;
}
