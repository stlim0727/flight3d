import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { APPROACH, HANGANG_COURSE, bridgeApproaches, bridgeLampX, bridgeOpening, bridgeSolids, bridgeToWorld, hangangHeight } from '../src/config/hangangCourse.js';
import { readGlbTriangles } from '../scripts/lib/nodeul-pavilion-heights.mjs';
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

test('main spans follow the surveyed longest spans in real west-to-east order (#396)', () => {
  const [seogang, mapo, hangang] = HANGANG_COURSE.bridges;
  assert.deepEqual(HANGANG_COURSE.bridges.map(b => b.id), ['seogang', 'mapo', 'hangang']);
  // 1.08 km and 2.65 km apart, as between the real bridges.
  assert.equal(seogang.z - mapo.z, 1080); assert.equal(mapo.z - hangang.z, 2650);
  for (const [bridge, span] of [[seogang, 150], [mapo, 70], [hangang, 63.5]]) {
    const piers = bridge.piers, gaps = piers.slice(1).map((x, i) => x - piers[i]);
    assert.equal(Math.max(...gaps), span, bridge.id);
    assert.equal(bridgeOpening(bridge).halfWidth, span / 2 - 5, bridge.id);
  }
  assert.ok(Math.abs(hangang.x - HANGANG_COURSE.nodeulseom.x) < 1e-9 && hangang.z === HANGANG_COURSE.nodeulseom.z);
});

test('no bridge triangle intrudes into the main-span opening', () => {
  // Merged meshes span the opening, so check each triangle: nothing drawn may enter
  // the passage under the decks, between the main span's pier caps and below 34 m.
  const scene = new HangangScene();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const { halfWidth, soffit, halfDepth } = bridgeOpening(spec);
    const opening = new Box3(new Vector3(-halfWidth + 0.01, 0, -halfDepth), new Vector3(halfWidth - 0.01, soffit - 0.01, halfDepth));
    for (const { mesh, points } of bridgeTriangles(scene.bridges[i])) {
      assert.ok(!new Box3().setFromPoints(points).intersectsBox(opening), `${mesh} triangle at ${points[0].toArray()}`);
    }
  });
});

test('bridges draw their collision solids in five merged meshes', () => {
  const scene = new HangangScene();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const bridge = scene.bridges[i], triangles = bridgeTriangles(bridge);
    assert.equal(new Set(triangles.map(t => t.mesh)).size, 5, spec.id);
    const key = p => p.toArray().map(v => v.toFixed(3)).join();
    const drawn = new Set(triangles.flatMap(t => t.points.map(key)));
    const solids = bridgeSolids(spec).map(s => ({ ...s, box: new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size)) }));
    // Every solid except the railing, arch and approach envelopes is drawn as exactly
    // that box, deck lamps included (#395).
    const deckLamps = solids.filter(s => s.part === 'lamp' && Math.abs(s.center[0]) <= spec.length / 2);
    assert.equal(deckLamps.length, bridgeLampX(spec).length * 4 * spec.decks.length, spec.id);
    for (const { part, box } of solids.filter(s => s.part !== 'rail' && s.render !== false)) {
      for (let corner = 0; corner < 8; corner++) {
        const p = new Vector3(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
        assert.ok(drawn.has(key(p)), `${spec.id} ${part} corner ${p.toArray()}`);
      }
    }
    // The open railing at the deck edges stays inside its collision envelopes.
    const rails = solids.filter(s => s.part === 'rail').map(s => s.box.clone().expandByScalar(1e-6));
    const edges = spec.decks.flatMap(d => [d.z - d.width / 2, d.z + d.width / 2]);
    const railing = triangles.filter(t => t.points.every(p => p.y > 40.01 && edges.some(z => Math.abs(p.z - z) < 0.3)));
    assert.ok(railing.length > 0);
    for (const { points } of railing) assert.ok(rails.some(r => points.every(p => r.containsPoint(p))), `${spec.id} railing ${points[0].toArray()}`);
    // Arch ribs are drawn only where the bridge has arches, wholly inside their collision
    // boxes (#395). Above the lamps (43.8 m) only ribs are drawn.
    const arches = solids.filter(s => s.part === 'arch').map(s => s.box.clone().expandByScalar(1e-4)); // float32 vertices
    const tube = triangles.filter(t => t.points.every(p => p.y > 44.5));
    assert.equal(arches.length > 0, spec.arches.length > 0, spec.id);
    if (!spec.arches.length) { assert.equal(tube.length, 0, spec.id); return; }
    const crown = Math.max(...spec.arches.map(a => 41 + a.rise + a.radius));
    assert.ok(tube.length > 1000 && Math.abs(Math.max(...arches.map(b => b.max.y)) - crown) < 0.01, spec.id);
    for (const { points } of tube) assert.ok(arches.some(b => points.every(p => b.containsPoint(p))), `${spec.id} arch ${points[0].toArray()}`);
  });
});

test('approach ramps carry every deck end down to the bank (#429)', () => {
  for (const bridge of HANGANG_COURSE.bridges) {
    const approaches = bridgeApproaches(bridge);
    assert.deepEqual(approaches.map(a => a.side), [-1, 1], bridge.id);
    for (const a of approaches) {
      const end = a.start + a.side * a.length;
      assert.equal(a.start, a.side * bridge.length / 2, bridge.id);
      assert.equal(a.top(a.start), 40, bridge.id);
      assert.ok(Math.abs(a.top(end) - hangangHeight(...bridgeToWorld(bridge, end))) < 0.05, `${bridge.id} ${a.side}`);
      assert.ok((40 - a.top(end)) / a.length <= APPROACH.grade + 1e-9, `${bridge.id} ${a.side}`);
    }
  }
});

test('approach ramps are drawn inside their collision solids up to the bank (#429)', () => {
  const scene = new HangangScene();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const solids = bridgeSolids(spec).map(s => new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size)).expandByScalar(1e-3));
    const ramps = bridgeTriangles(scene.bridges[i]).filter(t => t.points.every(p => Math.abs(p.x) > spec.length / 2 + 1e-3));
    assert.ok(ramps.length > 0, spec.id);
    for (const { mesh, points } of ramps) assert.ok(solids.some(b => points.every(p => b.containsPoint(p))), `${mesh} triangle at ${points[0].toArray()}`);
    // The ramp road runs on from the deck road to the far end of each approach.
    const road = ramps.filter(t => t.mesh.endsWith(' road')).flatMap(t => t.points);
    for (const a of bridgeApproaches(spec)) {
      const reach = Math.max(...road.map(p => a.side * p.x));
      assert.ok(Math.abs(reach - Math.abs(a.start) - a.length) < 0.01, `${spec.id} ${a.side} road ends at ${reach}`);
    }
  });
});

test('landmark models leave the approach ramps clear (#429)', () => {
  const models = ['yeouido-landmarks', 'namsan-tower', 'lotte-tower']
    .map(name => [name, readGlbTriangles(readFileSync(`public/models/hangang/${name}.glb`))]);
  for (const bridge of HANGANG_COURSE.bridges) {
    const toLocal = new Matrix4().compose(new Vector3(bridge.x, 0, bridge.z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), bridge.yaw), new Vector3(1, 1, 1)).invert();
    const ramp = bridgeSolids(bridge).filter(s => Math.abs(s.center[0]) > bridge.length / 2)
      .map(s => new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size)));
    for (const [name, triangles] of models) {
      for (const points of triangles) {
        const box = new Box3().setFromPoints(points.map(p => p.clone().applyMatrix4(toLocal)));
        assert.ok(!ramp.some(r => r.intersectsBox(box)), `${name} pierces the ${bridge.id} approach at ${points[0].toArray()}`);
      }
    }
  }
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
