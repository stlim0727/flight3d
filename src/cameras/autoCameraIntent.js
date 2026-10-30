/** Context, rather than an elapsed-time playlist, chooses the automatic view. */
export function autoCameraIntent(state = {}, agl = Infinity) {
  if (state.onGround) return (state.groundSpeedKnots ?? state.iasKnots ?? 0) < 25
    ? { context: 'parked', mode: 6 } : { context: 'ground-roll', mode: 1 };
  if (Math.abs(state.rollDeg ?? 0) > 30 || agl < 60) return { context: 'terrain-manoeuvre', mode: 1 };
  if ((state.gearState ?? 0) > .95 && agl < 600 && (state.vsiFpm ?? 0) < 0)
    return { context: 'approach', mode: 0 };
  if (agl < 180 && (state.iasKnots ?? 0) > 220 && Math.abs(state.vsiFpm ?? 0) < 800)
    return { context: 'low-pass', mode: 4 };
  if (agl < 300 || Math.abs(state.vsiFpm ?? 0) > 1200) return { context: 'departure', mode: 1 };
  return { context: 'cruise', mode: 6 };
}
