import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, PerspectiveCamera } from 'three';
import { compileVisibleScene } from '../src/core/sceneShaderWarmup.js';

test('shader warmup excludes hidden subtrees and other camera layers without moving scene objects', async () => {
  const scene = new Scene(), camera = new PerspectiveCamera();
  const visible = new Mesh(), hiddenParent = new Group(), hidden = new Mesh(), otherLayer = new Mesh();
  hiddenParent.visible = false; hiddenParent.add(hidden); otherLayer.layers.set(1);
  scene.add(visible, hiddenParent, otherLayer);
  const children = [...scene.children];
  let compiled;
  const renderer = { compileAsync(root, viewCamera, targetScene) {
    assert.equal(viewCamera, camera); assert.equal(targetScene, scene);
    compiled = []; root.traverse(object => compiled.push(object));
    return Promise.resolve('ready');
  } };
  assert.equal(await compileVisibleScene(renderer, scene, camera), 'ready');
  assert.ok(compiled.includes(visible));
  assert.ok(!compiled.includes(hidden)); assert.ok(!compiled.includes(otherLayer));
  assert.deepEqual(scene.children, children); assert.equal(visible.parent, scene);
  assert.equal(hidden.parent, hiddenParent); assert.equal(hiddenParent.visible, false);
});
