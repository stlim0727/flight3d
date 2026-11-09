import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, EquirectangularReflectionMapping, Quaternion, Vector3 } from 'three';
import { NEON_ISLAND as island, NEON_RIVER as river, bridgeOpening, bridgeRamps, bridgeSolids, bridgeToWorld, bridgeWorldBoxes,
  deckHalf, isLand, isRiver, islandShore, landOutline, riverCenter, riverHalfWidth } from '../src/config/neonRiver.js';
import { neonStreets } from '../src/config/neonRoads.js';
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

test('the street lies on land and the water of the canal and the sea below it (#628)', () => {
  const canal = createNeonRiver();
  for (const mesh of canal.ground.children) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let n = 0; n < index.count; n += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(n + k)));
      const centre = a.clone().add(b).add(c).divideScalar(3);
      assert.ok([a, b, c].every(p => p.y === 0) && isLand(centre.x, centre.z), `ground at ${centre.toArray()}`);
    }
  }
  const water = vertices(canal.water);
  assert.ok(water.every(p => p.y === river.waterLevel));
  // The sea reaches the scenery edge on every side.
  assert.ok(Math.min(...water.map(p => p.x)) <= -12000 && Math.max(...water.map(p => p.x)) >= 12000);
  assert.ok(Math.min(...water.map(p => p.z)) <= -12000 && Math.max(...water.map(p => p.z)) >= 12000);
  for (const p of vertices(canal.walls)) assert.ok(p.y === 0 || p.y === river.waterLevel, `wall at ${p.toArray()}`);
  const banks = canal.group.children.filter(c => c.name.startsWith('neon-river-bank-'));
  assert.equal(banks.length, 2);
  for (const mesh of [...canal.ground.children, canal.water, ...banks]) {
    const normals = mesh.geometry.attributes.normal;
    for (let n = 0; n < normals.count; n++) assert.ok(normals.getY(n) > 0.99, `${mesh.name} faces up`);
  }
});

test('the quay walls trace every shore of both banks (#628)', () => {
  const { walls } = createNeonRiver();
  let points = 0;
  for (const side of [-1, 1]) {
    const shore = landOutline(side);
    points += shore.length;
    let area = 0;
    shore.forEach(([x, z], i) => {
      const [x1, z1] = shore[(i + 1) % shore.length], length = Math.hypot(x1 - x, z1 - z);
      area += x * z1 - x1 * z;
      assert.ok(length > 0 && length <= 100 + 1e-9, `step at ${x}, ${z}`);
      // The water lies to the right of each step, the land to its left.
      const [mx, mz, nx, nz] = [(x + x1) / 2, (z + z1) / 2, (z1 - z) / length, -(x1 - x) / length];
      assert.ok(!isLand(mx + 1.5 * nx, mz + 1.5 * nz), `water beyond the wall at ${mx}, ${mz}`);
      assert.ok(isLand(mx - 1.5 * nx, mz - 1.5 * nz), `land behind the wall at ${mx}, ${mz}`);
    });
    assert.ok(area > 0, `side ${side} counter-clockwise`);
  }
  assert.equal(walls.geometry.attributes.position.count, 2 * points);
});

test('Neon Metropolis is an island in the sea, its runway the only causeway (#628)', () => {
  const city = new NeonCity();
  const corners = b => {
    const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY), w = b.localWidth / 2, d = b.localDepth / 2;
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [b.x + x * c + z * s, b.z - x * s + z * c]);
  };
  // Every tower stands on the island at least 100 m from its outer shore, every street on land.
  for (const tower of city.buildingData.filter(b => !b.bridge)) {
    for (const [x, z] of corners(tower)) {
      assert.ok(isLand(x, z) && island.halfZ - Math.abs(z) >= 100, `tower at ${tower.x}, ${tower.z}`);
      assert.ok(x - islandShore(z, -1) >= 100 && islandShore(z, 1) - x >= 100, `tower at ${tower.x}, ${tower.z}`);
    }
  }
  for (const s of neonStreets()) for (const [x, z] of [[s.x0, s.z0], [s.x1, s.z0], [s.x0, s.z1], [s.x1, s.z1]]) assert.ok(isLand(x, z), s.id);
  // The runway and its safety area lie on land; beside and beyond the causeway is sea.
  for (let x = -2500; x <= 1900; x += 10) for (const z of [-50, 0, 50]) assert.ok(city.airport.isRunwaySafetyArea(x, z) && isLand(x, z), `runway at ${x}, ${z}`);
  const { causeway } = island;
  for (let x = causeway.west; x < island.west; x += 50) {
    for (let z = -1500; z <= 1500; z += 5) assert.equal(isLand(x, z), Math.abs(z) <= causeway.halfWidth, `causeway at ${x}, ${z}`);
  }
  for (const [x, z] of [[-1000, 100], [-1000, -100], [causeway.west - 1, 0], [-6000, 0], [5000, 0], [4001, 0], [2000, 2000], [1000, -1360]]) {
    assert.equal(isLand(x, z), false, `${x}, ${z}`);
    assert.equal(city.terrain.getHeight(x, z), river.waterLevel, `${x}, ${z}`);
    assert.equal(city.terrain.getWaterLevel(x, z), river.waterLevel, `${x}, ${z}`);
  }
});

test('the canal widens into the sea at both ends of the island (#628)', () => {
  // Water all the way along the canal's line, from the sea north of the island to the sea south of it.
  for (let z = -3000; z <= 3000; z += 1) assert.equal(isLand(2300, z), false, `canal at z ${z}`);
  // Straight between the towers and over the bridges, then curving out into the shore.
  for (const z of [-1100, -650, 0, 650, 1100]) assert.equal(riverHalfWidth(z), river.halfWidth);
  for (const side of [-1, 1]) {
    assert.equal(riverHalfWidth(side * island.halfZ), river.halfWidth + river.mouth);
    let previous = river.halfWidth;
    for (let z = 1100; z <= island.halfZ; z += 5) {
      assert.ok(riverHalfWidth(side * z) >= previous);
      previous = riverHalfWidth(side * z);
    }
  }
  assert.equal(isRiver(2300, 1351), false, 'beyond the shore is the sea, not the canal');
});

test('the water mirrors its own night sky rather than the dimmed daytime environment (#581)', () => {
  const { water } = createNeonRiver(), envMap = water.material.envMap;
  assert.ok(envMap?.isTexture, 'the water carries its own environment map');
  assert.equal(envMap.mapping, EquirectangularReflectionMapping);
  // Row 0 is the nadir; the upper half is the sky, its horizon brighter than the zenith.
  const { data, width, height } = envMap.image, luma = row => {
    const i = row * width * 4;
    return data[i] + data[i + 1] + data[i + 2];
  };
  assert.ok(luma(height / 2) > luma(height - 1), 'horizon brighter than zenith');
});

test('quay lights line every wall top at street level, every 20 m, off the water (#581, #628)', () => {
  const { quayLights } = createNeonRiver(), points = vertices(quayLights);
  const colors = quayLights.geometry.attributes.color;
  for (const p of points) {
    const nearWater = Array.from({ length: 16 }, (_, k) => k * Math.PI / 8).some(a => !isLand(p.x + 2 * Math.cos(a), p.z + 2 * Math.sin(a)));
    assert.ok(isLand(p.x, p.z) && nearWater && p.y > 0 && p.y < 1, `light on the quay edge at ${p.toArray()}`);
  }
  // Along each bank's shore in order, one colour per bank.
  const rows = [[], []];
  points.forEach((p, n) => rows[colors.getX(n) > 0.9 ? 0 : 1].push(p));
  for (const row of rows) {
    assert.ok(row.length > 0);
    for (let n = 1; n < row.length; n++) assert.ok(row[n].distanceTo(row[n - 1]) <= 20 + 1e-3, `gap at ${row[n].toArray()}`);
  }
  // Both quays of the canal are lit all the way through the city.
  for (const side of [-1, 1]) {
    const quay = points.filter(p => Math.abs(p.z) < 1100 && Math.sign(p.x - riverCenter(p.z)) === side
      && Math.abs(Math.abs(p.x - riverCenter(p.z)) - river.halfWidth) < 2);
    assert.ok(quay.length >= 2200 / 20, `side ${side} quay lit`);
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

test('the city terrain sinks to the water between the quay walls and around the island', () => {
  const city = new NeonCity();
  assert.equal(city.terrain.getHeight(2300, 0), river.waterLevel);
  assert.equal(city.terrain.getHeight(2300 + river.halfWidth + 1, 0), 0);
  assert.equal(city.terrain.getHeight(0, 0), 0);
  assert.equal(city.terrain.getWaterLevel(2300, 500), river.waterLevel);
  assert.equal(city.terrain.getWaterLevel(1000, 500), 0);
  assert.equal(city.terrain.getHeight(-1000, 300), river.waterLevel);
  assert.equal(city.terrain.getWaterLevel(-1000, 300), river.waterLevel);
  assert.equal(isRiver(2300, 9000), false, 'the canal ends at the shore of the island');
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

test('avenue grid lines stay on the island, short of the quay walls', () => {
  const city = new NeonCity();
  const lines = city.group.children.find(c => c.isLineSegments && c.material.color.getHex() === 0x22123d);
  const position = lines.geometry.attributes.position;
  for (let n = 0; n < position.count; n += 2) {
    const a = new Vector3().fromBufferAttribute(position, n), b = new Vector3().fromBufferAttribute(position, n + 1);
    for (let t = 0; t <= 1; t += 0.01) {
      const p = a.clone().lerp(b, t);
      assert.ok(isLand(p.x, p.z), `grid over the water at ${p.toArray()}`);
    }
  }
});

test('every aircraft collides with the bridges, the water and the shore anywhere in Neon Metropolis', () => {
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
  // The sea beside the runway causeway (#628): low over it is flying, touching it is ditching.
  assert.equal(detector.checkCollision(new Vector3(-1000, -6, 300), north, new Vector3(0, 0, -70), 0, 0, 0), null);
  assert.equal(detector.checkCollision(new Vector3(-1000, river.waterLevel + 1, 300), north, new Vector3(0, 0, -70), 0, -3, 0)?.type, 'WATER');
  // Below the street the island's shore is a wall.
  assert.ok(detector.checkCollision(new Vector3(1000, -6, island.halfZ - 5), north, new Vector3(0, 0, -70), 0, 0, 0));
});
