/** Calibrated incremental tail model. Existing CL/CD describe the reference-CG
 * power-off trimmed airframe, not an isolated wing. Only the change from its inferred tail
 * load is added, so the old tail is not counted twice. SI, body +Y up, +Z aft.
 * Mutates caller-owned output; used by live aero and the steady trim residual.
 */
export function longitudinalForces(aero, qDyn, alpha, cl, cd, elevatorEffective, thrust, out) {
  const qS = qDyn * aero.wingArea;
  const qSc = qS * aero.meanChord;
  const baseCm = aero.Cm0 + aero.Cma * alpha;
  const controlCm = -aero.Cm_de * elevatorEffective;
  const arm = aero.tailArmM;
  const sin = Math.sin(alpha), cos = Math.cos(alpha);
  const projectedArm = arm * Math.max(0.2, cos);
  const tailReference = arm > 0 ? qSc * baseCm / projectedArm : 0;
  const tailActual = arm > 0 ? -qSc * controlCm / projectedArm : 0;
  const tailDelta = tailActual - tailReference;
  const tailDragDelta = arm > 0 && qDyn > 0
    ? (tailActual ** 2 - tailReference ** 2) * aero.tailInducedFactor / (qDyn * aero.tailAreaM2) : 0;
  const lift = qS * cl + tailDelta;
  const drag = Math.max(0, qS * cd + tailDragDelta);
  out.y = lift * cos + drag * sin;
  out.z = drag * cos - lift * sin;
  const c = aero.cg;
  // Shift aero AND configured effective thrust moment from reference O to CG once.
  out.pitch = qSc * (baseCm + controlCm) + thrust * aero.thrustPitchArmM
    + c.z * out.y - c.y * (out.z - thrust);
  out.lift = lift;
  out.drag = drag;
  out.tailForce = tailActual;
  out.tailDragDelta = tailDragDelta;
  return out;
}
