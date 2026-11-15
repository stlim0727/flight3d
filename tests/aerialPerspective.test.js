import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  AERIAL_GLSL, HAZE_HEIGHT_FALLOFF, installHeightFog, meanDensityRatio,
} from '../src/environment/AerialPerspective.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';

const density = y => Math.exp(-HAZE_HEIGHT_FALLOFF * Math.max(y, 0));
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.abs(expected),
  `${label}: ${actual} vs ${expected}`);

test('mean density along a sight line matches the integral in both directions', () => {
  for (const [eye, point] of [[0, 0], [30, 30.5], [3000, 0], [0, 3000], [1828, 400], [12000, 0], [-5, -20]]) {
    const steps = 20000;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += density(eye + (point - eye) * (i + 0.5) / steps);
    close(meanDensityRatio(eye, point) * density(eye), sum / steps, 1e-6, `eye ${eye} point ${point}`);
  }
  assert.ok(Number.isFinite(meanDensityRatio(400000, 0)), 'an eye far above the haze stays finite');
});

test('looking down from altitude meets more haze than the density at the eye implies', () => {
  // Stock fog applied the eye's density to the whole line: at 3,000 m that is about 30%
  // of the haze the line to sea level actually crosses.
  close(1 / meanDensityRatio(3000, 0), 0.305, 0.01, 'eye density over the mean to the ground');
  assert.equal(meanDensityRatio(500, 500), 1, 'a level line keeps the density at the eye');
  assert.ok(meanDensityRatio(0, 3000) < 1, 'looking up from the ground meets less');
});

test('fog chunks integrate the sight line and leave linear fog usable', () => {
  installHeightFog();
  installHeightFog(); // idempotent
  const { fog_vertex, fog_pars_vertex, fog_fragment, fog_pars_fragment } = THREE.ShaderChunk;
  assert.ok(fog_vertex.includes('vFogOffset = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;'));
  assert.ok(fog_pars_vertex.includes('varying vec3 vFogOffset;'));
  assert.ok(fog_pars_fragment.includes('float aerialMeanDensityRatio('));
  assert.ok(fog_fragment.includes('aerialMeanDensityRatio( cameraPosition.y, cameraPosition.y + vFogOffset.y )'));
  assert.ok(fog_fragment.includes('smoothstep( fogNear, fogFar, length( vFogOffset ) )'));
  for (const chunk of [fog_vertex, fog_pars_vertex, fog_fragment, fog_pars_fragment]) {
    assert.ok(!chunk.includes('vFogDepth'));
  }
  assert.ok(AERIAL_GLSL.includes('const float AERIAL_FALLOFF = 0.000680000000;'));
});

test('atmosphere installs the height fog and keeps scene fog density as the density at the eye', () => {
  const scene = new THREE.Scene();
  const sky = new SkyAtmosphere(scene);
  assert.ok(THREE.ShaderChunk.fog_fragment.includes('aerialMeanDensityRatio'));
  assert.equal(sky.heightFalloff, HAZE_HEIGHT_FALLOFF);
  const eye = new THREE.Vector3(0, 2000, 0);
  sky.setTimeOfDay(12, eye, eye);
  close(scene.fog.density, sky.baseDensity * density(2000), 1e-12, 'scene fog density at 2,000 m');
});

test('cloud volumes take the shared fog instead of their own altitude correction', () => {
  const { cloudLayer } = new SkyAtmosphere(new THREE.Scene());
  const { vertexShader, fragmentShader } = cloudLayer.material;
  assert.ok(vertexShader.includes('#include <fog_vertex>'));
  assert.ok(fragmentShader.includes('#include <fog_fragment>'));
  assert.ok(!vertexShader.includes('vFogDepth'));
});

test('sea haze goes on in display space, as three fog does on the land', () => {
  const { fragmentShader } = new WaterOcean(36000, 8).material;
  assert.ok(fragmentShader.indexOf('#include <colorspace_fragment>')
    < fragmentShader.indexOf('linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, fogFactor)'));
  assert.ok(!fragmentShader.includes('finalColor = mix(finalColor, uFogColor, fogFactor)'));
});
