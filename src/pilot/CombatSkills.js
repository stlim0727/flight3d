/** Local guidance policies, not calibrated claims about real combat effectiveness.
 * Inputs are observation snapshots; policies never receive the simulator/missiles.
 */
export const COMBAT_SKILLS = Object.freeze({
  attack: Object.freeze(['pursuit', 'close-pursuit', 'hold']),
  evasion: Object.freeze(['legacy-break', 'hold']),
  countermeasure: Object.freeze(['single', 'none']),
});

export function combatSkill(kind, id) {
  if (!COMBAT_SKILLS[kind]?.includes(id)) throw new Error(`Unknown ${kind} skill: ${id}`);
  return Object.freeze({ id, version: '1.0.0' });
}

export function createAttackSkill(id = 'pursuit') {
  const descriptor = combatSkill('attack', id);
  let active = true;
  return {
    ...descriptor,
    reset() { active = true; },
    abort() { active = false; },
    update({ own, contact, locked, speedMps }) {
      if (!active) return null;
      const pursue = id !== 'hold' && contact;
      return {
        headingRad: pursue ? Math.atan2(contact.x - own.x, -(contact.z - own.z)) : own.headingRad,
        altitudeM: pursue ? Math.max(750, contact.y) : own.y,
        speedMps,
        fire: Boolean(pursue && locked && contact.rangeM <= (id === 'close-pursuit' ? 1500 : 2500)),
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
