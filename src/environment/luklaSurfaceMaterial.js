import * as THREE from 'three';
import { applyFarSunShadow } from './FarSunShadow.js';

/** Render-only metre-scale detail; satellite UVs and measured heights stay intact. */
export function luklaSurfaceMaterial(map = null) {
  const material = new THREE.MeshStandardMaterial({
    map, color: map ? 0xffffff : 0x5a6358, roughness: 0.94,
    metalness: 0, side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vLuklaPosition;
      varying vec3 vLuklaNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLuklaPosition = position;
        vLuklaNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLuklaPosition;
      varying vec3 vLuklaNormal;
      float surfaceHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float surfaceNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(surfaceHash(i), surfaceHash(i+vec3(1,0,0)), f.x),
                       mix(surfaceHash(i+vec3(0,1,0)), surfaceHash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(surfaceHash(i+vec3(0,0,1)), surfaceHash(i+vec3(1,0,1)), f.x),
                       mix(surfaceHash(i+vec3(0,1,1)), surfaceHash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float detailDistance = length(vViewPosition);
        float detailFade = 1.0 - smoothstep(250.0, 2200.0, detailDistance);
        float rock = smoothstep(0.2, 0.65, 1.0 - abs(normalize(vLuklaNormal).y));
        float grain = 0.5, strata = 0.5, patches = 0.5;
        if (detailFade > 0.0) {
          grain = surfaceNoise(vLuklaPosition * 0.8);
          strata = surfaceNoise(vLuklaPosition * vec3(0.14, 1.5, 0.14));
          patches = surfaceNoise(vLuklaPosition * 0.06);
        }
        vec3 tint = mix(vec3(0.88, 0.98, 0.82), vec3(1.03, 0.94, 0.83), rock);
        diffuseColor.rgb *= mix(vec3(1.0), tint * (0.78 + 0.25 * grain + 0.18 * patches + 0.12 * strata * rock), detailFade);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Surface-gradient bump from world-space noise: no UV stretching on cliffs.
        float relief = (grain * 0.10 + strata * rock * 0.16) * detailFade;
        vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
        vec3 rx = cross(dpdy, normal), ry = cross(normal, dpdx);
        float det = dot(dpdx, rx);
        normal = normalize(abs(det) * normal - sign(det) * (dFdx(relief) * rx + dFdy(relief) * ry));`);
  };
  material.customProgramCacheKey = () => 'lukla-surface-v1';
  return applyFarSunShadow(material);
}
