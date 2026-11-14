/** Relative, dimensionless IR approximation. Constants are game-model assumptions,
 * not AIM-9X radiometry, real temperatures or measured acquisition distances.
 */
export const IR_MODEL = Object.freeze({ referenceRangeM: 4000, referenceEmission: 1.28,
  airframeFloor: 0.08, hotBodyGain: 0.2, frontPlumeGain: 0.2, afterburnerGain: 3,
  coldEgtC: 15, hotEgtC: 850 });

const clamp01 = value => Math.max(0, Math.min(1, value));

/** Publish actual spooled N1 and lagged EGT, not the throttle command.
 * afterburner is an explicit 0..1 input: the current engine has no AB dynamics.
 */
export function sampleEngineInfrared(engines, afterburner, output) {
  let power = 0, heat = 0;
  for (let i = 0; i < engines.numEngines; i++) {
    power += clamp01((engines.n1[i] - engines.idleN1) / (engines.togaN1 - engines.idleN1));
    heat += clamp01((engines.egt[i] - IR_MODEL.coldEgtC) / (IR_MODEL.hotEgtC - IR_MODEL.coldEgtC));
  }
  output.enginePower = power / engines.numEngines;
  output.heat = heat / engines.numEngines;
  output.afterburner = afterburner;
  output.omnidirectional = false;
}

/** Target forward -Z; a rear observer has dot(forward, target->observer)=-1.
 * Optional diagnostics do not feed back into the aircraft or seeker controller.
 */
export function infraredSignalQuality(observer, target, rangeM, diagnostics) {
  if (diagnostics) Object.assign(diagnostics, { emission: 0, received: 0, quality: 0, aspectGain: 0 });
  const signature = target.infraredSignature;
  if (!signature || !Number.isFinite(rangeM) || rangeM <= 0) return 0;
  const { enginePower, heat, afterburner } = signature;
  if (!Number.isFinite(enginePower) || !Number.isFinite(heat) || !Number.isFinite(afterburner)) return 0;
  let rear = 1;
  if (!signature.omnidirectional) {
    const q = target.quaternion;
    if (!q) return 0;
    const norm = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) return 0;
    const dx = observer.position.x - target.position.x;
    const dy = observer.position.y - target.position.y;
    const dz = observer.position.z - target.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (!(distance > 0)) return 0;
    const dot = (-2 * (q.x * q.z + q.w * q.y) * dx
      - 2 * (q.y * q.z - q.w * q.x) * dy
      - (1 - 2 * (q.x * q.x + q.y * q.y)) * dz) / distance;
    rear = clamp01((1 - dot) * 0.5);
  }
  const power = clamp01(enginePower), thermal = clamp01(heat), ab = clamp01(afterburner);
  const aspectGain = IR_MODEL.frontPlumeGain + (1 - IR_MODEL.frontPlumeGain) * rear * rear;
  const emission = IR_MODEL.airframeFloor + IR_MODEL.hotBodyGain * thermal
    + thermal * (power * power + IR_MODEL.afterburnerGain * ab * power) * aspectGain;
  // Compact-source free-space spreading, normalized against a hot rear emitter
  // at 4 km. Softened only below one metre, outside the seeker's range gate.
  const received = emission / IR_MODEL.referenceEmission
    * IR_MODEL.referenceRangeM ** 2 / Math.max(1, rangeM * rangeM);
  const quality = received / (1 + received);
  if (diagnostics) Object.assign(diagnostics, { emission, received, quality, aspectGain });
  return quality;
}
