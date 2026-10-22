import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FoliageAndCities } from '../src/environment/FoliageAndCities.js';
import { createTreeGeometry, TREE_SPECIES } from '../src/environment/TreeModels.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

function random() {
  let state = 10;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('species have distinct silhouettes, opaque materials and cheaper far geometry', () => {
  const shapes = [];
  for (const species of TREE_SPECIES) {
    const near = createTreeGeometry(species, true), far = createTreeGeometry(species, false);
    assert.ok(far.attributes.position.count < near.attributes.position.count / 2);
    shapes.push(near.boundingBox.getSize(new THREE.Vector3()).toArray().join(','));
    near.dispose(); far.dispose();
  }
  assert.equal(new Set(shapes).size, 3);
});

test('tree placement, transformed collision envelopes and LOD hold/reverse/teleport', () => {
  const foliage = new FoliageAndCities({ getHeight: () => 12 }, random());
  assert.equal(foliage.treeData.length, 3500);
  const total = () => foliage.treeBatches.reduce((n, b) => n + b.meshes[0].count + b.meshes[1].count, 0);
  assert.equal(total(), 3500);
  const point = new THREE.Vector3();
  for (let i = 0; i < foliage.treeData.length; i++) {
    const proxy = foliage.treeData[i], tree = foliage.treeInstances[i];
    assert.ok(!(Math.abs(proxy.x) < 2400 && Math.abs(proxy.z) < 450));
    assert.ok(!(Math.abs(proxy.x) < 3600 && Math.abs(proxy.z) < 250));
    // Check actual rotated/scaled vertices from both levels against the collision cylinder.
    for (const mesh of foliage.treeBatches[tree.speciesIndex].meshes) {
      const vertices = mesh.geometry.attributes.position;
      for (let j = 0; j < vertices.count; j++) {
        point.fromBufferAttribute(vertices, j).applyMatrix4(tree.matrix);
        assert.ok(point.y <= proxy.y + proxy.height + 1e-5);
        assert.ok(point.y >= proxy.y - 1e-5);
        assert.ok(Math.hypot(point.x - proxy.x, point.z - proxy.z) <= proxy.radius + 1e-5);
      }
      assert.equal(mesh.material.side, THREE.FrontSide);
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.material.alphaTest, 0);
      assert.equal(mesh.castShadow, mesh.name.endsWith('-near'));
    }
  }
  const tree = foliage.treeInstances[0];
  const cameraAt = distance => tree.position.clone().add(new THREE.Vector3(0, distance, 0));
  const collisionSnapshot = JSON.stringify(foliage.treeData);
  for (const [distance, expected] of [[600, true], [700, true], [740, true], [780, false],
    [700, false], [660, false], [620, true], [20000, false], [0, true]]) {
    foliage.update(cameraAt(distance));
    assert.equal(tree.near, expected, `distance ${distance}`);
    assert.equal(total(), 3500);
    assert.equal(JSON.stringify(foliage.treeData), collisionSnapshot);
    for (let species = 0; species < 3; species++) {
      for (let level = 0; level < 2; level++) {
        const records = foliage.treeInstances.filter(t => t.speciesIndex === species && t.near === (level === 0));
        const mesh = foliage.treeBatches[species].meshes[level];
        assert.equal(mesh.count, records.length);
        const matrix = new THREE.Matrix4(), color = new THREE.Color();
        records.forEach((record, index) => {
          mesh.getMatrixAt(index, matrix);
          matrix.elements.forEach((value, i) => assert.ok(Math.abs(value - record.matrix.elements[i]) < 0.001));
          mesh.getColorAt(index, color);
          assert.ok(Math.abs(color.r - record.color.r) < 1e-6);
        });
      }
    }
  }
  const detector = new CollisionDetector(null, null, foliage, null, null);
  const proxy = foliage.treeData[0];
  const pos = new THREE.Vector3(proxy.x, proxy.y + proxy.height - 0.01, proxy.z);
  const probes = [{ pos, radius: 0.1, desc: 'wingtip' }];
  assert.equal(detector.checkTrees(pos, probes)?.part, 'wingtip');
  pos.y += 0.02;
  assert.equal(detector.checkTrees(pos, probes), null);
});

test('water and alpine areas stay treeless', () => {
  for (const height of [0, 281]) {
    const foliage = new FoliageAndCities({ getHeight: () => height }, random());
    assert.equal(foliage.treeData.length, 0);
    assert.ok(foliage.treeBatches.every(b => b.meshes.every(m => m.count === 0)));
  }
});
