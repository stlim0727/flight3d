import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStaticCockpit } from '../src/aircraft/StaticCockpitBatch.js';

test('static batching preserves nested world bounds, UVs and moving descendants', () => {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.position.set(0, -1.31, -11.43);
  const material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const b = new THREE.Mesh(new THREE.BoxGeometry(), material);
  a.position.x = 2;
  b.position.y = 3;
  a.add(b);
  model.add(a);
  const pivot = new THREE.Group();
  const moving = new THREE.Mesh(new THREE.BoxGeometry(), material);
  pivot.add(moving);
  b.add(pivot);
  model.updateMatrixWorld(true);
  const expected = new THREE.Box3().setFromObject(model);
  const movingBefore = moving.getWorldPosition(new THREE.Vector3());
  assert.equal(batchStaticCockpit(model, [pivot]), 1);
  model.updateMatrixWorld(true);
  const batch = model.children.find(n => n.name === 'GLTF_Static_Batch');
  assert.ok(batch.geometry.attributes.uv);
  assert.equal(batch.geometry.index.count, 72);
  assert.ok(new THREE.Box3().setFromObject(model).equals(expected));
  assert.ok(moving.getWorldPosition(new THREE.Vector3()).equals(movingBefore));
  assert.ok(a.visible && b.visible && moving.visible);
  pivot.rotation.z = 1;
  assert.equal(moving.geometry.index.count, 36);
});

test('hidden, transparent and incompatible surfaces are left intact', () => {
  const model = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), material);
  hidden.visible = false;
  const transparent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  const ordinary = new THREE.Mesh(new THREE.BoxGeometry(), material);
  model.add(hidden, transparent, ordinary);
  assert.equal(batchStaticCockpit(model), 0);
  assert.equal(ordinary.geometry.index.count, 36);
  assert.equal(hidden.visible, false);
});

test('mirrored geometry retains front-face winding and tangent handedness', () => {
  for (const indexed of [true, false]) {
    const model = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    for (const x of [-1, 1]) {
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0,0,1, 0,0,1, 0,0,1],3));
      geometry.setAttribute('tangent', new THREE.Float32BufferAttribute([1,0,0,1, 1,0,0,1, 1,0,0,1],4));
      if (indexed) geometry.setIndex([0,1,2]);
      const mesh = new THREE.Mesh(geometry,material);
      mesh.scale.x = x;
      model.add(mesh);
    }
    assert.equal(batchStaticCockpit(model),1);
    const g = model.children[0].geometry;
    const p = g.attributes.position;
    const ids = g.index ? Array.from(g.index.array) : [0,1,2,3,4,5];
    for (let i=0;i<6;i+=3) {
      const [a,b,c] = ids.slice(i,i+3).map(j=>new THREE.Vector3().fromBufferAttribute(p,j));
      assert.ok(b.sub(a).cross(c.sub(a)).z > 0);
    }
    assert.equal(g.attributes.tangent.getW(0),-1);
    assert.equal(g.attributes.tangent.getW(3),1);
  }
});
