import { Atmosphere } from './Atmosphere.js';
import { TRIM_WHEEL_AUTHORITY } from './trimWheel.js';
import { longitudinalForces } from './longitudinalForces.js';
import { thrustFactorToN1 } from './EngineModel.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MAX_ELEVATOR_RAD = Math.PI / 9;

// Pivoted 3x3 solve, off the physics tick (preset/LMC/AP capture).
function solveLinear(a, b) {
  const rows = a.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(rows[i][k]) > Math.abs(rows[pivot][k])) pivot = i;
    [rows[k], rows[pivot]] = [rows[pivot], rows[k]];
    if (Math.abs(rows[k][k]) < 1e-12) return null;
    const divisor = rows[k][k];
    for (let j = k; j < 4; j++) rows[k][j] /= divisor;
    for (let i = 0; i < 3; i++) if (i !== k) {
      const f = rows[i][k];
      for (let j = k; j < 4; j++) rows[i][j] -= f * rows[k][j];
    }
  }
  return rows.map(r => r[3]);
}

/** Steady attached-flow trim using the live incremental tail and CG moments.
 * Solves normal force, path force and pitch moment simultaneously, without
 * changing live separation state. Still air, no ground effect, zero rates.
 */
export function solveTrim(aero, engines, state = {}) {
  const mass = state.massKg ?? aero.mass;
  const atmos = Atmosphere.getConditions(state.altitudeMeters ?? 0);
  const tas = Atmosphere.iasToTas(Atmosphere.knotsToMs(state.iasKnots ?? 0), atmos.densityRatio);
  const reject = reason => ({ feasible: false, handsOffFeasible: false, reason,
    elevator: 0, pitchTrimDeg: 0, throttle: 0, tas });
  if (!(tas > 1) || !(mass > 0) || !Number.isFinite(tas + mass)) return reject('airspeed');
  const gamma = (state.flightPathAngleDeg ?? 0) * Math.PI / 180;
  const flapIndex = clamp(Math.round(state.flapsIndex ?? aero.flapsIndex ?? 0), 0, aero.flapAngles.length - 1);
  const flap = state.flapAngle ?? aero.flapAngles[flapIndex];
  const gear = state.gearState ?? 0, spoilers = state.spoilers ?? 0;
  const q = 0.5 * atmos.density * tas * tas, qS = q * aero.wingArea;
  const weight = mass * Atmosphere.G0;
  const cl0 = aero.CL0_clean + 0.95 * flap / 40 - 0.38 * spoilers;
  const alphaStall = aero.alphaStallClean + 2 * Math.PI / 180 * flap / 40;
  const clMax = cl0 + aero.CLa * alphaStall;
  const mach = tas / atmos.speedOfSound;
  const cd0 = aero.CD0 + 0.0012 * flap + 0.000045 * flap * flap
    + aero.gearDrag * gear + aero.spoilerDrag * spoilers
    + (mach > aero.transonicMachBuffet ? (mach - aero.transonicMachBuffet) ** 3.5 * 8 : 0);
  const proxy = state.cgBody ? Object.assign(Object.create(aero), { cg: state.cgBody }) : aero;
  const result = {};
  function residual(x) {
    const [alpha, elevator, thrustRatio] = x;
    const cl = cl0 + aero.CLa * alpha;
    const cd = cd0 + cl * cl / (Math.PI * aero.aspectRatio * aero.oswaldEfficiency);
    const thrust = thrustRatio * qS;
    longitudinalForces(proxy, q, alpha, cl, cd, elevator, thrust, result);
    const sin = Math.sin(alpha), cos = Math.cos(alpha);
    return [
      (result.y * cos - result.z * sin + thrust * sin - weight * Math.cos(gamma)) / qS,
      (-result.y * sin - result.z * cos + thrust * cos - weight * Math.sin(gamma)) / qS,
      result.pitch / (qS * aero.meanChord),
    ];
  }
  const alpha0 = (weight * Math.cos(gamma) / qS - cl0) / aero.CLa;
  let x = [alpha0, (aero.Cm0 + aero.Cma * alpha0) / aero.Cm_de,
    cd0 + (weight / qS) ** 2 / (Math.PI * aero.aspectRatio * aero.oswaldEfficiency) + weight * Math.sin(gamma) / qS];
  let error;
  for (let i = 0; i < 24; i++) {
    error = residual(x);
    if (Math.max(...error.map(Math.abs)) < 1e-9) break;
    const jac = [[], [], []];
    for (let j = 0; j < 3; j++) {
      const trial = [...x]; trial[j] += 1e-5;
      const shifted = residual(trial);
      for (let k = 0; k < 3; k++) jac[k][j] = (shifted[k] - error[k]) / 1e-5;
    }
    const step = solveLinear(jac, error.map(v => -v));
    if (!step) return reject('convergence');
    x = x.map((v, j) => v + clamp(step[j], -0.5, 0.5));
  }
  error = residual(x);
  if (!x.every(Number.isFinite) || Math.max(...error.map(Math.abs)) > 1e-6) return reject('convergence');
  const [alpha, elevatorEffective, thrustRatio] = x;
  const cl = cl0 + aero.CLa * alpha;
  if (alpha >= alphaStall || cl >= 0.95 * clMax || alpha <= -alphaStall) return reject('stall');
  const thrustRequired = thrustRatio * qS;
  const scale = Math.max(1, engines.numEngines ?? 2) * engines.maxStaticThrustPerEngine
    * Math.max(0.1, atmos.densityRatio) ** 0.75 * Math.max(0.7, 1 - tas / 300 * 0.25);
  const idleN1 = engines.idleN1 ?? 22, maxN1 = engines.togaN1 ?? 100;
  const thrustFactor = Math.max(0, thrustRequired) / scale;
  const n1 = thrustFactorToN1(thrustFactor, idleN1, maxN1);
  const rawThrottle = (n1 - idleN1) / (maxN1 - idleN1);
  if (rawThrottle > 1) return { ...reject('thrust'), throttle: 1, thrustRequiredN: thrustRequired };
  const sensitivity = aero.tuning?.elevatorSensitivity ?? 1;
  const elevator = clamp(elevatorEffective / (MAX_ELEVATOR_RAD * sensitivity), -1, 1);
  const pitchTrimDeg = (elevatorEffective - elevator * MAX_ELEVATOR_RAD * sensitivity) / TRIM_WHEEL_AUTHORITY * 180 / Math.PI;
  const handsOffTrimDegRaw = elevatorEffective / TRIM_WHEEL_AUTHORITY * 180 / Math.PI;
  const surfaceLimited = Math.abs(elevatorEffective) > MAX_ELEVATOR_RAD * sensitivity;
  return {
    feasible: true, reason: rawThrottle < 0 ? 'idle' : undefined,
    alphaDeg: alpha * 180 / Math.PI, cl, clMax,
    cd: result.drag / qS, elevator, pitchTrimDeg: clamp(pitchTrimDeg, -5, 12),
    handsOffTrimDegRaw, handsOffTrimDeg: clamp(handsOffTrimDegRaw, -5, 12),
    handsOffFeasible: handsOffTrimDegRaw >= -5 && handsOffTrimDegRaw <= 12 && !surfaceLimited && rawThrottle >= 0,
    surfaceLimited, throttle: clamp(rawThrottle, 0, 1), thrustN: Math.max(0, thrustRequired),
    tas, mach, qDyn: q, residual: error, tailForce: result.tailForce, tailDragDelta: result.tailDragDelta,
  };
}
