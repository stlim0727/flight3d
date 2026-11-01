import test from 'node:test';
import { Box3, Matrix4, Vector3 } from 'three';
import { HANGANG_COURSE, bridgeSolids } from '../src/config/hangangCourse.js';
import { HangangCollision } from '../src/director/HangangCollision.js';
import assert from 'node:assert/strict';
import { HangangScene } from '../src/environment/HangangScene.js';
import { createSeoulScenery, createLightPointTexture } from '../src/environment/SeoulLandmarks.js';
import { createHangangAssetLoader, hangangAssetManifest } from '../src/environment/HangangAssetLoader.js';

test('hangangAssetManifest defines valid GLB models with bounding boxes', () => {
  const keys = ['yeouido-landmarks', 'namsan-tower', 'lotte-tower', 'bridges-kit', 'nodeul-pavilion'];
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

// Bridge-local vertices of every rendered triangle, with the mesh they belong to.
function bridgeTriangles(bridge) {
  bridge.updateMatrixWorld(true);
  const inverse = bridge.matrixWorld.clone().invert(), triangles = [];
  bridge.traverse(node => {
    if (!node.isMesh) return;
    const toLocal = inverse.clone().multiply(node.matrixWorld), { index, attributes: { position } } = node.geometry;
    const vertex = n => new Vector3().fromBufferAttribute(position, index ? index.getX(n) : n).applyMatrix4(toLocal);
    for (let n = 0; n < (index ?? position).count; n += 3) triangles.push({ mesh: node.name, points: [vertex(n), vertex(n + 1), vertex(n + 2)] });
  });
  return triangles;
}

test('no bridge triangle intrudes into the central opening', () => {
  // Merged meshes span the opening, so check each triangle: nothing drawn may enter
  // the passage under the deck (|x| < 50 m, below 34 m).
  const opening = new Box3(new Vector3(-49.99, 0, -12), new Vector3(49.99, 33.99, 12));
  for (const bridge of new HangangScene().bridges) {
    for (const { mesh, points } of bridgeTriangles(bridge)) {
      assert.ok(!new Box3().setFromPoints(points).intersectsBox(opening), `${mesh} triangle at ${points[0].toArray()}`);
    }
  }
});

test('bridges draw their collision solids in five merged meshes', () => {
  const scene = new HangangScene();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const bridge = scene.bridges[i], triangles = bridgeTriangles(bridge);
    assert.equal(new Set(triangles.map(t => t.mesh)).size, 5, spec.id);
    const key = p => p.toArray().map(v => v.toFixed(3)).join();
    const drawn = new Set(triangles.flatMap(t => t.points.map(key)));
    const solids = bridgeSolids(spec).map(s => ({ ...s, box: new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size)) }));
    // Every solid except the railing envelopes is drawn as exactly that box.
    for (const { part, box } of solids.filter(s => s.part !== 'rail')) {
      for (let corner = 0; corner < 8; corner++) {
        const p = new Vector3(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
        assert.ok(drawn.has(key(p)), `${spec.id} ${part} corner ${p.toArray()}`);
      }
    }
    // The open railing at the deck edges stays inside its collision envelopes.
    const rails = solids.filter(s => s.part === 'rail').map(s => s.box.clone().expandByScalar(1e-6));
    const railing = triangles.filter(t => t.points.every(p => p.y > 40.01 && Math.abs(p.z) > 10.7));
    assert.ok(railing.length > 0);
    for (const { points } of railing) assert.ok(rails.some(r => points.every(p => r.containsPoint(p))), `${spec.id} railing ${points[0].toArray()}`);
  });
});

test('Nodeulseom stand-ins show the solids HangangCollision collides with before GLBs load', async () => {
  const island = HANGANG_COURSE.nodeulseom, field = island.pavilion.heights;
  const { group, ready } = createSeoulScenery();
  assert.equal(await ready, false);
  const islandMesh = group.getObjectByName('Nodeulseom island stand-in');
  const pavilion = group.getObjectByName('Nodeul pavilion stand-in');
  assert.ok(islandMesh.visible && pavilion.visible);

  islandMesh.geometry.computeBoundingBox();
  const bounds = islandMesh.geometry.boundingBox;
  assert.ok(Math.abs(bounds.max.y - island.height) < 1e-6 && Math.abs(bounds.min.y) < 1e-6);
  assert.ok(Math.abs(bounds.max.x - island.x - island.bottomRadius) < 1e-6);

  const collision = new HangangCollision(), matrix = new Matrix4(), top = new Vector3(), scale = new Vector3();
  assert.equal(pavilion.count, field.heights.filter(h => h > island.height).length);
  for (let n = 0; n < pavilion.count; n++) {
    pavilion.getMatrixAt(n, matrix);
    top.setFromMatrixPosition(matrix); scale.setFromMatrixScale(matrix);
    top.y += scale.y / 2;
    const probe = y => collision.nodeulseomHit(new Box3().setFromCenterAndSize(new Vector3(top.x, y, top.z), new Vector3(0.2, 0.2, 0.2)));
    assert.equal(probe(top.y - 0.15), 'pavilion');
    assert.equal(probe(top.y + 0.15), null);
  }
});

test('asset loader marks failed loads so stand-ins stay visible', async () => {
  assert.equal((await createHangangAssetLoader()('nodeul-pavilion')).userData.fallback, true);
});
