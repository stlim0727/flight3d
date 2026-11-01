import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, Euler, Scene, Box3 } from 'three';
import { HangangRun } from '../src/director/HangangRun.js';
import { HangangScenario } from '../src/director/HangangScenario.js';
import { HANGANG_COURSE as course, riverCenter } from '../src/config/hangangCourse.js';
import { lobbyBriefing } from '../src/ui/lobbyBriefing.js';
import { setLanguage } from '../src/i18n/index.js';

const q = new Quaternion(), v = new Vector3(0, 0, -46);
function step(run, x, y, z, dt = 0.05, attitude = q, options = {}) {
  run.update(new Vector3(x, y, z), attitude, v, dt, options);
}
function route(run, end = -3800) {
  for (let z = 850; z >= end && run.status === 'running'; z -= 2.3) step(run, riverCenter(z), 19, z);
}
test('three rotated bridges count exactly once and require final recovery', () => {
  const run = new HangangRun(); route(run, -3520);
  assert.equal(run.index, 3); assert.equal(run.status, 'running');
  assert.equal(run.phase, 'recovery');
  for (let z = -3522.3; z > -3800; z -= 2.3) step(run, -120, 19, z);
  assert.equal(run.status, 'complete'); assert.equal(run.clearances.length, 3);
  assert.ok(run.clearances.every(x => x > 10));
  step(run, -120, 0, -3900); assert.equal(run.index, 3);
  run.reset(); assert.equal(run.index, 0); assert.deepEqual(run.clearances, [null, null, null]);
  assert.equal(run.track.length, 0); assert.equal(run.previous, null);
});
test('centre alone crossing does not count until the tail exits', () => {
  const run = new HangangRun();
  for (let z = 30; z >= -12; z -= 1) step(run, 0, 19, z);
  assert.equal(run.index, 0); assert.equal(run.phase, 'passing');
  step(run, 0, 19, -18); assert.equal(run.index, 1);
});
test('thin deck, wing and fin contacts are detected between frames', () => {
  for (const [x, y] of [[0, 33], [49, 19]]) {
    const run = new HangangRun(); step(run, x, y, 30); step(run, x, y, -30);
    assert.equal(run.status, 'failed'); assert.equal(run.reason, 'contact'); assert.ok(run.contact.aircraftPart);
  }
});
// Flies the central gate along its own axis, `offset` metres across the river.
function centralPass(height, offset = 0) {
  const run = new HangangRun(); run.index = 1;
  const b = course.bridges[1];
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), b.yaw);
  const forward = new Vector3(0, 0, -1).applyQuaternion(yaw), across = new Vector3(1, 0, 0).applyQuaternion(yaw);
  const velocity = forward.clone().multiplyScalar(46);
  for (let s = -200; s <= 200 && !run.contact; s += 2.3) {
    run.update(new Vector3(b.x, height, b.z).addScaledVector(across, offset).addScaledVector(forward, s), yaw, velocity, 0.05);
  }
  return run;
}
test('Nodeulseom island and pavilion under the central bridge are solid', () => {
  for (const height of [11, 14]) assert.equal(centralPass(height).contact?.structure, 'pavilion');
  assert.equal(centralPass(5, 38).contact?.structure, 'island');
  for (const run of [centralPass(18), centralPass(11, 38)]) {
    assert.equal(run.contact, null); assert.equal(run.index, 2);
  }
});
test('pavilion collides where its mesh stands, not across its bounding box', () => {
  const run = new HangangRun(), island = course.nodeulseom, field = island.pavilion.heights;
  const probe = (x, z, y) => run.nodeulseomHit(new Box3().setFromCenterAndSize(
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
test('above, beside, spawn-inside, missing bridge and reversed passage fail', () => {
  for (const [x, y] of [[0, 80], [620, 19]]) {
    const run = new HangangRun(); step(run, x, y, 30); step(run, x, y, -30); assert.equal(run.status, 'failed');
  }
  const run = new HangangRun(); step(run, 0, 19, 0); step(run, 0, 19, -30); assert.equal(run.reason, 'route');
  run.reset(); run.update(new Vector3(0, 19, 100), q, v.clone().negate(), 0.05); assert.equal(run.reason, 'route');
  run.reset(); step(run, 200, 19, -1700); assert.equal(run.reason, 'route');
});
test('short envelope excursion recovers; eight continuous seconds fail', () => {
  const run = new HangangRun();
  for (let i = 0; i < 20; i++) step(run, 0, 30, 800 - i, 0.1);
  assert.equal(run.status, 'running'); assert.equal(run.warning, true);
  step(run, 0, 19, 779, 0.1); assert.equal(run.excursion, 0);
  for (let i = 0; i < 82; i++) step(run, 0, 30, 778 - i, 0.1);
  assert.equal(run.reason, 'envelope');
});
test('level flight does not require zero pitch; bank limit is phase-specific', () => {
  const run = new HangangRun();
  step(run, 0, 19, 600, 0.1, new Quaternion().setFromEuler(new Euler(0.08, 0, 0.35, 'YXZ')));
  assert.equal(run.warning, false);
  const near = new HangangRun(); step(near, 0, 19, 100, 0.1, new Quaternion().setFromEuler(new Euler(0.08, 0, 0.35, 'YXZ')));
  assert.equal(near.warning, true);
});
test('empty/duplicate courses and invalid state cannot earn a pass', () => {
  assert.throws(() => new HangangRun({ ...course, bridges: [] }));
  assert.throws(() => new HangangRun({ ...course, bridges: [course.bridges[0], course.bridges[0]] }));
  const run = new HangangRun(); step(run, NaN, 19, 100); assert.equal(run.reason, 'invalid');
  run.reset(); step(run, 0, 19, 100, 0.05, q, { autopilot: true }); assert.equal(run.reason, 'autopilot');
});
test('mission briefing overrides unrelated airport/runway instructions', () => {
  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    assert.ok(lobbyBriefing('hangang', 'hangang').join().includes('C172'));
    assert.ok(!lobbyBriefing('coastal', 'hangang').join().includes('01 → 02'));
  }
  setLanguage('en');
});

test('HangangScenario stop reconciles active airport terrain visibility', () => {
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: () => ({ addEventListener: () => {}, hidden: false }),
    createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }) })
  };
  try {
    const sim = {
      scene: new Scene(),
      activeAirport: 'incheon',
      gameFlow: { state: 'flight' },
      position: new Vector3(),
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
    };

    const hs = new HangangScenario(sim);
    hs.start();
    hs.stop();
    assert.equal(sim.incheonAirport.terrain.mesh.visible, true);
    assert.equal(sim.incheonAirport.group.visible, true);
    assert.equal(sim.currentTerrain, sim.incheonAirport.terrain);
    assert.equal(sim.currentAirport, sim.incheonAirport);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

