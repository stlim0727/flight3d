import { Quaternion, Vector3 } from 'three';
import { AirToAirMissileSystem, BanditTarget } from '../../src/weapons/AirToAirMissileSystem.js';

/** Fixed-condition comparison, not a real-world probability-of-kill estimate.
 * Shared by the Node regression and the hardware-browser acceptance check.
 */
export function runBanditEngagement({ rangeM, aspect, evasion, type = 'AIM9X' }) {
  const dt = 1 / 120;
  const target = new BanditTarget({ callsign: 'COMPARISON', evasion,
    position: new Vector3(780, 3000, 0),
    orbit: { center: new Vector3(), radius: 780, angle: 0, omega: 180 / 780, altitudeM: 3000 } });
  const offset = aspect === 'tail' ? new Vector3(0, 0, -rangeM)
    : aspect === 'head' ? new Vector3(0, 0, rangeM) : new Vector3(rangeM, 0, 0);
  const position = target.position.clone().add(offset);
  const direction = offset.clone().negate().normalize();
  const world = { active: true, onGround: false, position,
    velocity: direction.clone().multiplyScalar(250),
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), direction),
    terrainHeight: () => 0 };
  const combat = new AirToAirMissileSystem({ stations: [{ id: 'TEST', type, position: [-5.04, 0.04, 2.45] }] });
  combat.addTarget(target);
  // Hold boresight on the target while acquiring, identically in both runs.
  for (let i = 0; i < 100; i++) {
    direction.subVectors(target.position, position).normalize();
    world.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), direction);
    world.velocity.copy(direction).multiplyScalar(250);
    combat.update(dt, world);
  }
  if (!combat.lockedTarget) throw new Error('Comparison launch must be locked');
  const missile = combat.fire(world);
  let minSampledSeparationM = Infinity;
  let reactionSeconds = null;
  let terminal = 'timeout';
  let maxLoadG = 0;
  let terminalSeconds = 0;
  for (let i = 0; i < 26 * 120; i++) {
    const events = combat.update(dt, world);
    terminalSeconds = (i + 1) * dt;
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
  return { rangeM, aspect, type, evasion, terminal, terminalSeconds,
    minSampledSeparationM, reactionSeconds, maxLoadG };
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
