/**
 * Re-aim an airborne spawn for a steady horizontal wind. The authored velocity is a
 * still-air spawn: its horizontal direction is the intended ground track and its
 * horizontal magnitude the intended airspeed. Returns the ground velocity [x, z] that
 * keeps both, and the rotation about world +Y (radians, positive nose-left) that points
 * the nose along the relative wind, so the aircraft starts with zero sideslip and its
 * still-air trim stays valid. World +X east, +Z south. Vertical speed is not changed.
 * When the wind is too strong to hold the track, the spawn is returned unchanged.
 */
export function alignSpawnToWind(velocity, wind, out = {}) {
  out.x = velocity.x; out.z = velocity.z; out.yaw = 0;
  const airspeed = Math.hypot(velocity.x, velocity.z);
  if (!(airspeed > 0) || (wind.x === 0 && wind.z === 0)) return out;
  const tx = velocity.x / airspeed, tz = velocity.z / airspeed;
  const tailwind = tx * wind.x + tz * wind.z;
  const discriminant = airspeed * airspeed - (wind.x * wind.x + wind.z * wind.z) + tailwind * tailwind;
  if (!(discriminant > 0)) return out;
  const groundSpeed = tailwind + Math.sqrt(discriminant);
  if (!(groundSpeed > 0)) return out;
  out.x = tx * groundSpeed; out.z = tz * groundSpeed;
  // Heading clockwise from north is atan2(x, -z); Euler yaw about +Y is its negative.
  const yaw = Math.atan2(tx, -tz) - Math.atan2(out.x - wind.x, -(out.z - wind.z));
  out.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return out;
}
