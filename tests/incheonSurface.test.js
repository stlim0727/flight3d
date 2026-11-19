import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => noop,
    has: () => false,
  });
  globalThis.document = {
    createElement: () => ({ getContext: () => mockCtx, width: 0, height: 0 }),
  };
}

import {
  incheonSurfaceMaterial,
  createIncheonGroundTexture,
  applyIncheonSatelliteTexture,
  loadIncheonSatelliteTexture,
  configureIncheonSatelliteTexture,
} from '../src/environment/IncheonGround.js';

test('incheonSurfaceMaterial defaults to procedural ground with vertex colors', () => {
  const material = incheonSurfaceMaterial({ applyShadows: false });
  assert.ok(material instanceof THREE.MeshStandardMaterial);
  assert.equal(material.vertexColors, true);
  assert.equal(material.side, THREE.DoubleSide);
  assert.ok(material.map);
  assert.equal(material.customProgramCacheKey(), 'incheon-surface-procedural-v1');
});

test('configureIncheonSatelliteTexture normalizes raw caller textures', () => {
  const rawTex = new THREE.Texture();
  assert.equal(rawTex.colorSpace, THREE.NoColorSpace);

  configureIncheonSatelliteTexture(rawTex, 8);
  assert.equal(rawTex.colorSpace, THREE.SRGBColorSpace);
  assert.equal(rawTex.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(rawTex.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(rawTex.anisotropy, 8);
});

test('incheonSurfaceMaterial configures caller-supplied satellite texture upon creation', () => {
  const rawTex = new THREE.Texture();
  assert.equal(rawTex.colorSpace, THREE.NoColorSpace);

  const mask = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const material = incheonSurfaceMaterial({
    satelliteTexture: rawTex,
    alphaMap: mask,
    applyShadows: false,
  });

  assert.equal(material.map, rawTex);
  assert.equal(rawTex.colorSpace, THREE.SRGBColorSpace);
  assert.equal(rawTex.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(rawTex.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(material.vertexColors, false);
  assert.equal(material.color.getHex(), 0xffffff);
  assert.equal(material.alphaMap, mask);
  assert.equal(material.alphaTest, 0.5);
  assert.equal(material.customProgramCacheKey(), 'incheon-surface-satellite-v1');
});

test('applyIncheonSatelliteTexture updates an existing material cleanly', () => {
  const material = incheonSurfaceMaterial({ applyShadows: false });
  assert.equal(material.vertexColors, true);

  const satelliteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  applyIncheonSatelliteTexture(material, satelliteTex);

  assert.equal(material.map, satelliteTex);
  assert.equal(material.vertexColors, false);
  assert.equal(material.color.getHex(), 0xffffff);
  assert.equal(satelliteTex.colorSpace, THREE.SRGBColorSpace);
  assert.equal(satelliteTex.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(satelliteTex.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(satelliteTex.anisotropy, 4);
});

test('loadIncheonSatelliteTexture handles success and catches missing files without error', async () => {
  const mockTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const successLoader = {
    loadAsync: async url => {
      assert.ok(url.endsWith('/scenery/incheon/satellite.jpg'));
      return mockTexture;
    },
  };

  const loaded = await loadIncheonSatelliteTexture('/scenery/incheon', successLoader);
  assert.equal(loaded, mockTexture);
  assert.equal(loaded.colorSpace, THREE.SRGBColorSpace);
  assert.equal(loaded.wrapS, THREE.ClampToEdgeWrapping);

  const failingLoader = {
    loadAsync: async () => {
      throw new Error('404 Not Found');
    },
  };

  const fallback = await loadIncheonSatelliteTexture('/scenery/incheon', failingLoader);
  assert.equal(fallback, null);
});

test('incheonSurfaceMaterial onBeforeCompile injects micro-grain and slope relief shaders', () => {
  const material = incheonSurfaceMaterial({ applyShadows: false });
  const shader = {
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <normal_fragment_maps>\n}',
  };

  material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vIncheonPosition'));
  assert.ok(shader.vertexShader.includes('vIncheonNormal'));
  assert.ok(shader.fragmentShader.includes('incheonNoise'));
  assert.ok(shader.fragmentShader.includes('incheonFade'));
  assert.ok(shader.fragmentShader.includes('incheonBumpFade'));
});

test('central detail mesh aligns UVs to 12 km landscape when satellite imagery is active', () => {
  const pos = new THREE.Float32BufferAttribute([-1000, 0, -1000, 1000, 0, 1000], 3);
  const uv = new THREE.Float32BufferAttribute([0, 1, 1, 0], 2);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', pos);
  geom.setAttribute('uv', uv);

  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / 12000 + 0.5, 0.5 - pos.getZ(i) / 12000);
  }

  assert.ok(Math.abs(uv.getX(0) - (5 / 12)) < 1e-5);
  assert.ok(Math.abs(uv.getY(0) - (7 / 12)) < 1e-5);
  assert.ok(Math.abs(uv.getX(1) - (7 / 12)) < 1e-5);
  assert.ok(Math.abs(uv.getY(1) - (5 / 12)) < 1e-5);
});

