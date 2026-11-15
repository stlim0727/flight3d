import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/environment/Terrain.js';

test('terrain paints no fog-coloured square around its perimeter (#751)', () => {
  const terrain = new Terrain(22000, 64);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  terrain.material.onBeforeCompile(shader);
  assert.ok(!/tEdge|tFade/.test(shader.fragmentShader));
  assert.ok(shader.fragmentShader.includes('#include <fog_fragment>'), 'distance fog itself is untouched');
});

test('submerged perimeter is drawn below the sea depth bias while physics keeps its seabed', () => {
  const terrain = new Terrain(22000, 64);
  const position = terrain.geometry.attributes.position;
  let unchanged = 0;
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const height = Math.fround(terrain.getHeight(x, z));
    if (edge >= 10800) assert.equal(y, -60, 'outermost seabed sits at the drawn perimeter depth');
    else if (height >= 0 || edge <= 10400) { assert.equal(y, height, 'land and inner seabed follow getHeight'); unchanged++; }
    else assert.ok(y <= height, 'submerged perimeter is only ever drawn deeper');
  }
  assert.ok(unchanged > 3000);
  assert.equal(terrain.getHeight(10800, 0), -18, 'physics seabed is unchanged');
});
