// Combat damage is a continuous 0..1 state; discrete events only add increments.
// Limits are simulator tuning values, not aircraft or warhead certifications.
export const COMBAT_DAMAGE_LIMITS = Object.freeze({
  // A bandit drone is a generic light airframe. Its destruction threshold is
  // separate from the aircraft body/gear damage budgets in bodyDamage.js.
  banditIntegrity: 1,
});

export const MAX_DAMAGE = 1;

/** Monotonic accumulation: combat damage never heals in flight. */
export function addDamage(current, increment) {
  return Math.min(MAX_DAMAGE, Math.max(0, current) + Math.max(0, increment));
}

export function combatDamageState(damage) {
  return damage >= MAX_DAMAGE ? 'failed' : damage >= 0.3 ? 'damaged' : 'normal';
}

/**
 * Fragmentation falloff outside the lethal radius. A blast inside the lethal
 * radius destroys light structures outright; the fragment shell degrades
 * linearly until it carries no energy at the outer radius.
 */
export function blastDamage(distanceM, { lethalRadiusM = 5, fragmentRadiusM = 14 } = {}) {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  if (fragmentRadiusM <= lethalRadiusM) return distanceM <= lethalRadiusM ? 1 : 0;
  if (distanceM <= lethalRadiusM) return 1;
  if (distanceM >= fragmentRadiusM) return 0;
  return 1 - (distanceM - lethalRadiusM) / (fragmentRadiusM - lethalRadiusM);
}
