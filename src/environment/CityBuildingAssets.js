import * as THREE from 'three';
import { applyFarSunShadow } from './FarSunShadow.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original 2 x 2 atlas: three facades and a shared rooftop. Kept in source so
// the browser receives no separately licensed texture or model download.
const TILE = 128;
const SIZE = TILE * 2;

function makeAtlas() {
  const color = new Uint8Array(SIZE * SIZE * 4);
  const windows = new Uint8Array(SIZE * SIZE * 4);
  const walls = [
    [60, 82, 105], // glazed office
    [173, 166, 149], // residential stone
    [110, 122, 131], // commercial cladding
    [86, 91, 96] // rooftop membrane
  ];
  for (let tile = 0; tile < 4; tile++) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const windowX = x % 24;
        const windowY = y % 24;
        const isWindow = tile !== 3 && windowX >= 4 && windowX < 19 && windowY >= 5 && windowY < 19;
        const isFrame = tile !== 3 && (windowX < 2 || windowY < 2);
        const isRooftopUnit = tile === 3 && x > 37 && x < 91 && y > 38 && y < 87;
        const lit = isWindow && ((Math.floor(x / 24) * 7 + Math.floor(y / 24) * 11 + tile * 13) % 5 < 2);
        const wall = walls[tile];
        const px = (x + (tile % 2) * TILE + (y + Math.floor(tile / 2) * TILE) * SIZE) * 4;
        const rgb = isRooftopUnit ? [121, 128, 132]
          : isWindow ? (lit ? [119, 145, 163] : [38, 58, 75])
            : isFrame ? wall.map(v => Math.min(255, v + 24)) : wall;
        color.set([...rgb, 255], px);
        windows.set(lit ? [80, 68, 44, 255] : [0, 0, 0, 255], px);
      }
    }
  }
  const makeTexture = (data, colorSpace) => {
    const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return {
    map: makeTexture(color, THREE.SRGBColorSpace),
    emissiveMap: makeTexture(windows, THREE.SRGBColorSpace)
  };
}

function box(width, height, depth, bottom, facadeTile) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, bottom + height / 2, 0);
  const uv = geometry.getAttribute('uv');
  for (let face = 0; face < 6; face++) {
    const tile = face === 2 || face === 3 ? 3 : facadeTile;
    const tx = tile % 2;
    const ty = Math.floor(tile / 2);
    for (let corner = 0; corner < 4; corner++) {
      const index = face * 4 + corner;
      uv.setXY(index, (tx + 0.01 + uv.getX(index) * 0.98) / 2,
        (ty + 0.01 + uv.getY(index) * 0.98) / 2);
    }
  }
  return geometry;
}

// Keep window bays close to human scale even when a normalized archetype is
// instanced as a 25 m block or a 150 m tower. Rooftops retain their original UVs.
function cityFacadeUvShader(shader) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    varying vec3 vCityMetricPosition;
    varying vec3 vCityFaceNormal;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 cityScale = vec3(1.0);
    #ifdef USE_INSTANCING
      cityScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    #endif
    vCityMetricPosition = position * cityScale;
    vCityFaceNormal = normal;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vCityMetricPosition;
    varying vec3 vCityFaceNormal;
    vec2 cityFacadeUv(vec2 atlasUv) {
      if (abs(vCityFaceNormal.y) > 0.5) return atlasUv;
      vec2 tile = floor(atlasUv * 2.0);
      vec2 metric = vec2(abs(vCityFaceNormal.z) > 0.5 ? vCityMetricPosition.x : vCityMetricPosition.z, vCityMetricPosition.y);
      // The atlas has 5 1/3 bays per tile: approximately 3.75 m wide,
      // 3 m floor-to-floor. The gutter avoids filtering into adjacent tiles.
      return (tile + 0.01 + fract(metric / vec2(20.0, 16.0)) * 0.98) * 0.5;
    }`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
    THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'cityFacadeUv(vMapUv)'));
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
    THREE.ShaderChunk.emissivemap_fragment.replaceAll('vEmissiveMapUv', 'cityFacadeUv(vEmissiveMapUv)'));
}

function offsetBox(width, height, depth, bottom, tile, x = 0, z = 0) {
  return box(width, height, depth, bottom, tile).translate(x, 0, z);
}

// All parts stay inside the original 1 x 1 footprint and 0..1 height so visual
// detail never silently changes collision envelopes or a demo's clear corridor.
function roofRim(width, depth, bottom, height = 0.025) {
  const edge = 0.025;
  return [
    offsetBox(width, height, edge, bottom, 3, 0, (depth - edge) / 2),
    offsetBox(width, height, edge, bottom, 3, 0, -(depth - edge) / 2),
    offsetBox(edge, height, depth - edge * 2, bottom, 3, (width - edge) / 2),
    offsetBox(edge, height, depth - edge * 2, bottom, 3, -(width - edge) / 2),
  ];
}

export function createCityBuildingAssets() {
  const atlas = makeAtlas();
  const nearMaterial = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.65,
    metalness: 0.15
  });
  nearMaterial.onBeforeCompile = cityFacadeUvShader;
  nearMaterial.customProgramCacheKey = () => 'city-metric-facade-v1';
  const farMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8, metalness: 0.1 });
  const parts = [
    // Office: street podium, stepped glazed tower, crown and service enclosure.
    [box(1, 0.10, 1, 0, 2), box(0.84, 0.73, 0.84, 0.10, 0),
      box(0.70, 0.12, 0.70, 0.83, 0), ...roofRim(0.70, 0.70, 0.95),
      offsetBox(0.22, 0.05, 0.18, 0.95, 3, -0.12, 0.08),
      offsetBox(0.14, 0.035, 0.24, 0.95, 3, 0.16, -0.10),
      // Corner fins catch the light without a material/draw-call per strip.
      ...[-1, 1].flatMap(x => [-1, 1].map(z => offsetBox(0.035, 0.73, 0.035, 0.10, 2, x * 0.425, z * 0.425)))],
    // Residential: recessed upper mass with full-height end piers and rooftop plant.
    [box(1, 0.08, 1, 0, 2), box(0.88, 0.84, 0.88, 0.08, 1),
      ...[-1, 1].map(x => offsetBox(0.06, 0.84, 1, 0.08, 1, x * 0.47)),
      ...roofRim(0.88, 0.88, 0.92, 0.03),
      box(0.35, 0.08, 0.30, 0.92, 3),
      offsetBox(0.18, 0.045, 0.16, 0.92, 3, -0.24, 0.20)],
    // Commercial: broad podium, setback roof terrace and paired ventilation units.
    [box(1, 0.16, 1, 0, 2), box(0.90, 0.64, 0.90, 0.16, 2),
      ...roofRim(0.90, 0.90, 0.80), box(0.60, 0.16, 0.65, 0.80, 0),
      ...roofRim(0.60, 0.65, 0.96),
      ...[-1, 1].map(x => offsetBox(0.16, 0.04, 0.22, 0.96, 3, x * 0.16)),
      ...[-1, 1].map(x => offsetBox(0.035, 0.64, 0.92, 0.16, 1, x * 0.45))]
  ];
  const nearGeometries = parts.map(pieces => {
    const geometry = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    return geometry;
  });
  const farGeometry = box(1, 1, 1, 0, 0);
  applyFarSunShadow(nearMaterial);
  applyFarSunShadow(farMaterial);
  return { atlas, nearMaterial, farMaterial, nearGeometries, farGeometry };
}

export function cityWindowIntensity(hour) {
  const daylight = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
  return 0.75 * (1 - THREE.MathUtils.smoothstep(daylight, 0.03, 0.35));
}
