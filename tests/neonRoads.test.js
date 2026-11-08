import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { NEON_RIVER as river, isRiver } from '../src/config/neonRiver.js';
import { NEON_RUNWAY, bridgeFeet, bridgeFootprints, isStreet, neonStreets } from '../src/config/neonRoads.js';
import { createNeonRoads, curbRects } from '../src/environment/NeonRoads.js';
import { NeonCity } from '../src/environment/NeonCity.js';

const streets = neonStreets();
// Closed rectangles a and b share ground or an edge of positive length.
const touch = (a, b) => {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), z = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return x >= 0 && z >= 0 && x + z > 0;
};
const corners = b => {
  const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY), w = b.localWidth / 2, d = b.localDepth / 2;
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [b.x + x * c + z * s, b.z - x * s + z * c]);
};
const vertices = mesh => {
  const position = mesh.geometry.attributes.position;
  return Array.from({ length: position.count }, (_, n) => new Vector3().fromBufferAttribute(position, n));
};

test('streets stay on the street level of both banks, never over the canal', () => {
  for (const s of streets) {
    assert.ok(s.x1 > s.x0 && s.z1 > s.z0, s.id);
    for (let x = s.x0; x <= s.x1; x += 1) {
      for (const z of [s.z0, (s.z0 + s.z1) / 2, s.z1]) assert.ok(!isRiver(x, z), `${s.id} over the canal at ${x}, ${z}`);
    }
  }
});

test('streets run between the towers, at least 10 m from every footprint', () => {
  const city = new NeonCity();
  for (const tower of city.buildingData.filter(b => !b.bridge)) {
    const footprint = corners(tower), xs = footprint.map(c => c[0]), zs = footprint.map(c => c[1]);
    for (const s of streets) {
      const clear = s.x0 > Math.max(...xs) + 10 || s.x1 < Math.min(...xs) - 10 || s.z0 > Math.max(...zs) + 10 || s.z1 < Math.min(...zs) - 10;
      assert.ok(clear, `tower at ${tower.x}, ${tower.z} on ${s.id}`);
    }
  }
});

test('north-south streets stop at the runway edges instead of crossing it', () => {
  for (const s of streets) {
    const overlaps = s.x1 > NEON_RUNWAY.x0 && s.x0 < NEON_RUNWAY.x1 && s.z1 > NEON_RUNWAY.z0 && s.z0 < NEON_RUNWAY.z1;
    assert.equal(overlaps, false, s.id);
  }
  const city = new NeonCity();
  assert.equal(city.airport.isOnRunway(NEON_RUNWAY.x1, NEON_RUNWAY.z1), true);
  assert.equal(city.airport.isOnRunway(NEON_RUNWAY.x1 + 1, 0), false);
});

test('every bridge ramp foot meets a street of the deck width on both banks', () => {
  for (const bridge of river.bridges) {
    const feet = bridgeFeet(bridge), z0 = bridge.z - bridge.width / 2, z1 = bridge.z + bridge.width / 2;
    feet.forEach((foot, i) => {
      // The approach ends at the foot and runs away from the canal.
      const approach = streets.find(s => (i === 0 ? s.x1 : s.x0) === foot && s.z0 === z0 && s.z1 === z1);
      assert.ok(approach, `${bridge.id} ${i === 0 ? 'west' : 'east'} foot at ${foot}`);
      assert.ok(i === 0 ? approach.x0 < foot : approach.x1 > foot);
    });
  }
});

test('the streets, the runway and the bridges form one connected network', () => {
  const nodes = [NEON_RUNWAY, ...streets, ...bridgeFootprints()];
  const reached = new Set([NEON_RUNWAY]), queue = [NEON_RUNWAY];
  while (queue.length) {
    const node = queue.shift();
    for (const other of nodes) if (!reached.has(other) && touch(node, other)) reached.add(other), queue.push(other);
  }
  assert.deepEqual(nodes.filter(n => !reached.has(n)).map(n => n.id), []);
  // Both banks have streets, and only the bridges join them.
  const west = streets.filter(s => s.x1 < river.x), east = streets.filter(s => s.x0 > river.x);
  assert.equal(west.length + east.length, streets.length);
  assert.ok(west.length > 4 && east.length > 4);
  assert.equal(west.some(w => east.some(e => touch(w, e))), false);
});

test('the runway highway runs on to the arch bridge and the avenue continues east of it', () => {
  const arch = river.bridges.find(b => b.id === 'arch'), [west, east] = bridgeFeet(arch);
  assert.ok(streets.some(s => s.x0 === NEON_RUNWAY.x1 && s.x1 === west), 'runway end to the west foot');
  assert.ok(streets.some(s => s.x0 === east && s.x1 > 3500), 'east foot to the east edge of the city');
});

test('road surfaces and curbs are subdivided and lie flat on the streets', () => {
  const roads = createNeonRoads();
  for (const mesh of [roads.surface, roads.curbs]) {
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let n = 0; n < index.count; n += 3) {
      const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(n + k)));
      assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 200, `${mesh.name} triangle at ${a.toArray()}`);
    }
    for (const p of vertices(mesh)) assert.ok(isStreet(p.x, p.z, 1e-6), `${mesh.name} vertex off the streets at ${p.toArray()}`);
  }
  assert.ok(vertices(roads.surface).every(p => p.y === Math.fround(0.04)) && vertices(roads.curbs).every(p => p.y === Math.fround(0.08)));
});

test('curbs leave junctions and ramp feet open', () => {
  const curbs = curbRects();
  const open = (x, z) => !curbs.some(([x0, x1, z0, z1]) => x >= x0 - 1.5 && x <= x1 + 1.5 && z >= z0 - 1.5 && z <= z1 + 1.5);
  // The middle of crossings, T-junctions and every bridge foot carry no curb line.
  assert.ok(open(1880, 0), 'crossing east of the runway');
  assert.ok(open(1880, 540) && open(2720, -870), 'T-junctions');
  assert.ok(open(500, 30), 'street meeting the runway');
  for (const bridge of river.bridges) for (const foot of bridgeFeet(bridge)) assert.ok(open(foot, bridge.z), `${bridge.id} foot ${foot}`);
  // Outer edges keep theirs, round the corners too.
  assert.ok(!open(500 - 10 + 0.6, 300), 'west edge of the westernmost street');
  assert.ok(!open(500 - 10 + 0.6, 875) && !open(495, 880 - 0.6), 'north-west corner');
});

test('street lamps along the highway stand clear of the streets crossing it', () => {
  const city = new NeonCity();
  const lamps = city.group.children.find(c => c.isMesh && c.material.color?.getHex() === 0xffd290);
  const heads = vertices(lamps).filter(p => p.y > 11);
  assert.ok(heads.length > 0);
  for (const p of heads) assert.ok(!isStreet(p.x, p.z), `lamp on a street at ${p.toArray()}`);
});
