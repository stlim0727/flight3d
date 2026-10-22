import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareCockpitShadowDepth, useProjectionDepth } from '../src/aircraft/CockpitDepth.js';

test('projection depth removes logarithmic writes while preserving shader customizations', () => {
  const material = new THREE.MeshNormalMaterial();
  material.onBeforeCompile = shader => { shader.fragmentShader += '\n// existing'; };
  useProjectionDepth(material);
  const key = material.customProgramCacheKey();
  useProjectionDepth(material);
  assert.equal(material.customProgramCacheKey(), key);
  const shader = { fragmentShader: '#include <logdepthbuf_pars_fragment>\n#include <logdepthbuf_fragment>' };
  material.onBeforeCompile(shader);
  assert.ok(!shader.fragmentShader.includes('#include <logdepthbuf_fragment>'));
  assert.ok(shader.fragmentShader.includes('// existing'));
  // Keep the declarations required by the log-depth vertex shader link.
  assert.ok(shader.fragmentShader.includes('logdepthbuf_pars_fragment'));
});

test('shadow depth handles renderer variants, existing hooks and newly loaded meshes', () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh();
  root.add(mesh);
  let before = 0;
  mesh.onBeforeShadow = () => before++;
  prepareCockpitShadowDepth(root);
  const hook = mesh.onBeforeShadow;
  prepareCockpitShadowDepth(root);
  assert.equal(mesh.onBeforeShadow, hook);
  for (const material of [new THREE.MeshDepthMaterial(), new THREE.MeshDepthMaterial()]) {
    mesh.onBeforeShadow(null, mesh, null, null, mesh.geometry, material);
    const shader = { fragmentShader: '#include <logdepthbuf_fragment>' };
    material.onBeforeCompile(shader);
    assert.equal(shader.fragmentShader, '');
  }
  assert.equal(before, 2);
  const distance = new THREE.MeshDistanceMaterial(), original = distance.onBeforeCompile;
  mesh.onBeforeShadow(null, mesh, null, null, mesh.geometry, distance);
  assert.equal(distance.onBeforeCompile, original);
  const loaded = new THREE.Mesh();
  root.add(loaded);
  const old = loaded.onBeforeShadow;
  prepareCockpitShadowDepth(root);
  assert.notEqual(loaded.onBeforeShadow, old);
});
