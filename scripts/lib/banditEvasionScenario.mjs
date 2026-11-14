import { Quaternion, Vector3 } from 'three';
import { AirToAirMissileSystem, BanditTarget } from '../../src/weapons/AirToAirMissileSystem.js';
import { MissileFlightModel } from '../../src/weapons/MissileFlightModel.js';
import { MISSILE_TYPES } from '../../src/weapons/missileSpecs.js';

/** Fixed-condition comparison, not a real-world probability-of-kill estimate.
 * Shared by the Node regression and the hardware-browser acceptance check.
 */
export function runBanditEngagement({ rangeM, aspect, evasion, type = 'AIM9X',
  altitudeM = 3000, launchSpeedMps = 250, targetSpeedMps = 180, orbitRadiusM = 780, idealSensor = false }) {
  const dt = 1 / 120;
  const target = new BanditTarget({ callsign: 'COMPARISON', evasion,
    position: new Vector3(orbitRadiusM, altitudeM, 0),
    orbit: { center: new Vector3(), radius: orbitRadiusM, angle: 0,
      omega: targetSpeedMps / orbitRadiusM, altitudeM } });
  const offset = aspect === 'tail' ? new Vector3(0, 0, -rangeM)
    : aspect === 'head' ? new Vector3(0, 0, rangeM) : new Vector3(rangeM, 0, 0);
  const position = target.position.clone().add(offset);
  const direction = offset.clone().negate().normalize();
  const world = { active: true, onGround: false, position,
    velocity: direction.clone().multiplyScalar(launchSpeedMps),
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction),
    terrainHeight: () => 0,
    ...(idealSensor ? { seekerSignalQuality: () => 1 } : {}) };
  const combat = new AirToAirMissileSystem({ stations: [{ id: 'TEST', type, position: [-5.04, 0.04, 2.45] }] });
  combat.addTarget(target);
  // Hold boresight on the target while acquiring, identically in both runs.
  for (let i = 0; i < 100; i++) {
    direction.subVectors(target.position, position).normalize();
    world.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), direction);
    world.velocity.copy(direction).multiplyScalar(launchSpeedMps);
    combat.update(dt, world);
  }
  if (!combat.lockedTarget) {
    // This matrix requires a rail lock; refusal is not a fired missile miss.
    return { rangeM, aspect, type, evasion, altitudeM, launchSpeedMps, sensorModel: idealSensor ? 'ideal-fixture' : 'default', launched: false,
      terminal: 'no-lock', terminalSeconds: 0,
      minSampledSeparationM: target.position.distanceTo(position), reactionSeconds: null,
      maxLoadG: target.flight.aero.gForce, controlLimitedSeconds: 0,
      maneuverDragWorkJPerKg: 0, terminalMissileSpeedMps: null };
  }
  const missile = combat.fire(world);
  let minSampledSeparationM = Infinity;
  let reactionSeconds = null;
  let terminal = 'timeout';
  let maxLoadG = 0;
  let terminalSeconds = 0;
  let controlLimitedSeconds = 0;
  let maneuverDragWorkJPerKg = 0;
  for (let i = 0; i < 26 * 120; i++) {
    const events = combat.update(dt, world);
    terminalSeconds = (i + 1) * dt;
    const flight = missile.flight;
    if (flight.requestedLateralMps2 > flight.availableLateralMps2 + 1e-6) controlLimitedSeconds += dt;
    maneuverDragWorkJPerKg += flight.maneuverDragN * missile.velocity.length() / flight.massKg * dt;
    minSampledSeparationM = Math.min(minSampledSeparationM, missile.position.distanceTo(target.position));
    maxLoadG = Math.max(maxLoadG, target.flight.aero.gForce);
    if (target.threatResponse.phase === 'evade' && reactionSeconds === null) reactionSeconds = terminalSeconds;
    if (events.some(event => event.type === 'kill' && event.target === target)) {
      terminal = 'hit';
      break;
    }
    if (!target.alive) { terminal = 'target-terrain'; break; }
    if (!missile.alive) {
      terminal = events.some(event => event.type === 'expire') ? 'miss-expired' : 'miss-terrain';
      break;
    }
  }
  return { rangeM, aspect, type, evasion, altitudeM, launchSpeedMps, sensorModel: idealSensor ? 'ideal-fixture' : 'default', launched: true, terminal, terminalSeconds,
    minSampledSeparationM, reactionSeconds, maxLoadG, controlLimitedSeconds,
    maneuverDragWorkJPerKg, terminalMissileSpeedMps: missile.velocity.length() };
}

export function compareBanditEngagements() {
  const results = [];
  for (const rangeM of [1800, 3500, 5500]) {
    for (const aspect of ['tail', 'head', 'beam']) {
      for (const evasion of [false, true]) {
        results.push(runBanditEngagement({ rangeM, aspect, evasion }));
      }
    }
  }
  return results;
}

/** Envelope samples vary physical initial conditions, never outcome probabilities. */
export function compareMissileEnergyEnvelope({ idealSensor = false } = {}) {
  const results = [];
  const conditions = [
    { rangeM: 1800, aspect: 'head', altitudeM: 1000, launchSpeedMps: 300 },
    { rangeM: 5500, aspect: 'beam', altitudeM: 1000, launchSpeedMps: 150 },
    { rangeM: 5500, aspect: 'beam', altitudeM: 10000, launchSpeedMps: 150 },
    { rangeM: 7500, aspect: 'tail', altitudeM: 10000, launchSpeedMps: 300 },
    { rangeM: 8000, aspect: 'beam', altitudeM: 1000, launchSpeedMps: 100 },
    { rangeM: 8000, aspect: 'beam', altitudeM: 10000, launchSpeedMps: 100 },
  ];
  for (const type of ['AIM9X', 'AIM120C']) {
    for (const condition of conditions) {
      for (const evasion of [false, true]) {
        results.push(runBanditEngagement({ ...condition, type, evasion, idealSensor,
          targetSpeedMps: 240, orbitRadiusM: 1500 }));
      }
    }
  }
  return results;
}

export function measureMissileCoast() {
  const make = speed => ({ position: new Vector3(0, 3000, 0), velocity: new Vector3(0, 0, -speed),
    quaternion: new Quaternion(), spec: MISSILE_TYPES.AIM9X, flight: new MissileFlightModel() });
  const straight = make(700), turning = make(700), thin = make(150);
  const command = new Vector3(), up = new Vector3(0, 1, 0), zero = new Vector3();
  const advance = (missile, request, density = 1) => missile.flight.step(1 / 120, missile, {
    massKg: missile.spec.dryMassKg, thrustN: 0, density, command: request, gravity: 0,
  });
  for (let i = 0; i < 720; i++) {
    command.crossVectors(turning.velocity, up).normalize().multiplyScalar(180);
    advance(straight, zero);
    advance(turning, command);
  }
  advance(thin, new Vector3(1000, 0, 0), 0.1);
  return { straightSpeedMps: straight.velocity.length(), turnSpeedMps: turning.velocity.length(),
    thinAvailableMps2: thin.flight.availableLateralMps2,
    thinDeliveredMps2: thin.flight.deliveredLateralMps2 };
}
