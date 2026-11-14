import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { BANDIT_WARNING_MODEL, BanditThreatResponse } from '../src/weapons/BanditThreatResponse.js';
import { BanditTarget, AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { compareBanditEngagements } from '../scripts/lib/banditEvasionScenario.mjs';

const flat = () => 0;
const dt = 1 / 120;
const aircraft = () => ({ position: new Vector3(0, 3000, 0), velocity: new Vector3(0, 0, -180) });
const plume = (overrides = {}) => ({ id: 1, alive: true, propellant: 1,
  position: new Vector3(0, 3000, 2500), velocity: new Vector3(0, 0, -650), ...overrides });
function observe(response, own, missiles, seconds, terrain = flat) {
  for (let i = 0; i < Math.round(seconds / dt); i++) response.update(dt, own, missiles, terrain);
}
function patrol(evasion = true) {
  return new BanditTarget({ callsign: 'TEST', position: new Vector3(780, 3000, 0), evasion,
    orbit: { center: new Vector3(), radius: 780, angle: 0, altitudeM: 3000, omega: 180 / 780 } });
}

test('a visible approaching plume needs continuous confirmation, independently of missile target identity', () => {
  const response = new BanditThreatResponse();
  const own = aircraft(), missile = plume({ target: { id: 'someone else' } });
  observe(response, own, [missile], 0.3);
  assert.equal(response.phase, 'detect');
  assert.equal(response.weight, 0);
  observe(response, own, [], 0.1);
  observe(response, own, [missile], 0.4);
  assert.equal(response.weight, 0, 'interrupted glimpses do not grant instant awareness');
  observe(response, own, [missile], 0.4);
  assert.equal(response.phase, 'evade');
  assert.ok(response.weight > 0 && response.weight < 1, 'pilot response builds over time');
  assert.equal(response.confirmedId, missile.id);
  assert.ok(Math.abs(Math.cos(response.heading)) < 1e-8, 'escape course beams the observed bearing');
});

test('range, plume, closure and sampled terrain gate observations; every missile owns its confirmation', () => {
  const own = aircraft();
  const cases = [
    [plume({ position: new Vector3(0, 3000, 5000) }), flat],
    [plume({ propellant: 0 }), flat],
    [plume({ alive: false }), flat],
    [plume({ velocity: new Vector3(0, 0, 650) }), flat],
    [plume(), (x, z) => z > 1000 && z < 1600 ? 4000 : 0],
  ];
  for (const [missile, terrain] of cases) {
    const response = new BanditThreatResponse();
    observe(response, own, [missile], 2, terrain);
    assert.equal(response.weight, 0);
    assert.equal(response.observedId, null);
  }
  const response = new BanditThreatResponse();
  observe(response, own, [plume()], 0.4);
  observe(response, own, [plume({ id: 2 })], 0.4);
  assert.equal(response.confirmedId, null, 'different tracks cannot share confirmation time');
});

test('burnout uses finite bearing memory then recovery; disable and reset clear stale response', () => {
  const response = new BanditThreatResponse();
  const own = aircraft(), missile = plume();
  observe(response, own, [missile], 1.5);
  const heading = response.heading;
  missile.propellant = 0;
  missile.position.x = 2000;
  observe(response, own, [missile], 1);
  assert.equal(response.phase, 'evade');
  assert.equal(response.heading, heading, 'unseen missile cannot update the remembered bearing');
  observe(response, own, [], 2.1);
  assert.equal(response.phase, 'recover');
  const weight = response.weight;
  observe(response, own, [], 8);
  assert.equal(response.phase, 'patrol');
  assert.ok(response.weight < weight && response.weight < 0.01);
  observe(response, own, [plume()], 1);
  response.enabled = false;
  observe(response, own, [plume()], dt);
  assert.equal(response.weight, 0);
  assert.equal(response.confirmedId, null);
  response.enabled = true;
  observe(response, own, [plume()], 1);
  response.reset();
  assert.equal(response.exposure, 0);
  assert.equal(response.observedId, null);
  assert.equal(response.memory, 0);
});

test('physical pilot reaction changes trajectory without teleportation and recovers to patrol', () => {
  const defensive = patrol(), baseline = patrol(false);
  const missile = plume();
  let maxLoad = 0, maxRate = 0;
  for (let i = 0; i < 12 * 120; i++) {
    // Controlled observable track: always behind the target during observation.
    missile.position.copy(defensive.position).add(new Vector3(0, 0, -2500));
    missile.velocity.copy(defensive.velocity).add(new Vector3(0, 0, 500));
    const before = defensive.position.clone(), velocity = defensive.velocity.clone();
    defensive.update(dt, flat, i < 6 * 120 ? [missile] : []);
    baseline.update(dt, flat, [missile]);
    assert.ok(defensive.position.distanceTo(before) < 4, 'no position jump');
    assert.ok(defensive.velocity.distanceTo(velocity) < 2, 'no velocity impulse');
    assert.ok(defensive.alive && Number.isFinite(defensive.position.length()));
    maxLoad = Math.max(maxLoad, defensive.flight.aero.gForce);
    maxRate = Math.max(maxRate, defensive.flight.angularVelocity.length());
  }
  assert.ok(defensive.position.distanceTo(baseline.position) > 200, 'actual force-driven paths diverge');
  assert.ok(maxLoad < 9 && maxRate < 2, `physical response: load=${maxLoad}, rate=${maxRate}`);
  for (let i = 0; i < 100 * 120; i++) { defensive.update(dt); baseline.update(dt); }
  assert.equal(defensive.threatResponse.phase, 'patrol');
  assert.ok(defensive.alive);
  assert.ok(Math.abs(defensive.position.y - 3000) < 100, 'altitude recovers');
  assert.ok(Math.abs(Math.hypot(defensive.position.x, defensive.position.z)
    - Math.hypot(baseline.position.x, baseline.position.z)) < 100, 'orbit recovers');
  defensive.threatResponse.weight = 1;
  defensive.respawn(new Vector3(780, 3000, 0), defensive.orbit);
  assert.equal(defensive.threatResponse.phase, 'patrol');
  assert.equal(defensive.threatResponse.weight, 0);
});

test('combat system feeds airborne plumes to patrol pilots and offers an explicit non-evasive baseline', () => {
  for (const enabled of [true, false]) {
    const system = new AirToAirMissileSystem({ banditEvasion: enabled });
    const world = { active: true, onGround: false, position: new Vector3(0, 3000, 0),
      velocity: new Vector3(0, 0, -250), quaternion: new Quaternion(), terrainHeight: flat };
    system.update(dt, world);
    const target = system.targets[0];
    // A real missile advances in the system; only place its initial pose.
    const missile = system.fire(world);
    missile.position.copy(target.position).add(new Vector3(0, 0, 3000));
    missile.velocity.set(0, 0, -300);
    let reacted = false;
    for (let i = 0; i < 2 * 120; i++) {
      system.update(dt, world);
      reacted ||= target.threatResponse.phase === 'evade';
    }
    assert.equal(reacted, enabled);
    const memory = target.threatResponse.memory;
    const position = target.position.clone();
    system.update(0, world);
    assert.equal(target.threatResponse.memory, memory, 'pause freezes reaction memory');
    assert.deepEqual(target.position, position);
    system.reset();
    assert.equal(system.targets.length, 0);
    assert.equal(system.missiles.length, 0);
    system.update(dt, world);
    assert.equal(system.targets[0].threatResponse.weight, 0);
  }
  assert.ok(BANDIT_WARNING_MODEL.memorySeconds > BANDIT_WARNING_MODEL.confirmationSeconds);
});

test('fixed launch matrix records outcomes without granting immunity or omniscient awareness', () => {
  const results = compareBanditEngagements();
  assert.equal(results.length, 18);
  let changed = 0;
  for (let i = 0; i < results.length; i += 2) {
    const baseline = results[i], defensive = results[i + 1];
    assert.equal(baseline.reactionSeconds, null);
    for (const result of [baseline, defensive]) {
      assert.ok(['hit', 'miss-expired', 'miss-terrain', 'no-lock'].includes(result.terminal), JSON.stringify(result));
      assert.ok(Number.isFinite(result.minSampledSeparationM));
      assert.ok(result.maxLoadG < 9, `load ${result.maxLoadG}`);
    }
    if (defensive.reactionSeconds !== null) {
      assert.ok(defensive.reactionSeconds >= BANDIT_WARNING_MODEL.confirmationSeconds);
      if (Math.abs(baseline.terminalSeconds - defensive.terminalSeconds) > 0.01) changed++;
    }
  }
  assert.ok(changed > 0, 'reaction changes real engagement trajectories');
  assert.ok(results.some(r => r.evasion && r.terminal === 'hit'), 'evasion does not guarantee survival');
  assert.equal(results.find(r => r.evasion && r.rangeM === 5500 && r.aspect === 'tail').reactionSeconds,
    null, 'a long-range coast-inbound outside plume visibility does not grant awareness');
});
