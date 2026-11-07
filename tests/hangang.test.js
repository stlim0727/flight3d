import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { HangangCollision } from '../src/director/HangangCollision.js';
import { HangangScenario } from '../src/director/HangangScenario.js';
import { HANGANG_COURSE as course, bridgeApproaches, courseToWorld, riverCenter, worldToCourse } from '../src/config/hangangCourse.js';
import { lobbyBriefing } from '../src/ui/lobbyBriefing.js';
import { setLanguage, t } from '../src/i18n/index.js';

// Course-frame poses, placed in the Neon Metropolis world the way the bridge flight flies.
const up = new Vector3(0, 1, 0), frameTurn = new Quaternion().setFromAxisAngle(up, course.frame.yaw);
const q = new Quaternion();
function worldPose(x, y, z, attitude = q) {
  const [wx, wz] = courseToWorld(x, z);
  return [new Vector3(wx, y, wz), frameTurn.clone().multiply(attitude)];
}
function step(collision, x, y, z, attitude = q) {
  return collision.update(...worldPose(x, y, z, attitude));
}

test('the course frame places the river along the south of the skyline, flying east', () => {
  const [x, z] = courseToWorld(12, -340);
  assert.deepEqual(worldToCourse(x, z).map(v => Math.round(v * 1e6) / 1e6), [12, -340]);
  // Course -Z is world +X, course +X is world +Z.
  const origin = courseToWorld(0, 0), east = courseToWorld(0, -100), north = courseToWorld(100, 0);
  assert.ok(Math.abs(east[0] - origin[0] - 100) < 1e-9 && Math.abs(east[1] - origin[1]) < 1e-9);
  assert.ok(Math.abs(north[1] - origin[1] - 100) < 1e-9 && Math.abs(north[0] - origin[0]) < 1e-9);
  // Clear of the runway (|z| <= 30) by more than a kilometre.
  for (const z of [1200, 0, -1080, -3730, -6500]) assert.ok(courseToWorld(riverCenter(z) + course.halfWidth, z)[1] < -1000, `bank at ${z}`);
});
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
  // Girder soffit at 34 m; Seogang's main-span piers stand at x = ±75 m (columns from 71 m).
  for (const [x, y] of [[0, 33], [69, 19]]) {
    const collision = new HangangCollision(); step(collision, x, y, 30);
    const contact = step(collision, x, y, -30);
    assert.equal(contact.bridge, 'seogang'); assert.ok(contact.aircraftPart);
  }
});
test('approach ramps past the deck ends are solid (#429)', () => {
  // 100 m down Seogang's east ramp, crossing the road below and above its surface.
  const east = bridgeApproaches(course.bridges[0])[1], x = east.start + 100, top = east.top(x);
  const cross = y => { const collision = new HangangCollision(); step(collision, x, y, 40); return step(collision, x, y, -40); };
  assert.equal(cross(top - 2)?.structure, 'approach');
  assert.equal(cross(top + 8), null);
});
// Crosses bridge `index` level, along its own deck-crossing axis, at bridge-local x
// and height y; returns the first contact.
function deckCrossing(index, x, y) {
  const collision = new HangangCollision(), b = course.bridges[index];
  const yaw = new Quaternion().setFromAxisAngle(up, b.yaw);
  for (let s = 40; s >= -40 && !collision.contact; s -= 2.3) {
    const p = new Vector3(x, y, s).applyQuaternion(yaw).add(new Vector3(b.x, 0, b.z));
    step(collision, p.x, p.y, p.z, yaw);
  }
  return collision.contact;
}
test('deck streetlights and arch ribs are solid (#395)', () => {
  // Lamps (to 43.8 m) stand every 55 m from the centre on both edges of every deck.
  for (const index of [0, 1, 2]) {
    assert.equal(deckCrossing(index, 0, 44)?.structure, 'lamp');
    assert.equal(deckCrossing(index, 27.5, 44), null, 'between lamps');
    assert.equal(deckCrossing(index, 0, 46), null, 'above the lamps');
  }
  // Seogang's Nielsen arch: ribs lean from x = ±75 m to meet near the deck axis at 67 m
  // (tube radius 1.4 m); at x = ±50 m they are 54 m high and 7 m off the axis.
  assert.equal(deckCrossing(0, 0, 67)?.structure, 'arch');
  assert.equal(deckCrossing(0, -50, 54)?.structure, 'arch');
  assert.equal(deckCrossing(0, 50, 54)?.structure, 'arch');
  for (const [x, y] of [[0, 72], [0, 55], [-100, 50]]) assert.equal(deckCrossing(0, x, y), null, `under/over arch ${x} ${y}`);
  // Hangang Bridge's tied arches (crown 52 m) stand over the south channel only.
  assert.equal(deckCrossing(2, 127, 52)?.structure, 'arch');
  for (const [x, y] of [[127, 46], [127, 56], [0, 52], [-127, 52]]) assert.equal(deckCrossing(2, x, y), null, `tied arch ${x} ${y}`);
  // Mapo has no arch.
  assert.equal(deckCrossing(1, 0, 67), null);
});
test('the river is water and the banks are city ground', () => {
  assert.equal(step(new HangangCollision(), riverCenter(600), 0.5, 600)?.structure, 'water');
  assert.equal(step(new HangangCollision(), riverCenter(600) + course.halfWidth + 200, 0.5, 600)?.structure, 'ground');
  assert.equal(step(new HangangCollision(), riverCenter(600), 3, 600), null);
});
test('malformed samples and teleports never switch collision off', () => {
  const collision = new HangangCollision();
  assert.equal(step(collision, NaN, 19, 100), null);
  assert.equal(collision.update(new Vector3(0, 19, 100), new Quaternion(0, 0, 0, 2)), null);
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
test('bridge briefing describes free flight and stays out of other airports', () => {
  for (const lang of ['en', 'ko']) {
    setLanguage(lang);
    const briefing = lobbyBriefing('neon', 'bridge');
    assert.equal(briefing[0], t('neon.metropolis'));
    assert.ok(briefing.join().includes('C172'));
    assert.ok(briefing.includes(t('lobby.briefing.scenario.bridge')));
    for (const airport of ['coastal', 'incheon', 'lukla']) assert.ok(!lobbyBriefing(airport, 'bridge').includes(t('lobby.briefing.scenario.bridge')));
  }
  setLanguage('en');
});

function scenarioSim() {
  const sim = {
    position: new Vector3(), quaternion: new Quaternion(), linearVelocity: new Vector3(),
    aero: { windWorld: new Vector3(4, 0, -2) }, cameraSystem: { trauma: 1 }, isCrashed: false, crashes: [],
  };
  sim.triggerCrash = result => { sim.crashes.push(result); sim.isCrashed = true; };
  return sim;
}

test('bridge flight holds calm wind while active and restores the wind after', () => {
  const sim = scenarioSim(), scenario = new HangangScenario(sim);
  scenario.start();
  assert.equal(scenario.active, true);
  assert.deepEqual(sim.aero.windWorld.toArray(), [0, 0, 0]);
  assert.equal(sim.cameraSystem.trauma, 0);
  // A restart keeps the wind that was set before the flight.
  scenario.start(); scenario.stop();
  assert.equal(scenario.active, false);
  assert.deepEqual(sim.aero.windWorld.toArray(), [4, 0, -2]);
  scenario.stop(); assert.deepEqual(sim.aero.windWorld.toArray(), [4, 0, -2]);
});

test('bridge flight crashes only on contact and restarts collision on start', () => {
  const sim = scenarioSim(), scenario = new HangangScenario(sim);
  scenario.start();
  // Well above the former 28 m ceiling for longer than the former 8 s excursion.
  for (let i = 0; i < 400; i++) {
    const [p, r] = worldPose(0, 60, 800 - i * 2.3);
    sim.position.copy(p); sim.quaternion.copy(r); scenario.update(0.05);
  }
  assert.equal(sim.crashes.length, 0);
  const [p] = worldPose(0, 0.5, -200);
  sim.position.copy(p); scenario.update(0.05);
  assert.equal(sim.crashes.length, 1); assert.equal(sim.crashes[0].type, 'WATER');
  scenario.update(0.05); assert.equal(sim.crashes.length, 1);
  sim.isCrashed = false; scenario.start(); assert.equal(scenario.collision.contact, null);
});
