import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { NEON_RIVER as river, bridgeOpening, bridgeRamps, bridgeSolids, bridgeToWorld, bridgeWorldBoxes,
  deckHalf, isRiver, riverCenter } from '../src/config/neonRiver.js';
import { createNeonRiver } from '../src/environment/NeonRiver.js';
import { NeonCity } from '../src/environment/NeonCity.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

// Bridge-local vertices of every rendered triangle, with the mesh they belong to.
function bridgeTriangles(bridge) {
  bridge.updateWorldMatrix(true, true);
  const inverse = bridge.matrixWorld.clone().invert(), triangles = [];
  bridge.traverse(node => {
    if (!node.isMesh) return;
    const toLocal = inverse.clone().multiply(node.matrixWorld), { index, attributes: { position } } = node.geometry;
    const vertex = n => new Vector3().fromBufferAttribute(position, index ? index.getX(n) : n).applyMatrix4(toLocal);
    for (let n = 0; n < (index ?? position).count; n += 3) triangles.push({ mesh: node.name, points: [vertex(n), vertex(n + 1), vertex(n + 2)] });
  });
  return triangles;
}
const boxOf = s => new Box3().setFromCenterAndSize(new Vector3(...s.center), new Vector3(...s.size));
const vertices = mesh => {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.attributes.position;
  return Array.from({ length: position.count }, (_, n) => new Vector3().fromBufferAttribute(position, n).applyMatrix4(mesh.matrixWorld));
};

test('the street stops at the quay walls and the water lies between them, below the street', () => {
  const canal = createNeonRiver(), across = p => p.x - riverCenter(p.z);
  for (const mesh of canal.ground.children) {
    for (const p of vertices(mesh)) assert.ok(Math.abs(across(p)) >= river.halfWidth - 1e-3 && p.y === 0, `ground at ${p.toArray()}`);
  }
  for (const p of vertices(canal.water)) assert.ok(Math.abs(across(p)) <= river.halfWidth + 1e-3 && p.y === river.waterLevel);
  for (const p of vertices(canal.walls)) {
    assert.ok(Math.abs(Math.abs(across(p)) - river.halfWidth) < 1e-3 && (p.y === 0 || p.y === river.waterLevel), `wall at ${p.toArray()}`);
  }
  for (const mesh of [...canal.ground.children, canal.water]) {
    const normals = mesh.geometry.attributes.normal;
    for (let n = 0; n < normals.count; n++) assert.ok(normals.getY(n) > 0.99, `${mesh.name} faces up`);
  }
});

test('multi-kilometre ground and water are subdivided both ways', () => {
  // Near-plane 1/w interpolation corrupts triangles that span kilometres.
  const canal = createNeonRiver();
  for (const mesh of [...canal.ground.children, canal.water]) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let n = 0; n < index.count; n += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(n + k)));
      assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 200, `${mesh.name} triangle at ${a.toArray()}`);
    }
  }
});

test('the city terrain sinks to the water between the quay walls', () => {
  const city = new NeonCity();
  assert.equal(city.terrain.getHeight(2300, 0), river.waterLevel);
  assert.equal(city.terrain.getHeight(2300 + river.halfWidth + 1, 0), 0);
  assert.equal(city.terrain.getHeight(0, 0), 0);
  assert.equal(city.terrain.getWaterLevel(2300, 500), river.waterLevel);
  assert.equal(city.terrain.getWaterLevel(1000, 500), 0);
  assert.equal(isRiver(2300, 9000), false, 'the canal bends away beyond the city');
});

test('bridges draw their solids in at most five merged meshes, inside the collision boxes', () => {
  const canal = createNeonRiver();
  river.bridges.forEach((spec, i) => {
    const triangles = bridgeTriangles(canal.bridges[i]), solids = bridgeSolids(spec);
    assert.ok(new Set(triangles.map(t => t.mesh)).size <= 5, spec.id);
    // Every plain solid is drawn as exactly that box.
    const key = p => p.toArray().map(v => v.toFixed(3)).join();
    const drawn = new Set(triangles.flatMap(t => t.points.map(key)));
    for (const s of solids.filter(s => s.render !== false && !s.tube && s.part !== 'rail')) {
      const box = boxOf(s);
      for (let corner = 0; corner < 8; corner++) {
        const p = new Vector3(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z);
        assert.ok(drawn.has(key(p)), `${spec.id} ${s.part} corner ${p.toArray()}`);
      }
    }
    // Everything else drawn (railings, ramps, arch ribs, cables) lies inside some box.
    const boxes = solids.map(s => boxOf(s).expandByScalar(1e-3));
    const road = new Box3(new Vector3(-deckHalf(), spec.top, -spec.width / 2), new Vector3(deckHalf(), spec.top + 0.06, spec.width / 2));
    for (const { mesh, points } of triangles) {
      assert.ok(boxes.some(b => points.every(p => b.containsPoint(p))) || points.every(p => road.containsPoint(p)), `${mesh} triangle at ${points[0].toArray()}`);
    }
  });
});

test('no bridge triangle intrudes into the clear passage under its deck', () => {
  const canal = createNeonRiver();
  river.bridges.forEach((spec, i) => {
    const { halfWidth, soffit, halfDepth, water } = bridgeOpening(spec);
    const opening = new Box3(new Vector3(-halfWidth + 0.01, water, -halfDepth), new Vector3(halfWidth - 0.01, soffit - 0.01, halfDepth));
    for (const { mesh, points } of bridgeTriangles(canal.bridges[i])) {
      assert.ok(!new Box3().setFromPoints(points).intersectsBox(opening), `${mesh} triangle at ${points[0].toArray()}`);
    }
  });
});

test('the bridges are drawn where their world collision boxes stand', () => {
  const canal = createNeonRiver(), boxes = bridgeWorldBoxes();
  river.bridges.forEach((spec, i) => {
    canal.bridges[i].updateWorldMatrix(true, true);
    const deck = boxes.find(b => b.bridge === spec.id && b.part === 'deck');
    const centre = new Vector3(0, spec.top - spec.depth / 2, 0).applyMatrix4(canal.bridges[i].matrixWorld);
    assert.deepEqual([deck.x, deck.y + deck.height / 2, deck.z], centre.toArray(), spec.id);
    assert.deepEqual(bridgeToWorld(spec, 0, 0), [centre.x, centre.z]);
  });
});

test('Neon Metropolis towers stand clear of the canal and of every bridge and ramp', () => {
  const city = new NeonCity();
  const towers = city.buildingData.filter(b => !b.bridge), bridges = city.buildingData.filter(b => b.bridge);
  assert.equal(bridges.length, bridgeWorldBoxes().length);
  const corners = b => {
    const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY), w = b.localWidth / 2, d = b.localDepth / 2;
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [b.x + x * c + z * s, b.z - x * s + z * c]);
  };
  for (const tower of towers) {
    const footprint = corners(tower);
    for (const [x, z] of footprint) assert.ok(Math.abs(x - riverCenter(z)) > river.halfWidth + 30, `tower at ${tower.x}, ${tower.z} by the canal`);
    // 15 m clear of every bridge solid's footprint (decks, ramps, pylons, back-stays).
    const xs = footprint.map(c => c[0]), zs = footprint.map(c => c[1]);
    for (const b of bridges) {
      const clear = b.x - b.width / 2 > Math.max(...xs) + 15 || b.x + b.width / 2 < Math.min(...xs) - 15
        || b.z - b.depth / 2 > Math.max(...zs) + 15 || b.z + b.depth / 2 < Math.min(...zs) - 15;
      assert.ok(clear, `tower at ${tower.x}, ${tower.z} on ${b.bridge} ${b.part}`);
    }
  }
});

test('avenue grid lines stop at the quay walls', () => {
  const city = new NeonCity();
  const lines = city.group.children.find(c => c.isLineSegments && c.material.color.getHex() === 0x22123d);
  const position = lines.geometry.attributes.position;
  for (let n = 0; n < position.count; n += 2) {
    const a = new Vector3().fromBufferAttribute(position, n), b = new Vector3().fromBufferAttribute(position, n + 1);
    for (let t = 0; t <= 1; t += 0.01) {
      const p = a.clone().lerp(b, t);
      assert.ok(!isRiver(p.x, p.z) || Math.abs(Math.abs(p.x - riverCenter(p.z)) - river.halfWidth) < 1e-6, `grid over the canal at ${p.toArray()}`);
    }
  }
});

test('every aircraft collides with the bridges and the canal water anywhere in Neon Metropolis', () => {
  const city = new NeonCity();
  const detector = new CollisionDetector(city.terrain, city.airport, city);
  detector.loadAircraftConfig({ id: 'B738' });
  const north = new Quaternion(), arch = river.bridges.find(b => b.id === 'arch');
  const [x, z] = bridgeToWorld(arch, 0, 0);
  // Into the arch bridge's deck, and through its clear span below.
  assert.ok(detector.checkCollision(new Vector3(x, arch.top - 1.5, z), north, new Vector3(0, 0, -70), 0, 0, 0));
  assert.equal(detector.checkCollision(new Vector3(x, -6, z), north, new Vector3(0, 0, -70), 0, 0, 0), null);
  // The canal's water is 14 m below the street: flying below the street is not ditching.
  assert.equal(detector.checkCollision(new Vector3(x, -6, 1500), north, new Vector3(0, 0, -70), 0, 0, 0), null);
  assert.equal(detector.checkCollision(new Vector3(x, river.waterLevel + 1, 1500), north, new Vector3(0, 0, -70), 0, -3, 0)?.type, 'WATER');
});
