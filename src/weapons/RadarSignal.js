/** Relative monostatic return and background, not a calibrated missile radar. */
export const RADAR_MODEL = Object.freeze({ referenceRangeM: 6500, referenceRcsM2: 1,
  clutterGain: 4, groundAngleScale: 0.08 });

export function radarSignalQuality(observer, target, rangeM, world, diagnostics) {
  if (diagnostics) Object.assign(diagnostics, { returnPower: 0, clutter: 0, quality: 0 });
  const rcs = target.radarCrossSectionM2 ?? 1;
  if (!Number.isFinite(rcs) || rcs < 0 || !Number.isFinite(rangeM) || rangeM <= 0) return 0;
  let clutter = 0;
  if (world?.terrainHeight) {
    const ground = world.terrainHeight(target.position.x, target.position.z);
    if (!Number.isFinite(ground)) return 0;
    // Angular distance between target and the ground beneath it, viewed from
    // the sensor. A low target seen from above places terrain in the beam.
    const dy = target.position.y - observer.position.y;
    const groundDy = ground - observer.position.y;
    const horizontal = Math.hypot(target.position.x - observer.position.x, target.position.z - observer.position.z);
    const separation = Math.atan2(dy, horizontal) - Math.atan2(groundDy, horizontal);
    const lookDown = Math.max(0, Math.min(1, -dy / rangeM / RADAR_MODEL.groundAngleScale));
    clutter = RADAR_MODEL.clutterGain * lookDown * Math.exp(-Math.max(0, separation) / RADAR_MODEL.groundAngleScale);
  }
  const returnPower = rcs / RADAR_MODEL.referenceRcsM2 * (RADAR_MODEL.referenceRangeM / rangeM) ** 4;
  const ratio = returnPower / (1 + clutter);
  const quality = ratio / (1 + ratio);
  if (diagnostics) Object.assign(diagnostics, { returnPower, clutter, quality });
  return quality;
}
