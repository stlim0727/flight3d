import {
  OBSERVATION_MODES,
  assertObservationBoundary,
  resolveContactObservation,
} from './ObservationContract.js';

/** Local guidance policies, not calibrated claims about real combat effectiveness.
 * Inputs are observation snapshots; policies never receive the simulator/missiles.
 */
export const COMBAT_SKILLS = Object.freeze({
  attack: Object.freeze(['pursuit', 'close-pursuit', 'hold']),
  evasion: Object.freeze(['legacy-break', 'hold']),
  countermeasure: Object.freeze(['burst', 'single', 'none']),
});

export function combatSkill(kind, id) {
  if (!COMBAT_SKILLS[kind]?.includes(id)) throw new Error(`Unknown ${kind} skill: ${id}`);
  return Object.freeze({ id, version: '1.0.0' });
}

export function createAttackSkill(id = 'pursuit') {
  const descriptor = combatSkill('attack', id);
  let active = true;
  let prevContact = null;
  return {
    ...descriptor,
    reset() { active = true; prevContact = null; },
    abort() { active = false; prevContact = null; },
    update(observation) {
      if (!active) return null;
      assertObservationBoundary(observation, { expectedMode: OBSERVATION_MODES.LIMITED });
      const { own, locked, speedMps } = observation;
      const contact = resolveContactObservation(observation.contact, observation.time);
      const pursue = id !== 'hold' && contact;
      if (!pursue) {
        prevContact = null;
        return {
          headingRad: own.headingRad,
          altitudeM: own.y,
          speedMps,
          fire: false,
        };
      }
      let aimX = contact.x, aimY = contact.y, aimZ = contact.z;
      if (prevContact) {
        const curTime = contact.observedAt ?? contact.time;
        const prevTime = prevContact.observedAt ?? prevContact.time;
        const cDt = (curTime != null && prevTime != null)
          ? curTime - prevTime
          : 0.2;
        if (cDt > 0.05 && cDt <= 1.0) {
          const vx = (contact.x - prevContact.x) / cDt;
          const vy = (contact.y - prevContact.y) / cDt;
          const vz = (contact.z - prevContact.z) / cDt;
          if (Math.hypot(vx, vy, vz) <= 450) {
            const leadT = Math.min(2.5, Math.max(0, contact.rangeM / 550));
            aimX += vx * leadT;
            aimY += vy * leadT;
            aimZ += vz * leadT;
          }
        }
      }
      prevContact = { ...contact };
      const headingRad = Math.atan2(aimX - own.x, -(aimZ - own.z));
      const hErr = Math.abs(Math.atan2(Math.sin(headingRad - own.headingRad), Math.cos(headingRad - own.headingRad)));
      const targetSpeedMps = hErr > 0.45 ? 205 : contact.rangeM < 2200 ? 215 : Math.max(speedMps, 260);
      return {
        headingRad,
        altitudeM: Math.max(750, aimY),
        speedMps: targetSpeedMps,
        fire: Boolean(locked && contact.rangeM <= (id === 'close-pursuit' ? 1500 : 2500)),
      };
    },
  };
}

export function evasionDemand(id, { patrolHeading, warningHeading, weight, integrity, speedMps }) {
  combatSkill('evasion', id);
  const response = id === 'hold' ? 0 : weight;
  const error = Math.atan2(Math.sin(warningHeading - patrolHeading), Math.cos(warningHeading - patrolHeading));
  return { headingRad: patrolHeading + error * response * integrity,
    speedMps: speedMps + (Math.max(speedMps, 250) - speedMps) * response * integrity };
}
