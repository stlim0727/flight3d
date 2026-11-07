/** Backward-Euler spring/damper load. The contact's effective mass includes
 * rotational inertia: a light nose/tail contact must not apply the same damping
 * impulse as a contact through the CG. Units: m, m/s, N/m, N s/m, kg^-1, s.
 * This solves F = k(d - h(v + h F/mEff)) - c(v + h F/mEff).
 */
export function compliantNormalForce(depth, speed, stiffness, damping, inverseEffectiveMass, dt) {
  return Math.max(0, (stiffness * depth - (damping + dt * stiffness) * speed)
    / (1 + dt * (damping + dt * stiffness) * inverseEffectiveMass));
}

export function inverseContactMass(arm, normal, mass, inverseInertia) {
  const x = arm.y * normal.z - arm.z * normal.y;
  const y = arm.z * normal.x - arm.x * normal.z;
  const z = arm.x * normal.y - arm.y * normal.x;
  return 1 / mass + x * x * inverseInertia.x + y * y * inverseInertia.y + z * z * inverseInertia.z;
}
