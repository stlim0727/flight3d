import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Scene, Box3, Euler, Matrix4 } from 'three';
import { HangangCollision } from '../src/director/HangangCollision.js';
import { HangangScenario } from '../src/director/HangangScenario.js';
import { HANGANG_COURSE as course, riverCenter } from '../src/config/hangangCourse.js';
import { lobbyBriefing } from '../src/ui/lobbyBriefing.js';
import { setLanguage, t } from '../src/i18n/index.js';

const q = new Quaternion();
function step(collision, x, y, z, attitude = q) {
  return collision.update(new Vector3(x, y, z), attitude);
}
test('flying the river under all three bridges makes no contact', () => {
  const collision = new HangangCollision();
  for (let z = 850; z >= -3800; z -= 2.3) assert.equal(step(collision, riverCenter(z), 19, z), null, `z ${z}`);
});
test('route, direction, altitude band and duration are not judged (#391)', () => {
  // Over the deck, against the course direction, starting past a bridge.
  for (const path of [[[0, 80, 30], [0, 80, -30]], [[0, 19, -30], [0, 19, 30]], [[-120, 19, -3000], [-120, 19, -3800]]]) {
    const collision = new HangangCollision();
    for (const p of path) assert.equal(step(collision, ...p), null, JSON.stringify(path));
  }
  // Ten minutes of slow, high circling far beyond any former time or envelope limit.
  const collision = new HangangCollision();
  for (let i = 0; i < 12000; i++) {
    const a = i * 0.002;
    assert.equal(step(collision, 150 * Math.sin(a), 60, 600 + 150 * Math.cos(a)), null);
  }
});
test('thin deck, wing and fin contacts are detected between frames', () => {
  for (const [x, y] of [[0, 33], [49, 19]]) {
    const collision = new HangangCollision(); step(collision, x, y, 30);
    const contact = step(collision, x, y, -30);
    assert.equal(contact.bridge, 'west'); assert.ok(contact.aircraftPart);
  }
});
// Flies the central opening along its own axis, `offset` metres across the river.
function centralPass(height, offset = 0) {
  const collision = new HangangCollision();
  const b = course.bridges[1];
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b.yaw);
  const forward = new Vector3(0, 0, -1).applyQuaternion(yaw), across = new Vector3(1, 0, 0).applyQuaternion(yaw);
  for (let s = -200; s <= 200 && !collision.contact; s += 2.3) {
    collision.update(new Vector3(b.x, height, b.z).addScaledVector(across, offset).addScaledVector(forward, s), yaw);
  }
  return collision;
}
test('Nodeulseom island and pavilion under the central bridge are solid', () => {
  for (const height of [11, 14]) assert.equal(centralPass(height).contact?.structure, 'pavilion');
  assert.equal(centralPass(5, 38).contact?.structure, 'island');
  for (const collision of [centralPass(18), centralPass(11, 38)]) assert.equal(collision.contact, null);
});
test('pavilion collides where its mesh stands, not across its bounding box', () => {
  const collision = new HangangCollision(), island = course.nodeulseom, field = island.pavilion.heights;
  const probe = (x, z, y) => collision.nodeulseomHit(new Box3().setFromCenterAndSize(
    new Vector3(island.x + x, y, island.z + z), new Vector3(0.4, 0.4, 0.4)));
  let roofs = 0, open = 0;
  field.heights.forEach((top, k) => {
    const x = field.x0 + (k % field.cols + 0.5) * field.cell, z = field.z0 + (Math.floor(k / field.cols) + 0.5) * field.cell;
    if (top > island.height + 1) {
      roofs++; assert.equal(probe(x, z, top - 0.3), 'pavilion'); assert.equal(probe(x, z, top + 0.3), null);
    } else if (Math.abs(x) < 22.5 && Math.abs(z) < 40) {
      // Inside the former 45 x 80 m box, but only plaza or bare island here.
      open++; assert.equal(probe(x, z, 8), null);
    }
  });
  assert.ok(roofs > 800, `roof cells ${roofs}`); assert.ok(open > 800, `open cells ${open}`);
  assert.ok(field.top > 15 && field.top < 15.5, `roof top ${field.top}`);
  assert.equal(probe(0, 0, field.top + 0.3), null);
});
// Crosses bridge `index` level, along its own deck-crossing axis, at bridge-local x
// and height y; returns the first contact.
function deckCrossing(index, x, y) {
  const collision = new HangangCollision(), b = course.bridges[index];
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b.yaw);
  for (let s = 30; s >= -30 && !collision.contact; s -= 2.3) {
    collision.update(new Vector3(x, y, s).applyQuaternion(yaw).add(new Vector3(b.x, 0, b.z)), yaw);
  }
  return collision.contact;
}
test('deck streetlights and the central arch are solid (#395)', () => {
  // Lamps (to 43.8 m) stand every 55 m on both deck edges of every bridge.
  for (const index of [0, 1, 2]) {
    assert.equal(deckCrossing(index, 0, 44)?.structure, 'lamp');
    assert.equal(deckCrossing(index, 27.5, 44), null, 'between lamps');
    assert.equal(deckCrossing(index, 0, 46), null, 'above the lamps');
  }
  // Arch (centreline 76 m at x = 0, tube radius 1.4 m) spans x = -150..150 on the central bridge.
  assert.equal(deckCrossing(1, 0, 75)?.structure, 'arch');
  assert.equal(deckCrossing(1, -95, 60)?.structure, 'arch');
  assert.equal(deckCrossing(1, 95, 60)?.structure, 'arch');
  for (const [x, y] of [[0, 80], [0, 60], [27.5, 66], [-175, 50]]) assert.equal(deckCrossing(1, x, y), null, `under/over arch ${x} ${y}`);
  // Arch is central-only: the same crossing over the other bridges is clear.
  for (const index of [0, 2]) assert.equal(deckCrossing(index, 0, 75), null);
});

// Reference for #395: sample the faces of every padded part box at `step` metres and test
// each sample against the pavilion cells, optionally grown by `grow` metres.
const PARTS = [[[-0.65, -0.55, -2.9], [0.65, 1.1, 4.6]], [[-5.8, 0.70, -1.3], [5.8, 1.15, 1]],
  [[-2.1, 0.3, 3.1], [2.1, 0.85, 4.6]], [[-0.3, 0.5, 3], [0.3, 2.4, 4.6]], [[-1.3, -1.65, -1.8], [1.3, -0.3, 1]]];
function sampledPavilionHit(matrix, step, grow) {
  const island = course.nodeulseom, field = island.pavilion.heights, p = new Vector3();
  const inCells = (x, y, z) => {
    const fx = x - island.x - field.x0, fz = z - island.z - field.z0;
    for (let j = Math.floor((fz - grow) / field.cell); j <= Math.floor((fz + grow) / field.cell); j++) {
      for (let i = Math.floor((fx - grow) / field.cell); i <= Math.floor((fx + grow) / field.cell); i++) {
        if (i >= 0 && j >= 0 && i < field.cols && j < field.rows && field.heights[j * field.cols + i] + grow >= y) return true;
      }
    }
    return false;
  };
  for (const [lo, hi] of PARTS) {
    const min = lo.map(v => v - 0.15), max = hi.map(v => v + 0.15);
    for (let axis = 0; axis < 3; axis++) {
      const [a, b] = [0, 1, 2].filter(k => k !== axis);
      const na = Math.ceil((max[a] - min[a]) / step), nb = Math.ceil((max[b] - min[b]) / step);
      for (const side of [min[axis], max[axis]]) {
        for (let ia = 0; ia <= na; ia++) {
          for (let ib = 0; ib <= nb; ib++) {
            const v = [0, 0, 0];
            v[axis] = side; v[a] = min[a] + (max[a] - min[a]) * ia / na; v[b] = min[b] + (max[b] - min[b]) * ib / nb;
            p.set(...v).applyMatrix4(matrix);
            if (inCells(p.x, p.y, p.z)) return true;
          }
        }
      }
    }
  }
  return false;
}
test('banked pavilion contact matches the surface-sampled aircraft (#395)', () => {
  const island = course.nodeulseom, matrix = new Matrix4(), unit = new Vector3(1, 1, 1);
  let seed = 395;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (const bank of [12, 20, 29]) {
    let hits = 0, clear = 0, decided = 0, boxOnly = 0;
    for (let n = 0; n < 320; n++) {
      const roll = (random() < 0.5 ? -1 : 1) * bank * Math.PI / 180;
      const attitude = new Quaternion().setFromEuler(new Euler((random() - 0.5) * 0.15, random() * 2 * Math.PI, roll, 'YXZ'));
      const position = new Vector3(island.x + (random() - 0.5) * 60, 6 + random() * 12, island.z + (random() - 0.5) * 60);
      matrix.compose(position, attitude, unit);
      // Keep every part above the island top and plaza, so only the pavilion can be hit.
      const lowest = Math.min(...PARTS.flatMap(([lo, hi]) => [0, 1, 2, 3, 4, 5, 6, 7].map(c =>
        new Vector3(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]).applyMatrix4(matrix).y))) - 0.4;
      if (lowest < 4.5) continue;
      const collision = new HangangCollision();
      const hit = collision.update(position, attitude)?.structure === 'pavilion';
      const exact = sampledPavilionHit(matrix, 0.1, 0), loose = sampledPavilionHit(matrix, 0.1, 0.1);
      // A sampled hit is a real hit; a hit must at least graze within the sample spacing.
      if (exact) assert.ok(hit, `bank ${bank} pose ${n} missed`);
      if (hit) assert.ok(loose, `bank ${bank} pose ${n} hit clear air`);
      if (exact === loose) decided++;
      hit ? hits++ : clear++;
      // The former world-AABB test: its lowest corner against every overlapped cell.
      const field = island.pavilion.heights, box = new Box3();
      const aabbHit = PARTS.some(([lo, hi]) => {
        box.set(new Vector3(...lo), new Vector3(...hi)).applyMatrix4(matrix).expandByScalar(0.15);
        return collision.pavilionHit(box);
      });
      if (aabbHit && !loose) boxOnly++;
    }
    assert.ok(hits > 20 && clear > 20 && decided > hits + clear - 10, `bank ${bank}: ${hits} hits, ${clear} clear, ${decided} decided`);
    assert.ok(boxOnly > 0, `bank ${bank}: the former AABB test over-reports`);
  }
});
test('malformed samples and teleports never switch collision off', () => {
  const collision = new HangangCollision();
  assert.equal(step(collision, NaN, 19, 100), null);
  assert.equal(step(collision, 0, 19, 100, new Quaternion(0, 0, 0, 2)), null);
  // An 820 m jump tests only the new pose; the following deck strike still counts.
  step(collision, 0, 33, 850); step(collision, 0, 33, 30);
  assert.equal(step(collision, 0, 33, -30)?.structure, 'girder');
});
test('first contact is kept until reset', () => {
  const collision = new HangangCollision();
  const contact = step(collision, 0, 0.5, 600);
  assert.equal(contact.structure, 'water');
  assert.equal(step(collision, 0, 19, 500), contact);
  collision.reset(); assert.equal(collision.contact, null); assert.equal(collision.previous, null);
  assert.equal(step(collision, 0, 19, 500), null);
  assert.throws(() => new HangangCollision({ ...course, bridges: [{ ...course.bridges[0], x: NaN }] }));
});
test('briefing describes free flight and stays out of unrelated airports', () => {
  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    const briefing = lobbyBriefing('hangang', 'hangang').join();
    assert.ok(briefing.includes('C172'));
    assert.ok(!briefing.includes('01 → 02'));
    assert.ok(!lobbyBriefing('coastal', 'hangang').join().includes(t('hangang.briefing')));
  }
  setLanguage('en');
});

function withSim(run) {
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: () => ({ addEventListener: () => {}, hidden: false }),
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) })
  };
  try {
    run({
      scene: new Scene(),
      activeAirport: 'incheon',
      gameFlow: { state: 'flight' },
      position: new Vector3(),
      quaternion: new Quaternion(),
      linearVelocity: new Vector3(),
      terrain: { mesh: { visible: false } },
      airport: { group: { visible: false } },
      water: { mesh: { visible: true } },
      ships: { group: { visible: false } },
      foliage: { group: { visible: false } },
      neonCity: { group: { visible: false } },
      incheonAirport: {
        group: { visible: false },
        terrain: { mesh: { visible: false } }
      },
      collisionDetector: {
        setEnvironment: () => {},
        terrain: null, airport: null, foliage: null, ships: null, water: null
      },
      sky: { timeOfDay: 12 },
      aero: { windWorld: new Vector3() },
      cameraSystem: { towerPos: new Vector3() },
      setTimeOfDay: () => {}
    });
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
}

test('HangangScenario stop reconciles active airport terrain visibility', () => {
  withSim(sim => {
    const hs = new HangangScenario(sim);
    hs.start();
    hs.stop();
    assert.equal(sim.incheonAirport.terrain.mesh.visible, true);
    assert.equal(sim.incheonAirport.group.visible, true);
    assert.equal(sim.currentTerrain, sim.incheonAirport.terrain);
    assert.equal(sim.currentAirport, sim.incheonAirport);
  });
});

test('HangangScenario crashes only on contact and restarts collision on start', () => {
  withSim(sim => {
    const crashes = [];
    sim.isCrashed = false;
    sim.triggerCrash = result => { crashes.push(result); sim.isCrashed = true; };
    const hs = new HangangScenario(sim);
    hs.start();
    // Well above the former 28 m ceiling for longer than the former 8 s excursion.
    for (let i = 0; i < 400; i++) { sim.position.set(0, 60, 800 - i * 2.3); hs.update(0.05); }
    assert.equal(crashes.length, 0);
    sim.position.set(0, 0.5, -200); hs.update(0.05);
    assert.equal(crashes.length, 1); assert.equal(crashes[0].type, 'WATER');
    hs.update(0.05); assert.equal(crashes.length, 1);
    sim.isCrashed = false; hs.start(); assert.equal(hs.collision.contact, null);
  });
});
