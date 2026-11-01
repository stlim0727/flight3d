import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, MeshStandardMaterial, BoxGeometry, Group, Box3 } from 'three';
import { HANGANG_COURSE } from '../src/config/hangangCourse.js';
import { placeNodeulPavilion } from '../src/environment/nodeulPavilion.js';
import { bakePavilionHeights, readGlb } from '../scripts/lib/nodeul-pavilion-heights.mjs';

const island = HANGANG_COURSE.nodeulseom;
const bytes = readFileSync('public/models/hangang/nodeul-pavilion.glb');

test('collision heightfield is baked from the shipped pavilion GLB', () => {
  assert.deepEqual(bakePavilionHeights(bytes, island), island.pavilion.heights);
});

test('shipped pavilion GLB keeps its CC BY 4.0 attribution', () => {
  const { extras } = readGlb(bytes).gltf.asset;
  assert.match(extras.author, /mithgarden\.studio/);
  assert.match(extras.license, /CC-BY-4\.0/);
  assert.match(extras.source, /sketchfab\.com\/3d-models\/sejong-complex-cultural-center-buildings-/);
});

test('placement puts the model on the island top and renders it opaque', () => {
  const blend = new MeshStandardMaterial({ transparent: true });
  const root = new Group().add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), blend));
  placeNodeulPavilion(root, island);
  const box = new Box3().setFromObject(root);
  assert.ok(Math.abs(box.min.y - island.height) < 1e-6);
  assert.ok(Math.abs(box.max.y - island.height - island.pavilion.scale) < 1e-6);
  assert.ok(Math.abs((box.min.x + box.max.x) / 2 - island.x) < 1e-6);
  assert.equal(blend.transparent, false); assert.equal(blend.alphaTest, 0.5);
});
