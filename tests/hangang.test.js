import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Scene, Box3 } from 'three';
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
