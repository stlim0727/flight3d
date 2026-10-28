import * as THREE from 'three';
import { AIRCRAFT_REGISTRY } from '../../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../../src/physics/Aerodynamics.js';
import { EngineModel } from '../../src/physics/EngineModel.js';
import { solveTrim } from '../../src/physics/TrimSolver.js';
import { shapeTouchStick } from '../../src/controls/TouchFlightControls.js';

// Representative clean/approach fixtures, not certified operating limits.
export const CONTROL_AUDIT_CASES = [
  { id: 'B738', phase: 'approach', iasKnots: 145, altitudeMeters: 1000, flapsIndex: 5, gearState: 1 },
  { id: 'B738', phase: 'cruise', iasKnots: 250, altitudeMeters: 3000, flapsIndex: 0, gearState: 0 },
  { id: 'C172', phase: 'approach', iasKnots: 65, altitudeMeters: 1000, flapsIndex: 3, gearState: 1 },
  { id: 'C172', phase: 'cruise', iasKnots: 110, altitudeMeters: 1000, flapsIndex: 0, gearState: 1 },
  { id: 'F16', phase: 'approach', iasKnots: 170, altitudeMeters: 1000, flapsIndex: 1, gearState: 1 },
  { id: 'F16', phase: 'cruise', iasKnots: 350, altitudeMeters: 3000, flapsIndex: 0, gearState: 0 },
];

export function measureControlResponse(state) {
  const config = AIRCRAFT_REGISTRY[state.id];
  const aero = new Aerodynamics(config);
  const engines = new EngineModel(config);
  const trim = solveTrim(aero, engines, state);
  if (!trim.feasible) throw new Error(`${state.id} ${state.phase}: trim ${trim.reason}`);
  aero.flapsIndex = state.flapsIndex;
  aero.currentFlapAngle = aero.flapAngles[state.flapsIndex];
  // Use solved surface demand here so trim-wheel range does not bias derivatives.
  aero.elevator = trim.elevator;
  aero.pitchTrim = trim.pitchTrimDeg;
  const mesh = new THREE.Object3D();
  const alpha = THREE.MathUtils.degToRad(trim.alphaDeg);
  mesh.quaternion.setFromEuler(new THREE.Euler(alpha, 0, 0));
  const velocity = new THREE.Vector3(0, 0, -trim.tas);
  const moment = (rates = new THREE.Vector3()) => aero.computeAero(0, mesh, velocity, rates,
    state.altitudeMeters, 10000, trim.thrustN, state.gearState).momentBody.clone();
  const baseline = moment();
  const stiffness = Math.max(0.4, 1 - Math.max(0, (state.iasKnots - 140) / 220) * 0.55);
  const raw = 5 / 24;
  const shaped = shapeTouchStick(0, raw)[1];
  function acceleration(input) {
    aero.elevator = trim.elevator + input * stiffness;
    const pitch = moment().x - baseline.x;
    aero.elevator = trim.elevator;
    aero.aileron = input * stiffness;
    const roll = moment().z - baseline.z;
    aero.aileron = 0;
    return {
      pitchDegSec2: THREE.MathUtils.radToDeg(pitch * aero.invIyy),
      rollDegSec2: THREE.MathUtils.radToDeg(-roll * aero.invIxx),
    };
  }
  const before = acceleration(raw);
  const positive = acceleration(shaped), negative = acceleration(-shaped);
  const damping = ['x', 'y', 'z'].map(axis => {
    const rate = new THREE.Vector3(); rate[axis] = 0.1;
    return (moment(rate)[axis] - baseline[axis]) * rate[axis];
  });
  // Positive yaw points the nose left. With fixed world velocity, a positive
  // heading perturbation must produce a negative (restoring) yaw moment.
  mesh.quaternion.setFromEuler(new THREE.Euler(alpha, 0.02, 0, 'YXZ'));
  const yawRestoringNm = moment().y - baseline.y;
  return { ...state, massKg: aero.mass, trim: { alphaDeg: trim.alphaDeg, handsOffFeasible: trim.handsOffFeasible },
    input: { raw, shaped, stiffness }, before, after: positive, negative, damping, yawRestoringNm };
}
