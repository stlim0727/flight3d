import test from 'node:test';
import assert from 'node:assert/strict';
import { HangangScene } from '../src/environment/HangangScene.js';
import { createSeoulScenery, createLightPointTexture } from '../src/environment/SeoulLandmarks.js';
import { createHangangAssetLoader, hangangAssetManifest } from '../src/environment/HangangAssetLoader.js';

test('hangangAssetManifest defines valid GLB models with bounding boxes', () => {
  const keys = ['yeouido-landmarks', 'namsan-tower', 'lotte-tower', 'bridges-kit'];
  for (const k of keys) {
    assert.ok(hangangAssetManifest[k], `Manifest key ${k} must exist`);
    assert.ok(hangangAssetManifest[k].url.endsWith('.glb'));
    assert.ok(hangangAssetManifest[k].bytes > 0);
    assert.ok(hangangAssetManifest[k].bounds.min.length === 3);
    assert.ok(hangangAssetManifest[k].bounds.max.length === 3);
  }
});

test('createHangangAssetLoader loads or falls back gracefully without throwing', async () => {
  const loader = createHangangAssetLoader();
  const fallback = await loader('yeouido-landmarks');
  assert.ok(fallback);
});

test('createLightPointTexture produces a valid RGBA DataTexture without DOM', () => {
  const tex = createLightPointTexture(16);
  assert.ok(tex);
  assert.equal(tex.image.width, 16);
  assert.equal(tex.image.height, 16);
  assert.equal(tex.image.data.length, 16 * 16 * 4);
});

test('createSeoulScenery builds GLB mount group, expressways, and night lights', () => {
  const { group, update, ready } = createSeoulScenery();
  assert.ok(group);
  assert.equal(typeof update, 'function');
  assert.ok(ready instanceof Promise);

  const modelsGroup = group.getObjectByName('Hangang GLB Models');
  assert.ok(modelsGroup, 'Hangang GLB models container must exist');

  const expressways = group.getObjectByName('Han River Expressways');
  assert.ok(expressways, 'Expressways group must exist');

  const lights = group.getObjectByName('Seoul Metropolis Night Lights');
  assert.ok(lights, 'Night lights point cloud must exist');
  assert.equal(lights.isPoints, true);
  assert.ok(lights.geometry.attributes.position.count >= 10000);
  assert.ok(lights.geometry.attributes.color.count >= 10000);

  // Verify strobe update does not throw
  assert.doesNotThrow(() => update(0.1));
  assert.doesNotThrow(() => update(0.5));
});

test('HangangScene constructs with river, banks, 3 bridges, and Seoul scenery', () => {
  const scene = new HangangScene();
  assert.ok(scene.group);
  assert.equal(scene.group.visible, false);
  assert.equal(scene.bridges.length, 3);
  assert.equal(typeof scene.terrain.getHeight, 'function');
  assert.equal(typeof scene.airport.isOnRunway, 'function');

  // Verify update works
  assert.doesNotThrow(() => scene.update(0.05));
});
