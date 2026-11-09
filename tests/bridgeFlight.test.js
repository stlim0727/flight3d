import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { BridgeCollision } from '../src/director/BridgeCollision.js';
import { BridgeFlightScenario } from '../src/director/BridgeFlightScenario.js';
import { NEON_ISLAND as island, NEON_RIVER as river, archCentre, bridgeOpening, bridgeRamps, bridgeToWorld, isLand, riverCenter } from '../src/config/neonRiver.js';
import { lobbyBriefing } from '../src/ui/lobbyBriefing.js';
import { setLanguage, t } from '../src/i18n/index.js';

const level = new Quaternion();
const bridge = id => river.bridges.find(b => b.id === id);
// Flies level from z0 to z1 at world x and height y; returns the first contact.
function fly(x, y, z0, z1, attitude = level) {
  const collision = new BridgeCollision(), step = Math.sign(z1 - z0) * 2.3;
  for (let z = z0; (z1 - z) * Math.sign(step) >= 0 && !collision.contact; z += step) collision.update(new Vector3(x, y, z), attitude);
  return collision.contact;
}
// Crosses bridge `id` along the river at bridge-local x and height y.
function crossing(id, x, y) {
  const b = bridge(id), [wx, wz] = bridgeToWorld(b, x, 0);
  return fly(wx, y, wz + 40, wz - 40);
}

test('the canal crosses the city at right angles to the runway, below the street', () => {
  // The runway runs 090° along z = 0 from x = -2400 to 1800; the canal runs along Z east of it.
  for (const z of [-1500, -650, 0, 650, 1500]) assert.equal(riverCenter(z), 2300);
  assert.ok(riverCenter(0) - river.halfWidth > 1800 + 300);
  assert.ok(river.waterLevel <= -10);
  // North (-Z) from the spawn the flight meets the cable-stayed, arch and light bridges in turn.
  assert.deepEqual([...river.bridges].sort((a, b) => b.z - a.z).map(b => b.id), ['cable', 'arch', 'light']);
  assert.ok(river.bridges.every(b => b.z < river.spawn[2]));
  // The flight starts over the sea south of the island, short of the canal's mouth (#628).
  assert.ok(!isLand(river.spawn[0], river.spawn[2]) && river.spawn[2] > island.halfZ);
});
test('flying the canal under all three bridges makes no contact', () => {
  assert.equal(fly(river.spawn[0], river.spawn[1], river.spawn[2], -1900), null);
  // Every bridge leaves at least 14 m of clear water below its deck, the light bridge's
  // centre span between its piers included.
  for (const b of river.bridges) {
    const opening = bridgeOpening(b);
    assert.ok(opening.soffit - river.waterLevel >= 14, b.id);
    assert.equal(crossing(b.id, 0, opening.soffit - 3), null, b.id);
  }
  assert.equal(crossing('light', 50, -6), null, 'side span between pier and wall');
});
test('route, direction, altitude band and duration are not judged (#391)', () => {
  assert.equal(fly(2300, -4, -1200, 1800), null, 'southbound');
  assert.equal(fly(2300, 120, 1800, -1800), null, 'far above the bridges');
  // Ten minutes of slow circling above the canal.
  const collision = new BridgeCollision();
  for (let i = 0; i < 12000; i++) {
    const a = i * 0.002;
    assert.equal(collision.update(new Vector3(2300 + 60 * Math.sin(a), -4, 1400 + 60 * Math.cos(a)), level), null);
  }
});
test('decks, piers, arch ribs, hangers, pylons and cables are solid', () => {
  for (const b of river.bridges) assert.equal(crossing(b.id, 0, b.top - 1.5)?.structure, 'deck', b.id);
  assert.equal(crossing('light', 40, -6)?.structure, 'pier');
  // The arch's crown stands rise metres above the deck, its ribs along the deck edges.
  const crown = archCentre(bridge('arch'), 1, 0.5);
  assert.equal(crossing('arch', 0, crown[1])?.structure, 'arch');
  assert.equal(crossing('arch', 0, crown[1] + 4), null);
  assert.equal(crossing('arch', 50, bridge('arch').top + 10)?.structure, 'hanger');
  assert.equal(crossing('cable', river.halfWidth + 8, 40)?.structure, 'pylon');
  assert.equal(crossing('cable', 60, 25)?.structure, 'cable');
  // Lamps stand on both deck edges every 30 m, to 5.3 m above the deck.
  assert.equal(crossing('light', 30, bridge('light').top + 5)?.structure, 'lamp');
  assert.equal(crossing('light', 15, bridge('light').top + 5), null);
});
test('approach ramps carry each deck down to the street and are solid', () => {
  for (const b of river.bridges) {
    for (const ramp of bridgeRamps(b)) {
      assert.equal(ramp.top(ramp.start), b.top);
      assert.ok(Math.abs(ramp.top(ramp.start + ramp.side * ramp.length)) < 1e-9);
      // 10 m down the ramp, the aircraft clear of the street but not of the ramp.
      const x = ramp.start + ramp.side * 10;
      // The cable-stayed bridge's pylon stands at its east deck end.
      if (b.type === 'cable-stayed' && ramp.side > 0) { assert.ok(crossing(b.id, x, ramp.top(x) - 0.5)); continue; }
      assert.equal(crossing(b.id, x, ramp.top(x) - 0.5)?.structure, 'ramp', `${b.id} ${ramp.side}`);
      assert.equal(crossing(b.id, x, ramp.top(x) + 8), null, `${b.id} ${ramp.side}`);
    }
  }
});
test('the water and the quay walls are solid', () => {
  assert.equal(fly(2300, river.waterLevel + 1, 1500, 1400)?.structure, 'water');
  // A wing tip reaching past the wall below street level hits the wall.
  assert.equal(fly(2300 + river.halfWidth - 4, -4, 1000, 900)?.structure, 'wall');
  assert.equal(fly(2300 + river.halfWidth - 8, -4, 1000, 900), null);
  // Above the street the wall is no obstacle, and a wing banked up over its top clears it.
  assert.equal(fly(2300 + river.halfWidth + 20, 10, 1000, 900), null);
  const bank = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
  assert.equal(fly(2300 + river.halfWidth - 3, 0, 1000, 900, bank), null);
});
test('beyond the island the sea is open and its shore is a wall (#628)', () => {
  // Below the street beside the canal's line, south of the island: open sea.
  assert.equal(fly(2300 + river.halfWidth + 30, -4, 1700, island.halfZ + 10), null);
  assert.equal(fly(-1000, river.waterLevel + 1, 400, 300)?.structure, 'water');
  // Flying north into the island's south shore, and into the causeway's side, below the street.
  assert.equal(fly(1000, -4, 1500, 1300)?.structure, 'wall');
  assert.equal(fly(-1000, -4, 120, 40)?.structure, 'wall');
  // Out of the canal's mouth into the sea, between the curving quay walls.
  assert.equal(fly(2300, -4, 1100, 1700), null);
});
test('malformed samples and teleports never switch collision off', () => {
  const collision = new BridgeCollision(), deck = bridge('arch');
  assert.equal(collision.update(new Vector3(NaN, -4, 100), level), null);
  assert.equal(collision.update(new Vector3(2300, -4, 100), new Quaternion(0, 0, 0, 2)), null);
  // A 1.9 km jump tests only the new pose; the following deck strike still counts.
  collision.update(new Vector3(2300, deck.top - 1.5, 1900), level); collision.update(new Vector3(2300, deck.top - 1.5, 30), level);
  assert.equal(collision.update(new Vector3(2300, deck.top - 1.5, -30), level)?.structure, 'deck');
});
test('first contact is kept until reset', () => {
  const collision = new BridgeCollision();
  const contact = collision.update(new Vector3(2300, river.waterLevel + 0.5, 1500), level);
  assert.equal(contact.structure, 'water');
  assert.equal(collision.update(new Vector3(2300, -4, 1500), level), contact);
  collision.reset(); assert.equal(collision.contact, null); assert.equal(collision.previous, null);
  assert.equal(collision.update(new Vector3(2300, -4, 1500), level), null);
  assert.throws(() => new BridgeCollision({ ...river, bridges: [{ ...river.bridges[0], z: NaN }] }));
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
  const sim = scenarioSim(), scenario = new BridgeFlightScenario(sim);
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
  const sim = scenarioSim(), scenario = new BridgeFlightScenario(sim);
  scenario.start();
  for (let i = 0; i < 400; i++) { sim.position.set(2300, 60, 1800 - i * 2.3); scenario.update(0.05); }
  assert.equal(sim.crashes.length, 0);
  sim.position.set(2300, river.waterLevel + 0.5, 0); scenario.update(0.05);
  assert.equal(sim.crashes.length, 1); assert.equal(sim.crashes[0].type, 'WATER');
  scenario.update(0.05); assert.equal(sim.crashes.length, 1);
  sim.isCrashed = false; scenario.start(); assert.equal(scenario.collision.contact, null);
});
