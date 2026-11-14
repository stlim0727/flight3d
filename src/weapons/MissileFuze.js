/** Idealized closest-approach fuze. Returns a shared step fraction or null.
 * At a step start already inside the sphere, stationary/separating motion fires
 * immediately. Approaching motion waits for a minimum within this step.
 */
export function fuzeClosestApproach(missile, target, radiusM) {
  if (!Number.isFinite(radiusM) || radiusM < 0) return null;
  const rx = target.prevPosition.x - missile.prevPosition.x;
  const ry = target.prevPosition.y - missile.prevPosition.y;
  const rz = target.prevPosition.z - missile.prevPosition.z;
  const vx = target.position.x - missile.position.x - rx;
  const vy = target.position.y - missile.position.y - ry;
  const vz = target.position.z - missile.position.z - rz;
  const startSq = rx * rx + ry * ry + rz * rz;
  const speedSq = vx * vx + vy * vy + vz * vz;
  const dot = rx * vx + ry * vy + rz * vz;
  if (![startSq, speedSq, dot].every(Number.isFinite)) return null;
  if (speedSq < 1e-12 || dot >= 0) return startSq <= radiusM * radiusM ? 0 : null;
  const t = -dot / speedSq;
  if (t > 1) return null;
  const x = rx + vx * t, y = ry + vy * t, z = rz + vz * t;
  return x * x + y * y + z * z <= radiusM * radiusM ? t : null;
}
