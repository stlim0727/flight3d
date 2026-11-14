import * as THREE from 'three';

// Combat damage is a continuous 0..1 state; discrete events only add increments.
// Limits are simulator tuning values, not aircraft or warhead certifications.
export const COMBAT_DAMAGE_LIMITS = Object.freeze({
  // A bandit drone is a generic light airframe. Its destruction threshold is
  // separate from the aircraft body/gear damage budgets in bodyDamage.js.
  banditIntegrity: 1,
});

export const MAX_DAMAGE = 1;

export const COMBAT_DAMAGE_ZONES = Object.freeze([
  'nose',
  'fuselage',
  'wingL',
  'wingR',
  'tail',
  'engine',
]);

// Approximate F-16 airframe zone centers in Three.js body coordinates
// (-Z forward, +X right, +Y up).
export const ZONE_LOCAL_CENTERS = Object.freeze({
  nose: Object.freeze({ x: 0, y: 0, z: -4.5 }),
  fuselage: Object.freeze({ x: 0, y: 0, z: 0 }),
  wingL: Object.freeze({ x: -3.0, y: 0, z: 0.6 }),
  wingR: Object.freeze({ x: 3.0, y: 0, z: 0.6 }),
  tail: Object.freeze({ x: 0, y: 1.0, z: 4.8 }),
  engine: Object.freeze({ x: 0, y: 0, z: 4.2 }),
});

const _offset = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();
const _velQuat = new THREE.Quaternion();
const _velDir = new THREE.Vector3();
const _forward = new THREE.Vector3(0, 0, -1);

export function createDamageZones() {
  return {
    nose: 0,
    fuselage: 0,
    wingL: 0,
    wingR: 0,
    tail: 0,
    engine: 0,
  };
}

/** Monotonic accumulation: combat damage never heals in flight. */
export function addDamage(current, increment) {
  return Math.min(MAX_DAMAGE, Math.max(0, current) + Math.max(0, increment));
}

export function combatDamageState(damage) {
  return damage >= MAX_DAMAGE ? 'failed' : damage >= 0.3 ? 'damaged' : 'normal';
}

/**
 * Transform a world-space point into the target's body frame. Falls back to a
 * velocity-aligned frame when the target has no explicit quaternion.
 */
export function toBodyOffset(worldPoint, targetPosition, targetQuaternion = null, targetVelocity = null, out = new THREE.Vector3()) {
  if (!worldPoint || !targetPosition) return out.set(0, 0, 0);
  _offset.copy(worldPoint).sub(targetPosition);
  if (targetQuaternion) {
    _invQuat.copy(targetQuaternion).invert();
    return out.copy(_offset).applyQuaternion(_invQuat);
  }
  if (targetVelocity && targetVelocity.lengthSq() > 1) {
    _velDir.copy(targetVelocity).normalize();
    _velQuat.setFromUnitVectors(_forward, _velDir).invert();
    return out.copy(_offset).applyQuaternion(_velQuat);
  }
  return out.copy(_offset);
}

/** Classify a body-frame hit offset into one of the six airframe damage zones. */
export function classifyHitZone(localOffset) {
  if (!localOffset) return 'fuselage';
  const { x = 0, y = 0, z = 0 } = localOffset;
  if (x < -1.35) return 'wingL';
  if (x > 1.35) return 'wingR';
  if (z < -2.0) return 'nose';
  if (z > 2.0) {
    return Math.abs(x) < 1.1 && y < 0.75 ? 'engine' : 'tail';
  }
  return 'fuselage';
}

/**
 * Apply localized kinetic hit damage to a primary zone with minor structural
 * bleed into the central fuselage.
 */
export function applyZoneDamage(zones, hitZone, amount, { bleed = 0.2 } = {}) {
  if (!zones || amount <= 0) return zones;
  const zone = COMBAT_DAMAGE_ZONES.includes(hitZone) ? hitZone : 'fuselage';
  zones[zone] = addDamage(zones[zone] ?? 0, amount);
  if (zone !== 'fuselage' && bleed > 0) {
    zones.fuselage = addDamage(zones.fuselage ?? 0, amount * bleed);
  }
  return zones;
}

/**
 * Distribute warhead blast/fragmentation across airframe zones based on
 * proximity to the detonation point in body coordinates.
 */
export function applyBlastZoneDamage(zones, localOffset, totalAmount, { blastRadiusM = 12 } = {}) {
  if (!zones || totalAmount <= 0) return zones;
  const ox = localOffset?.x ?? 0;
  const oy = localOffset?.y ?? 0;
  const oz = localOffset?.z ?? 0;
  const radius = Math.max(2, blastRadiusM);
  let maxWeight = 0;
  const weights = {};
  for (const zone of COMBAT_DAMAGE_ZONES) {
    const c = ZONE_LOCAL_CENTERS[zone];
    const dist = Math.hypot(ox - c.x, oy - c.y, oz - c.z);
    const w = Math.max(0.15, 1 - dist / radius);
    weights[zone] = w;
    if (w > maxWeight) maxWeight = w;
  }
  const norm = maxWeight > 0 ? 1 / maxWeight : 1;
  for (const zone of COMBAT_DAMAGE_ZONES) {
    zones[zone] = addDamage(zones[zone] ?? 0, totalAmount * weights[zone] * norm);
  }
  return zones;
}

/**
 * Derive continuous aerodynamic and subsystem degradation factors from
 * per-zone structural damage (0..1 per zone).
 */
export function computeAeroDamageEffects(damageZones, out = {}) {
  const nose = Math.min(1, Math.max(0, damageZones?.nose ?? 0));
  const fuselage = Math.min(1, Math.max(0, damageZones?.fuselage ?? damageZones?.belly ?? 0));
  const wingL = Math.min(1, Math.max(0, damageZones?.wingL ?? 0));
  const wingR = Math.min(1, Math.max(0, damageZones?.wingR ?? 0));
  const tail = Math.min(1, Math.max(0, damageZones?.tail ?? 0));
  const engine = Math.min(1, Math.max(0, damageZones?.engine ?? Math.max(damageZones?.engineL ?? 0, damageZones?.engineR ?? 0)));

  out.liftScale = Math.max(0.45, 1 - 0.14 * (wingL + wingR));
  out.parasiticDragDelta = 0.032 * (wingL + wingR) + 0.022 * fuselage + 0.014 * nose + 0.018 * tail;
  out.rollAsymmetry = (wingL - wingR) * 0.14;
  out.yawAsymmetry = (wingL - wingR) * 0.03;
  out.aileronAuthority = Math.max(0.25, 1 - 0.55 * Math.max(wingL, wingR));
  out.elevatorAuthority = Math.max(0.25, 1 - 0.6 * tail);
  out.rudderAuthority = Math.max(0.25, 1 - 0.6 * tail);
  out.stabilityScale = Math.max(0.35, 1 - 0.45 * tail);
  out.avionicsScale = Math.max(0.25, 1 - 0.6 * nose);
  out.engineDamage = engine;
  return out;
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
