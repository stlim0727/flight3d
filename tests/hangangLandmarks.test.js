import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Euler, Quaternion, Vector3 } from 'three';
import { HANGANG_BEACONS, HANGANG_LANDMARKS, shapeBounds } from '../src/config/hangangLandmarks.js';
import { riverCenter } from '../src/config/hangangCourse.js';
import { HangangCollision } from '../src/director/HangangCollision.js';
import { HangangScenario } from '../src/director/HangangScenario.js';
import { createLandmarkStandIns, createSeoulScenery } from '../src/environment/SeoulLandmarks.js';
import { readGlbTriangles } from '../scripts/lib/nodeul-pavilion-heights.mjs';

const TOLERANCE = 0.05;
function contains(shape, p) {
  if (shape.kind === 'box') return [0, 1, 2].every(i => p.getComponent(i) >= shape.min[i] - TOLERANCE && p.getComponent(i) <= shape.max[i] + TOLERANCE);
  if (p.y < shape.y0 - TOLERANCE || p.y > shape.y1 + TOLERANCE) return false;
  const t = Math.max(0, Math.min(1, (p.y - shape.y0) / (shape.y1 - shape.y0)));
  return Math.hypot(p.x - shape.x, p.z - shape.z) <= shape.r0 + (shape.r1 - shape.r0) * t + TOLERANCE;
}
const landmark = id => HANGANG_LANDMARKS.find(l => l.id === id);

test('every shipped landmark triangle lies inside one collision proxy, and every proxy touches its geometry', () => {
  for (const { id, asset, shapes } of HANGANG_LANDMARKS.filter(l => l.asset)) {
    const triangles = readGlbTriangles(readFileSync(new URL(`../public/models/hangang/${asset}.glb`, import.meta.url)));
    assert.ok(triangles.length > 100, asset);
    // Proxies are convex, so a triangle with all three corners in one proxy lies inside it.
    const covered = shapes.map(() => new Box3());
    for (const tri of triangles) {
      const holders = shapes.flatMap((shape, k) => tri.every(p => contains(shape, p)) ? [k] : []);
      assert.ok(holders.length, `${asset}: triangle ${tri.map(p => p.toArray().map(v => v.toFixed(1)).join(',')).join(' / ')} outside every proxy`);
      for (const k of holders) for (const p of tri) covered[k].expandByPoint(p);
    }
    // No invisible walls: each proxy's bounds are those of the triangles it holds.
    shapes.forEach((shape, k) => {
      const [min, max] = shapeBounds(shape);
      assert.ok(!covered[k].isEmpty(), `${id} ${shape.part} #${k} holds no geometry`);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(covered[k].min.getComponent(i) - min[i]) < 0.5 && Math.abs(covered[k].max.getComponent(i) - max[i]) < 0.5,
          `${id} ${shape.part} #${k} axis ${i}: drawn ${covered[k].min.getComponent(i).toFixed(2)}..${covered[k].max.getComponent(i).toFixed(2)}, proxy ${min[i]}..${max[i]}`);
      }
    });
  }
});

test('beacons drawn by the scenery are collision proxies', () => {
  const { group } = createSeoulScenery();
  const beacons = landmark('beacons').shapes;
  assert.equal(beacons.length, HANGANG_BEACONS.positions.length);
  for (const [x, y, z] of HANGANG_BEACONS.positions) {
    const mesh = group.children.find(o => o.isMesh && o.position.x === x && o.position.y === y && o.position.z === z);
    assert.ok(mesh, `beacon ${x},${y},${z}`);
    const drawn = new Box3().setFromObject(mesh);
    assert.ok(beacons.some(s => drawn.min.distanceTo(new Vector3(...s.min)) < 1e-6 && drawn.max.distanceTo(new Vector3(...s.max)) < 1e-6));
  }
});

test('landmark stand-ins draw exactly the proxies until their GLBs load', () => {
  const standIns = createLandmarkStandIns();
  assert.deepEqual([...standIns.keys()].sort(), ['lotte-tower', 'namsan-tower', 'yeouido-landmarks']);
  for (const { asset, shapes } of HANGANG_LANDMARKS.filter(l => l.asset)) {
    const proxy = shapes.reduce((b, s) => b.union(new Box3(new Vector3(...shapeBounds(s)[0]), new Vector3(...shapeBounds(s)[1]))), new Box3());
    const mesh = standIns.get(asset);
    mesh.geometry.computeBoundingBox();
    assert.ok(mesh.geometry.boundingBox.min.distanceTo(proxy.min) < 0.01 && mesh.geometry.boundingBox.max.distanceTo(proxy.max) < 0.01, asset);
  }
  // Headless loads never finish, so the scenery keeps its stand-ins visible.
  const { group } = createSeoulScenery();
  for (const asset of standIns.keys()) assert.equal(group.getObjectByName(`${asset} stand-in`).visible, true, asset);
});

const level = new Quaternion();
function fly(collision, from, to, attitude = level, step = 2) {
  const a = new Vector3(...from), b = new Vector3(...to), n = Math.ceil(a.distanceTo(b) / step);
  for (let i = 0; i <= n; i++) {
    const contact = collision.update(a.clone().lerp(b, i / n), attitude);
    if (contact) return contact;
  }
  return null;
}

test('flying into Yeouido towers, the highrises and Lotte World Tower is a building contact', () => {
  for (const [from, to, part] of [
    [[650, 120, -350], [850, 120, -350], '63-building'],
    [[910, 300, 0], [910, 300, -250], 'parc1'],
    [[1200, 250, -120], [1000, 250, -120], 'ifc'],
    [[740, 200, -85], [740, 140, -85], 'lg-twin-towers'],
    [[780, 20, 700], [780, 20, 400], 'national-assembly'],
    [[2100, 300, -6400], [2300, 300, -6400], 'lotte-tower'],
    [[2200, 650, -6400], [2200, 560, -6400], 'lotte-tower'],
  ]) {
    const contact = fly(new HangangCollision(), from, to);
    assert.equal(contact?.structure, 'building', `${part}: ${JSON.stringify(contact)}`);
    assert.equal(contact.part, part);
  }
  // A Yeouido highrise: aim at the first one's centre from the river side.
  const [first] = HANGANG_LANDMARKS[0].shapes.filter(s => s.part === 'highrise');
  const y = (first.min[1] + first.max[1]) / 2, z = (first.min[2] + first.max[2]) / 2;
  assert.equal(fly(new HangangCollision(), [500, y, z], [first.max[0], y, z])?.part, 'highrise');
});

test('Namsan hill is ground and N Seoul Tower a building', () => {
  // The gear's padded bottom, 1.8 m below the aircraft at 120 m, meets the 680 m cone
  // 680 * (1 - 118.2 / 243) = 349 m from its axis.
  const hill = fly(new HangangCollision(), [-1550 + 900, 120, -2100], [-1550 + 200, 120, -2100], level, 0.5);
  assert.equal(hill.structure, 'hill');
  assert.ok(Math.abs(hill.position[0] - (-1550 + 349)) < 3, `${hill.position[0]}`);
  assert.equal(fly(new HangangCollision(), [-1550 + 900, 160, -2100], [-1550 + 100, 160, -2100])?.structure, 'hill');
  assert.equal(fly(new HangangCollision(), [-1550 + 100, 420, -2100], [-1550 - 100, 420, -2100])?.part, 'n-seoul-tower');
  // Clear above the antenna, and alongside it.
  assert.equal(fly(new HangangCollision(), [-1550 + 100, 490, -2100], [-1550 - 100, 490, -2100]), null);
  assert.equal(fly(new HangangCollision(), [-1550 + 100, 420, -2100 + 12], [-1550 - 100, 420, -2100 + 12]), null);
});

test('gaps, overflights and the river stay clear of the landmarks', () => {
  for (const [from, to] of [
    // High over Yeouido, and low over the Assembly hall.
    [[650, 360, -500], [1150, 360, 600]],
    [[700, 60, 520], [860, 60, 520]],
    // Along the river past every landmark.
    ...[[1200, 0], [0, -1080], [-1080, -3730], [-3730, -6500]].map(([z0, z1]) => [[riverCenter(z0), 19, z0], [riverCenter(z1), 19, z1]]),
  ]) assert.equal(fly(new HangangCollision(), from, to), null, JSON.stringify(from));
});

test('a banked wing passing a tower face hits only when its tip reaches the face', () => {
  // 60° right bank: the padded low wing tip reaches about 4.1 m toward -X.
  // 63 Building's east face is at x = 804.5.
  const bank = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 3));
  assert.equal(fly(new HangangCollision(), [809, 120, -320], [809, 120, -380], bank, 1), null);
  const contact = fly(new HangangCollision(), [808, 120, -320], [808, 120, -380], bank, 1);
  assert.deepEqual([contact?.part, contact?.aircraftPart], ['63-building', 'wing']);
});

test('HangangScenario reports Namsan as terrain and towers as buildings', () => {
  for (const [structure, type] of [['hill', 'TERRAIN'], ['building', 'BUILDING']]) {
    let crash = null;
    const scenario = Object.create(HangangScenario.prototype);
    Object.assign(scenario, {
      saved: {}, scene: {},
      collision: { update: () => ({ structure, aircraftPart: 'wing', position: [0, 0, 0] }) },
      sim: { isCrashed: false, position: new Vector3(), quaternion: new Quaternion(), linearVelocity: new Vector3(40, 0, 0), triggerCrash: c => { crash = c; } },
    });
    scenario.update(0.016);
    assert.equal(crash?.type, type, structure);
  }
});
