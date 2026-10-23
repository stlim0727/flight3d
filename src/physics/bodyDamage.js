// Gameplay calibration, not certification limits. Energy in joules, speeds in m/s.
// Abrasion consumes friction work, so unloaded contact and rest cannot wear a part.
export const BODY_DAMAGE_LIMITS = Object.freeze({
  engineL: { impact: 2, fatalImpact: 10, abrasionEnergy: 45000000 },
  engineR: { impact: 2, fatalImpact: 10, abrasionEnergy: 45000000 },
  belly: { impact: 3, fatalImpact: 12.5, abrasionEnergy: 300000000 },
  nose: { impact: 3, fatalImpact: 10, abrasionEnergy: 180000000 },
  tail: { impact: 2, fatalImpact: 8, abrasionEnergy: 100000000 },
  wingL: { impact: 2, fatalImpact: 8, abrasionEnergy: 100000000 },
  wingR: { impact: 2, fatalImpact: 8, abrasionEnergy: 100000000 },
});

export const bodyDamageState = damage => damage >= 1 ? 'failed' : damage >= 0.3 ? 'damaged' : 'normal';

export function updateBodyDamage(damage, { sinkRate, firstContact, frictionWork }, limits) {
  const impact = firstContact
    ? Math.max(0, sinkRate * sinkRate - limits.impact ** 2) / (limits.fatalImpact ** 2 - limits.impact ** 2)
    : 0;
  return Math.min(1, damage + impact + Math.max(0, frictionWork) / limits.abrasionEnergy);
}
