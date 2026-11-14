import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { MissileFlightModel } from '../src/weapons/MissileFlightModel.js';
import { MISSILE_TYPES } from '../src/weapons/missileSpecs.js';
import { AirToAirMissileSystem } from '../src/weapons/AirToAirMissileSystem.js';
import { compareMissileEnergyEnvelope } from '../scripts/lib/banditEvasionScenario.mjs';

const dt = 1 / 120;
const zero = new Vector3();
function body(speed = 300, spec = MISSILE_TYPES.AIM9X) {
  return { position: new Vector3(0, 3000, 0), velocity: new Vector3(0, 0, -speed),
    quaternion: new Quaternion(), spec, flight: new MissileFlightModel() };
}
function advance(missile, overrides = {}, step = dt) {
  missile.flight.step(step, missile, { massKg: missile.spec.dryMassKg, thrustN: 0,
    density: 1, command: zero, gravity: 0, ...overrides });
}

test('available lateral force scales with density and speed squared until the structural cap', () => {
  for (const spec of Object.values(MISSILE_TYPES)) {
    const fast = body(300, spec), slow = body(150, spec), thin = body(300, spec), high = body(2000, spec);
    advance(fast); advance(slow); advance(thin, { density: 0.25 }); advance(high);
    assert.ok(Math.abs(slow.flight.availableLateralMps2 / fast.flight.availableLateralMps2 - 0.25) < 1e-12);
    assert.ok(Math.abs(thin.flight.availableLateralMps2 / fast.flight.availableLateralMps2 - 0.25) < 1e-12);
    assert.equal(high.flight.availableLateralMps2, spec.maxLateralG * 9.80665);
  }
});

test('response memory is re-projected and limited to current achievable force after density/speed collapse', () => {
  const missile = body(900);
  const command = new Vector3(10000, 0, 10000);
  for (let i = 0; i < 120; i++) advance(missile, { command });
  assert.ok(missile.flight.deliveredLateralMps2 > 20);
  missile.velocity.set(0, 0, -80);
  advance(missile, { command, density: 0.01 });
  const flight = missile.flight;
  assert.ok(flight.deliveredLateralMps2 <= flight.availableLateralMps2 + 1e-12);
  assert.ok(flight.deliveredLateralMps2 < 1);
  assert.ok(Math.abs(flight.lateralAcceleration.z) < 1e-12);
  const qArea = flight.dynamicPressurePa * missile.spec.crossSectionM2;
  const cl = flight.massKg * flight.deliveredLateralMps2 / qArea;
  assert.ok(Math.abs(flight.maneuverDragN - qArea * missile.spec.inducedDragFactor * cl * cl) < 1e-10);
});

test('turns consume more coast energy than straight flight; response unloads after command release', () => {
  const straight = body(700), turning = body(700);
  const up = new Vector3(0, 1, 0), command = new Vector3();
  let work = 0;
  for (let i = 0; i < 6 * 120; i++) {
    command.crossVectors(turning.velocity, up).normalize().multiplyScalar(180);
    advance(straight);
    advance(turning, { command });
    work += turning.flight.maneuverDragN * dt;
    assert.ok(turning.flight.deliveredLateralMps2 <= turning.flight.availableLateralMps2 + 1e-10);
  }
  assert.ok(work > 0);
  assert.ok(turning.velocity.length() < straight.velocity.length() - 40);
  const loaded = turning.flight.deliveredLateralMps2;
  for (let i = 0; i < 120; i++) advance(turning);
  assert.ok(turning.flight.deliveredLateralMps2 < loaded * 0.01);
});

test('lateral rotation without drag does not create kinetic energy, even at a coarse step', () => {
  const spec = { ...MISSILE_TYPES.AIM9X, dragCoefficient: 0, inducedDragFactor: 0 };
  const missile = body(600, spec), up = new Vector3(0, 1, 0), command = new Vector3();
  for (let i = 0; i < 600; i++) {
    command.crossVectors(missile.velocity, up).normalize().multiplyScalar(250);
    advance(missile, { command }, 1 / 30);
    assert.ok(Math.abs(missile.velocity.length() - 600) < 1e-8);
  }
});

test('full gravity survives loss of tracking and ballistic energy is conserved with zero aerodynamic force', () => {
  const missile = body(300);
  const energy = () => missile.velocity.lengthSq() / 2 + 9.80665 * missile.position.y;
  const initial = energy();
  for (let i = 0; i < 240; i++) advance(missile, { density: 0, gravity: 9.80665, tracking: false });
  assert.ok(Math.abs(missile.velocity.y + 9.80665 * 2) < 1e-10);
  assert.ok(Math.abs(missile.position.y - (3000 - 0.5 * 9.80665 * 4)) < 1e-8);
  assert.ok(Math.abs(energy() - initial) < 1e-7);
});

test('zero speed uses each missile orientation and cannot inherit another missile direction', () => {
  const north = body(0), east = body(0);
  east.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
  advance(north, { thrustN: 9000 });
  advance(east, { thrustN: 9000 });
  assert.ok(north.velocity.z < 0 && Math.abs(north.velocity.x) < 1e-10);
  assert.ok(east.velocity.x > 0 && Math.abs(east.velocity.z) < 1e-10);
  assert.equal(north.flight.deliveredLateralMps2, 0);
  assert.equal(east.flight.deliveredLateralMps2, 0);
});

test('coast integration converges when the timestep is refined', () => {
  function simulate(step) {
    const missile = body(650), up = new Vector3(0, 1, 0), command = new Vector3();
    for (let i = 0; i < Math.round(6 / step); i++) {
      command.crossVectors(missile.velocity, up).normalize().multiplyScalar(120);
      advance(missile, { command }, step);
    }
    return missile;
  }
  const reference = simulate(1 / 960), coarse = simulate(1 / 60), fine = simulate(1 / 120);
  const coarseError = coarse.position.distanceTo(reference.position);
  const fineError = fine.position.distanceTo(reference.position);
  assert.ok(fineError < coarseError * 0.65, `position errors: ${coarseError} -> ${fineError}`);
  assert.ok(fineError < 4, `120 Hz position error ${fineError} m over six seconds`);
  assert.ok(Math.abs(fine.velocity.length() - reference.velocity.length()) < 1);
});

test('burnout, pause and reset preserve the normal combat lifecycle with independent missile actuator state', () => {
  const world = { active: true, onGround: false, position: new Vector3(0, 10000, 0),
    velocity: new Vector3(0, 0, -250), quaternion: new Quaternion(), terrainHeight: () => 0 };
  const combat = new AirToAirMissileSystem();
  const missile = combat.fire(world), other = combat.fire(world);
  assert.notEqual(missile.flight, other.flight);
  for (let i = 0; i < 6 * 120; i++) combat.update(dt, world);
  assert.equal(missile.propellant, 0);
  assert.equal(missile.flight.thrustN, 0);
  const pose = missile.position.clone(), actuator = missile.flight.lateralAcceleration.clone();
  combat.update(0, world);
  assert.deepEqual(missile.position, pose);
  assert.deepEqual(missile.flight.lateralAcceleration, actuator);
  combat.reset();
  const fresh = combat.fire(world);
  assert.equal(fresh.flight.lateralAcceleration.length(), 0);
  assert.notEqual(fresh.flight, missile.flight);
});

test('envelope comparison retains favorable hits and records physical control and energy costs', () => {
  const results = compareMissileEnergyEnvelope();
  assert.ok(results.some(r => r.terminal === 'hit'));
  assert.ok(results.some(r => r.terminal === 'miss-expired'));
  assert.ok(results.some(r => r.controlLimitedSeconds > 0.5));
  for (const result of results) {
    assert.notEqual(result.terminal, 'timeout', JSON.stringify(result));
    assert.ok(Number.isFinite(result.terminalMissileSpeedMps));
    assert.ok(result.maneuverDragWorkJPerKg > 0);
  }
});
