import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildOpenTerrainTile } from '../src/environment/OpenWorldTerrain.js';

test('water tiles expose a wetness attribute for palette tinting', () => {
  const samples = 4;
  const raster = new Uint8Array(samples * samples).fill(0);
  const water = new Uint8Array(samples * samples * 4).fill(0);
  for (let i = 0; i < samples * samples; i++) water[i * 4 + 3] = 255;
  const project = (lat, lon) => [lon * 100000, lat * 100000];
  const { geometry } = buildOpenTerrainTile({
    x: 0, y: 0, raster, east: raster, south: raster, southeast: raster,
    water, project, subdivisions: 2,
  });
  const wet = geometry.getAttribute('terrainWet');
  assert.ok(wet);
  assert.ok(wet.count > 0);
  assert.ok(Array.from(wet.array).some(value => value === 1));
});

test('sea palette color is available as a fresh THREE.Color for shader uniforms', () => {
  const palette = { shallowColor: '#3db8c9' };
  const color = new THREE.Color(palette.shallowColor);
  assert.equal(color.getHexString(), '3db8c9');
});
