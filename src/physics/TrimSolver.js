import { Atmosphere } from './Atmosphere.js';

// Constants mirroring Aerodynamics.computeAero's control-surface geometry.
const MAX_ELEVATOR_RAD = 0.349;  // ±20° elevator travel
const TRIM_AUTHORITY = 0.35;     // trim-wheel degrees → equivalent elevator radians
const THRUST_MOMENT_ARM = 0.32;  // engine up-cant moment arm (m), nose-up per N of thrust

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Steady-state longitudinal trim solver (pure scalar math: no THREE, no DOM,
 * no mutation of the aero/engine instances).
 *
 * Solves the equilibrium equations that Aerodynamics.computeAero implements,
 * with rates zero and flow attached:
 *   lift   = W·cos(γ)
 *   thrust = D + W·sin(γ)
 *   q·S·c·Cm + T·arm = 0
 * for angle of attack, required thrust (then the steady engine map inverted
 * for throttle), and elevator/trim deflection.
 *
 * Assumes undamped, unsmoothed configuration: flap targets (not the lagged
 * currentFlapAngle), given gear drag state, still air, no ground effect.
 *
 * @param {object} aero     object exposing the Aerodynamics coefficient set
 *   (CL0_clean, CLa, alphaStallClean, CD0, Cm0, Cma, Cm_de, wingArea,
 *   meanChord, aspectRatio, oswaldEfficiency, mass, flapAngles, flapsIndex,
 *   tuning?.elevatorSensitivity)
 * @param {object} engines  object exposing numEngines and maxStaticThrustPerEngine
 * @param {object} state
 *   @param {number} state.iasKnots            target indicated airspeed
 *   @param {number} [state.altitudeMeters=0]
 *   @param {number} [state.flightPathAngleDeg=0]  + = climbing
 *   @param {number} [state.flapsIndex]        defaults to aero.flapsIndex
 *   @param {number} [state.gearState=0]       0..1 extended fraction
 *   @param {number} [state.spoilers=0]        0..1 deployed fraction
 *   @param {number} [state.massKg]            defaults to aero.mass
 * @returns {object} feasible trim ({feasible:true, elevator, pitchTrimDeg,
 *   throttle, thrustN, alphaDeg, ...}) or a rejection with `reason`
 *   ('airspeed', 'stall', 'thrust') and the diagnostic coefficients.
 */
export function solveTrim(aero, engines, state = {}) {
  const iasMs = Atmosphere.knotsToMs(state.iasKnots ?? 0);
  const altitudeMeters = state.altitudeMeters ?? 0;
  const gamma = (state.flightPathAngleDeg ?? 0) * Math.PI / 180;
  const flapsIndex = clamp(Math.round(state.flapsIndex ?? aero.flapsIndex ?? 0),
    0, (aero.flapAngles?.length ?? 1) - 1);
  const gearState = clamp(state.gearState ?? 0, 0, 1);
  const spoilers = clamp(state.spoilers ?? 0, 0, 1);
  const mass = state.massKg ?? aero.mass;

  const atmos = Atmosphere.getConditions(altitudeMeters);
  const tas = Atmosphere.iasToTas(iasMs, atmos.densityRatio);
  if (!(tas > 1.0) || !(mass > 0)) {
    return { feasible: false, reason: 'airspeed', tas, cl: 0, cd: 0,
      elevator: 0, pitchTrimDeg: 0, throttle: 0, thrustN: 0 };
  }

  const weight = mass * Atmosphere.G0;
  const q = 0.5 * atmos.density * tas * tas;
  const qS = q * aero.wingArea;
  const qSc = qS * aero.meanChord;

  // --- Lift balance → CL required → α (linear region only) ---
  const flapAngle = (aero.flapAngles?.[flapsIndex] ?? 0);
  const flapFraction = flapAngle / 40.0;
  const cl0 = aero.CL0_clean + 0.95 * flapFraction;
  const alphaStall = aero.alphaStallClean + 2.0 * Math.PI / 180 * flapFraction;
  const clMax = cl0 + aero.CLa * alphaStall;

  const clReq = (weight * Math.cos(gamma)) / qS;
  const alpha = (clReq - cl0) / aero.CLa;
  // Below the break, but keep a margin: the model loses ~28% of peak lift at
  // separation onset, so a solution at 95% of linear clMax would not survive
  // disturbances.
  if (clReq >= 0.95 * clMax || alpha >= alphaStall) {
    return { feasible: false, reason: 'stall', alphaDeg: alpha * 180 / Math.PI,
      cl: clReq, clMax, cd: 0, elevator: 0, pitchTrimDeg: 0, throttle: 0, thrustN: 0 };
  }

  // --- Drag polar mirrors computeAero (attached flow, no ground effect) ---
  const mach = tas / atmos.speedOfSound;
  let cdParasitic = aero.CD0
    + 0.0012 * flapAngle + 0.000045 * flapAngle * flapAngle
    + 0.024 * gearState
    + 0.075 * spoilers;
  if (mach > 0.78) cdParasitic += Math.pow(mach - 0.78, 3.5) * 8.0;
  const cdInduced = (clReq * clReq) / (Math.PI * aero.aspectRatio * aero.oswaldEfficiency);
  const cd = cdParasitic + cdInduced;
  const drag = qS * cd;
  const thrustReq = drag + weight * Math.sin(gamma);

  // --- Steady engine map inverted for throttle command ---
  const numEngines = Math.max(1, engines.numEngines ?? 2);
  const altitudeLapse = Math.pow(Math.max(0.1, atmos.densityRatio), 0.75);
  const ramLapse = Math.max(0.7, 1.0 - (tas / 300.0) * 0.25);
  const thrustScale = numEngines * engines.maxStaticThrustPerEngine * altitudeLapse * ramLapse;
  // Steady map: T = thrustScale · n1Norm^2.1, n1Norm = (2 + 78·throttle)/80.
  const n1Norm = thrustScale > 0
    ? Math.pow(Math.max(0, thrustReq) / thrustScale, 1 / 2.1) : Infinity;
  let throttle = (n1Norm * 80.0 - 2.0) / 78.0;
  const idleLimited = throttle < 0;
  const thrustLimited = throttle > 1;
  throttle = clamp(throttle, 0, 1);
  if (thrustLimited) {
    return { feasible: false, reason: 'thrust', alphaDeg: alpha * 180 / Math.PI,
      cl: clReq, cd, thrustRequiredN: thrustReq, thrustAvailableN: thrustScale,
      elevator: 0, pitchTrimDeg: 0, throttle: 1 };
  }

  // --- Pitch moment balance → elevator + trim wheel ---
  const effectiveThrust = idleLimited ? 0 : thrustReq;
  const cmNeeded = -(THRUST_MOMENT_ARM * effectiveThrust) / qSc;
  const elevatorEffectiveRad = (aero.Cm0 + aero.Cma * alpha - cmNeeded) / aero.Cm_de;
  const sensitivity = (aero.tuning?.elevatorSensitivity ?? 1.0);
  const elevator = clamp(elevatorEffectiveRad / (MAX_ELEVATOR_RAD * sensitivity), -1, 1);
  // Trim wheel that centers the elevator: (elevatorRad + trimRad) = elevatorEffectiveRad
  const pitchTrimDeg = ((elevatorEffectiveRad -
    elevator * MAX_ELEVATOR_RAD * sensitivity) / TRIM_AUTHORITY) * 180 / Math.PI;
  // Full wheel setting for hands-off flight (elevator neutral); the wheel
  // limits are Aerodynamics.setTrim's ±(−5..12).
  const handsOffTrimDeg = clamp(
    (elevatorEffectiveRad / TRIM_AUTHORITY) * 180 / Math.PI, -5, 12);

  return {
    feasible: true,
    reason: idleLimited ? 'idle' : undefined,
    alphaDeg: alpha * 180 / Math.PI,
    cl: clReq,
    clMax,
    cd,
    elevator,
    pitchTrimDeg: clamp(pitchTrimDeg, -5, 12), // Aerodynamics.setTrim wheel limits
    handsOffTrimDeg,
    surfaceLimited: Math.abs(elevatorEffectiveRad) > MAX_ELEVATOR_RAD * sensitivity,
    throttle,
    thrustN: effectiveThrust,
    tas,
    mach,
    qDyn: q,
  };
}
