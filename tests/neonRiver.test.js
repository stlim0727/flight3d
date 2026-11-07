import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { APPROACH, HANGANG_COURSE, bridgeApproaches, bridgeLampX, bridgeOpening, bridgeSolids, bridgeToCourse,
  bridgeWorldBoxes, courseToWorld, riverCenter, worldToCourse } from '../src/config/hangangCourse.js';
import { createNeonRiver } from '../src/environment/NeonRiver.js';
import { NeonCity } from '../src/environment/NeonCity.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

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

// World-space vertices of a mesh.
function worldVertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.attributes.position;
  return Array.from({ length: position.count }, (_, n) => new Vector3().fromBufferAttribute(position, n).applyMatrix4(mesh.matrixWorld));
}

test('the river lies open between the banks: ground on either side, water between, all upward-facing', () => {
  const river = createNeonRiver();
  const across = p => { const [x, z] = worldToCourse(p.x, p.z); return x - riverCenter(z); };
  const half = HANGANG_COURSE.halfWidth;
  for (const mesh of river.ground.children) {
    for (const p of worldVertices(mesh)) assert.ok(Math.abs(across(p)) >= half - 1e-3 && p.y === 0, `ground at ${p.toArray()}`);
  }
  for (const p of worldVertices(river.water)) assert.ok(Math.abs(across(p)) <= half + 1e-3 && p.y === HANGANG_COURSE.waterLevel);
  for (const mesh of [...river.ground.children, river.water]) {
    mesh.geometry.computeVertexNormals();
    const normals = mesh.geometry.attributes.normal;
    for (let n = 0; n < normals.count; n++) assert.ok(normals.getY(n) > 0.99, `${mesh.name} faces up`);
  }
});

test('multi-kilometre river ground and water are subdivided both ways', () => {
  // Near-plane 1/w interpolation corrupts triangles that span kilometres.
  const river = createNeonRiver();
  for (const mesh of [...river.ground.children, river.water]) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let n = 0; n < index.count; n += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(n + k)));
      assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 200, `${mesh.name} triangle at ${a.toArray()}`);
    }
  }
});

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
  // West to east in the city too.
  const east = HANGANG_COURSE.bridges.map(b => courseToWorld(b.x, b.z)[0]);
  assert.deepEqual([...east].sort((a, b) => a - b), east);
});

test('no bridge triangle intrudes into the main-span opening', () => {
  // Merged meshes span the opening, so check each triangle: nothing drawn may enter
  // the passage under the decks, between the main span's pier caps and below 34 m.
  const river = createNeonRiver();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const { halfWidth, soffit, halfDepth } = bridgeOpening(spec);
    const opening = new Box3(new Vector3(-halfWidth + 0.01, 0, -halfDepth), new Vector3(halfWidth - 0.01, soffit - 0.01, halfDepth));
    for (const { mesh, points } of bridgeTriangles(river.bridges[i])) {
      assert.ok(!new Box3().setFromPoints(points).intersectsBox(opening), `${mesh} triangle at ${points[0].toArray()}`);
    }
  });
});

test('bridges draw their collision solids in five merged meshes', () => {
  const river = createNeonRiver();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const bridge = river.bridges[i], triangles = bridgeTriangles(bridge);
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

test('approach ramps carry every deck end down to the city ground (#429)', () => {
  for (const bridge of HANGANG_COURSE.bridges) {
    const approaches = bridgeApproaches(bridge);
    assert.deepEqual(approaches.map(a => a.side), [-1, 1], bridge.id);
    for (const a of approaches) {
      const end = a.start + a.side * a.length;
      assert.equal(a.start, a.side * bridge.length / 2, bridge.id);
      assert.equal(a.top(a.start), 40, bridge.id);
      assert.ok(Math.abs(a.top(end) - HANGANG_COURSE.waterLevel) < 0.05, `${bridge.id} ${a.side}`);
      assert.ok((40 - a.top(end)) / a.length <= APPROACH.grade + 1e-9, `${bridge.id} ${a.side}`);
    }
  }
});

test('approach ramps are drawn inside their collision solids up to the bank (#429)', () => {
  const river = createNeonRiver();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    const solids = bridgeSolids(spec).map(s => new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size)).expandByScalar(1e-3));
    const ramps = bridgeTriangles(river.bridges[i]).filter(t => t.points.every(p => Math.abs(p.x) > spec.length / 2 + 1e-3));
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

test('the bridges are drawn where their world collision boxes stand', () => {
  const river = createNeonRiver(), boxes = bridgeWorldBoxes();
  HANGANG_COURSE.bridges.forEach((spec, i) => {
    river.bridges[i].updateWorldMatrix(true, true);
    const deck = boxes.find(b => b.bridge === spec.id && b.part === 'deck');
    const centre = new Vector3(0, 38, spec.decks[0].z).applyMatrix4(river.bridges[i].matrixWorld);
    assert.ok(Math.hypot(centre.x - deck.x, centre.z - deck.z) < 1e-6 && deck.y === 36 && deck.height === 4, spec.id);
    assert.ok(Math.abs(deck.rotationY - HANGANG_COURSE.frame.yaw - spec.yaw) < 1e-12, spec.id);
  });
});

test('Neon Metropolis towers stand clear of the river and of every bridge and ramp', () => {
  const city = new NeonCity();
  const towers = city.buildingData.filter(b => !b.bridge);
  assert.equal(city.buildingData.length - towers.length, bridgeWorldBoxes().length);
  // A tower's footprint corners, in the world.
  const corners = b => {
    const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY), w = b.localWidth / 2, d = b.localDepth / 2;
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [b.x + x * c + z * s, b.z - x * s + z * c]);
  };
  for (const tower of towers) {
    for (const [x, z] of corners(tower)) {
      const [cx, cz] = worldToCourse(x, z);
      assert.ok(Math.abs(cx - riverCenter(cz)) > HANGANG_COURSE.halfWidth + 30, `tower at ${tower.x}, ${tower.z} by the river`);
    }
    // 15 m clear of each bridge's footprint, ramps included, sampled along every deck.
    for (const bridge of HANGANG_COURSE.bridges) {
      const reach = bridge.length / 2 + bridgeApproaches(bridge)[0].length;
      for (const deck of bridge.decks) {
        for (let x = -reach; x <= reach; x += 5) {
          const [wx, wz] = courseToWorld(...bridgeToCourse(bridge, x, deck.z));
          const c = Math.cos(tower.rotationY), s = Math.sin(tower.rotationY), dx = wx - tower.x, dz = wz - tower.z;
          const clear = Math.abs(c * dx - s * dz) > tower.localWidth / 2 + deck.width / 2 + 15
            || Math.abs(s * dx + c * dz) > tower.localDepth / 2 + deck.width / 2 + 15;
          assert.ok(clear, `tower at ${tower.x}, ${tower.z} on ${bridge.id}`);
        }
      }
    }
  }
});

test('every aircraft collides with the bridges anywhere in Neon Metropolis', () => {
  const city = new NeonCity();
  const detector = new CollisionDetector(city.terrain, city.airport, city);
  detector.loadAircraftConfig({ id: 'B738' });
  const [seogang] = HANGANG_COURSE.bridges;
  const level = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), HANGANG_COURSE.frame.yaw);
  const at = (x, y, z) => { const [wx, wz] = courseToWorld(...bridgeToCourse(seogang, x, z)); return new Vector3(wx, y, wz); };
  // Deck level, and the clear main span below the girders.
  assert.ok(detector.checkCollision(at(200, 38, 0), level, new Vector3(70, 0, 0), 0, 0, 0));
  assert.equal(detector.checkCollision(at(0, 20, 0), level, new Vector3(70, 0, 0), 0, 0, 0), null);
});
