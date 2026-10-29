import test from 'node:test';
import assert from 'node:assert/strict';
import { HangangScene } from '../src/environment/HangangScene.js';
import { createSeoulScenery, createLightPointTexture } from '../src/environment/SeoulLandmarks.js';

test('createLightPointTexture produces a valid RGBA DataTexture without DOM', () => {
  const tex = createLightPointTexture(16);
  assert.ok(tex);
  assert.equal(tex.image.width, 16);
  assert.equal(tex.image.height, 16);
  assert.equal(tex.image.data.length, 16 * 16 * 4);
});

test('createSeoulScenery builds Yeouido landmarks, Namsan, Lotte Tower, expressways and night lights', () => {
  const { group, update } = createSeoulScenery();
  assert.ok(group);
  assert.equal(typeof update, 'function');

  // Verify landmark hierarchy
  const yeouido = group.getObjectByName('Yeouido Landmarks');
  assert.ok(yeouido, 'Yeouido group must exist');

  const namsan = group.getObjectByName('Namsan & N Seoul Tower');
  assert.ok(namsan, 'Namsan & N Seoul Tower group must exist');

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
