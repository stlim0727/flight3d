import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/environment/Terrain.js';
import { WaterOcean } from '../src/environment/WaterOcean.js';

function compiledFragment(terrain) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  terrain.material.onBeforeCompile(shader);
  return shader.fragmentShader;
}

test('terrain paints no fog-coloured square around its perimeter (#751)', () => {
  const fragment = compiledFragment(new Terrain(22000, 64));
  assert.ok(!/tEdge|tFade/.test(fragment));
  assert.ok(fragment.includes('#include <fog_fragment>'), 'distance fog itself is untouched');
});

test('the seabed is not drawn, so no sea mesh has to cover it', () => {
  const terrain = new Terrain(22000, 64);
  const fragment = compiledFragment(terrain);
  const cut = fragment.match(/if \(vTerrainWorldPos\.y < (-\d+\.\d)\) discard;/);
  assert.ok(cut, 'fragments below the cut are discarded');
  const cutY = Number(cut[1]);
  // Below every swell trough, so the cut never opens a gap at the waterline.
  const ocean = new WaterOcean(36000, 8);
  let trough = 0;
  for (let i = 0; i < 4000; i++) trough = Math.min(trough, ocean.getWaveHeight(i * 37.3, i * 11.1, i * 0.37));
  assert.ok(trough < -0.5 && cutY < trough - 0.5, `cut ${cutY} m lies under the deepest trough ${trough.toFixed(2)} m`);

  // The mesh itself still follows getHeight everywhere, perimeter included.
  const position = terrain.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 7) {
    assert.equal(position.getY(i), Math.fround(terrain.getHeight(position.getX(i), position.getZ(i))));
  }
  assert.equal(terrain.getHeight(10800, 0), -18, 'physics seabed is unchanged');
});

test('seabed the sea mesh leaves uncovered off the island centre is cut away', () => {
  // The sea mesh follows the camera and ends 17.1 km from it, so away from the centre
  // the far side of this mesh has no sea over it. All of that seabed must fall below
  // the cut, bar the shallows along the waterline itself.
  const terrain = new Terrain(22000, 256);
  const cutY = -2;
  const position = terrain.geometry.attributes.position;
  for (const [cx, cz] of [[5000, 5000], [9000, -3000], [-8000, 8000]]) {
    let uncovered = 0, drawn = 0;
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      if (Math.hypot(x - cx, z - cz) <= 17100 || y >= 0) continue;
      uncovered++;
      if (y >= cutY) drawn++;
    }
    assert.ok(uncovered > 500, `camera over ${cx}, ${cz} leaves seabed uncovered (${uncovered} vertices)`);
    assert.ok(drawn / uncovered < 0.05, `only waterline shallows stay drawn: ${drawn} of ${uncovered}`);
  }
});
