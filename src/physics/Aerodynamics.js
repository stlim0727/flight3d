import * as THREE from 'three';
import { Atmosphere } from './Atmosphere.js';
import { BOEING_737_800 } from '../config/aircraftConfigs.js';
import { TRIM_WHEEL_AUTHORITY } from './trimWheel.js';
import { MassProperties } from './MassProperties.js';
import { longitudinalForces } from './longitudinalForces.js';

export function createAeroResult() {
  return { forceWorld: new THREE.Vector3(), momentBody: new THREE.Vector3() };
}

/**
 * 6-DOF Aerodynamic Physics Simulation Engine
 * Implements full rigid body equations of motion, nonlinear lift & stall hysteresis,
 * drag polar with ground effect, stability derivatives, inertia tensor, and control surface responses.
 */
export class Aerodynamics {
  constructor(config = BOEING_737_800) {
    this._longitudinal = {};
    this.loadConfig(config);

    // Dynamic Live Tuning Overrides
    this.tuning = {
      elevatorSensitivity: 1.0,
      aileronSensitivity: 1.0,
      rudderSensitivity: 1.0,
      stallAngleMultiplier: 1.0,
      groundEffectMultiplier: 1.0,
      liftMultiplier: 1.0,
      dragMultiplier: 1.0
    };

    // Control Surface Inputs (-1.0 to +1.0 or 0 to 1)
    this.elevator = 0.0; // Pitch: positive pulls nose UP (stick back)
    this.aileron = 0.0;  // Roll: positive banks RIGHT
    this.rudder = 0.0;   // Yaw: positive yaws NOSE RIGHT (right pedal)
    this.pitchTrim = 0.0; // Trim degrees (-5° to +12°)
    this.flapsIndex = 0; // 0=0°, 1=1°, 2=5°, 3=15°, 4=20°, 5=30°, 6=40°
    this.flapAngles = config.aerodynamics?.flapAngles || [0, 1, 5, 15, 20, 30, 40];
    this.currentFlapAngle = 0.0;
    this.spoilers = 0.0; // 0.0 to 1.0 (Airbrakes / Flight Spoilers)

    // Dynamic State Outputs
    this.alpha = 0.0; // Angle of attack (radians)
    this.beta = 0.0;  // Sideslip angle (radians)
    this.tas = 0.0;   // True airspeed (m/s)
    this.ias = 0.0;   // Indicated airspeed (m/s)
    this.mach = 0.0;
    this.qDyn = 0.0;  // Dynamic pressure (Pa)
    // Flow-separation state 0.0 (attached) → 1.0 (fully detached). Continuously
    // evolved per timestep: onset follows the instantaneous AoA target abruptly
    // (airfoil separation), reattachment decays exponentially (wake hysteresis).
    // All stall-related coefficients are continuous functions of this state;
    // the flags below are derived from it for annunciation only.
    this.separation = 0.0;
    this.isStalled = false;
    this.isPreStall = false; // Within shaker margin of the critical AoA
    this.stallSeverity = 0.0; // 0.0 to 1.0 (mirrors separation for HUD/telemetry)
    this.buffetVibration = 0.0; // For cockpit shaking

    this.lift = 0.0;
    this.drag = 0.0;
    this.sideForce = 0.0;
    this.gForce = 1.0;

    // Wind vector in world space (m/s)
    this.windWorld = new THREE.Vector3(0, 0, 0);
    this._airVelocity = new THREE.Vector3();
    this._bodyVelocity = new THREE.Vector3();
    this._inverseQuaternion = new THREE.Quaternion();
  }

  loadConfig(config) {
    const aero = config.aerodynamics || {};
    const mass = config.massProperties || {};

    this.mass = mass.currentMassKg || 66000.0;
    // The mass this aircraft was configured with, before any fuel is burned.
    // Compatibility metadata; the mass ledger owns reset and live fuel burn.
    this.massBaselineKg = this.mass;
    this.massProperties = new MassProperties(config);
    this.cg = this.massProperties.cg;
    this.tailArmM = aero.tailArmM ?? 0;
    this.tailAreaM2 = aero.tailAreaM2 ?? 1;
    this.tailInducedFactor = aero.tailInducedFactor ?? 0.1;
    this.wingspan = aero.wingspanM || 35.8;
    this.wingArea = aero.wingAreaM2 || 124.6;
    this.meanChord = aero.meanChordM || 3.99;
    this.aspectRatio = (this.wingspan * this.wingspan) / this.wingArea;
    this.oswaldEfficiency = aero.oswaldEfficiency || 0.82;

    this.Ixx = mass.Ixx || 1380000.0;
    this.Iyy = mass.Iyy || 2650000.0;
    this.Izz = mass.Izz || 3900000.0;
    this.invIxx = 1.0 / this.Ixx;
    this.invIyy = 1.0 / this.Iyy;
    this.invIzz = 1.0 / this.Izz;
    this.syncMassProperties();
    this.massBaselineKg = this.mass;

    this.CL0_clean = aero.cl0Clean || 0.22;
    this.CLa = aero.claPerRad || 5.65;
    this.alphaStallClean = THREE.MathUtils.degToRad(aero.alphaStallDeg || 15.5);
    this.CD0 = aero.cd0Clean || 0.0185;
    this.stallWarningConfig = config.stallWarning || { marginDeg: 2.0 };
    this.warningReferenceMass = mass.maxTakeoffWeightKg || this.mass;
    this.isStallWarning = false;
    // Optional gear-handle input; standalone callers fall back to gear position.
    this.gearHandleDown = undefined;

    this.Cm0 = aero.cm0 ?? -0.02;
    this.thrustPitchArmM = config.propulsion?.pitchMomentArmMeters ?? 0.32;
    this.Cma = aero.cma || -0.85;
    this.Cm_de = aero.cmDe || -1.35;
    this.Cmq = aero.cmQ || -15.5;

    this.Cl_b = aero.clBeta || -0.14;
    this.Cl_da = aero.clDa || 0.19;
    this.Cl_p = aero.clP || -0.52;

    this.Cn_b = -Math.abs(aero.cnBeta !== undefined ? aero.cnBeta : 0.22);
    this.Cn_dr = aero.cnDr || -0.12;
    this.Cn_r = aero.cnR || -0.32;

    this.gearDrag = aero.gearDrag ?? 0.024;
    this.spoilerDrag = aero.spoilerDrag ?? 0.075;
    this.transonicMachBuffet = aero.transonicMachBuffet ?? 0.78;

    if (aero.flapAngles && Array.isArray(aero.flapAngles) && aero.flapAngles.length > 0) {
      this.flapAngles = [...aero.flapAngles];
    } else {
      this.flapAngles = [0, 1, 5, 15, 20, 30, 40];
    }
    this.flapsIndex = Math.max(0, Math.min(this.flapAngles.length - 1, this.flapsIndex ?? 0));
    this.currentFlapAngle = this.flapAngles[this.flapsIndex];
  }

  advanceFlaps(dt) {
    const target = this.flapAngles[this.flapsIndex];
    this.currentFlapAngle += (target - this.currentFlapAngle) * Math.min(1, dt * 0.4);
  }

  syncMassProperties() {
    const state = this.massProperties;
    this.mass = state.massKg;
    this.Ixx = state.inertia.z;
    this.Iyy = state.inertia.x;
    this.Izz = state.inertia.y;
    this.invIxx = state.inverseInertia.z;
    this.invIyy = state.inverseInertia.x;
    this.invIzz = state.inverseInertia.y;
  }

  setFlapPosition(index) {
    this.flapsIndex = Math.max(0, Math.min(this.flapAngles.length - 1, index));
  }

  cycleFlaps(increment) {
    this.setFlapPosition(this.flapsIndex + increment);
  }

  toggleSpoilers() {
    this.spoilers = this.spoilers > 0.1 ? 0.0 : 1.0;
  }

  setTrim(delta) {
    this.pitchTrim = Math.max(-5.0, Math.min(12.0, this.pitchTrim + delta));
  }

  /**
   * Compute aerodynamic forces and moments
   * @param {number} dt 
   * @param {THREE.Object3D} aircraftMesh 
   * @param {THREE.Vector3} linearVelocityWorld (m/s)
   * @param {THREE.Vector3} angularVelocityBody (rad/s) [p, q, r]
   * @param {number} altitudeMeters 
   * @param {number} heightAboveGround 
   * @param {number} engineThrustTotal (Newtons)
   * @param {number} gearState (0.0 to 1.0)
   */
  computeAero(dt, aircraftMesh, linearVelocityWorld, angularVelocityBody, altitudeMeters, heightAboveGround, engineThrustTotal, gearState, result = createAeroResult(), configurationAdvanced = false) {
    if (!configurationAdvanced) this.advanceFlaps(dt);

    // Atmospheric properties at current altitude
    const atmos = Atmosphere.getConditions(altitudeMeters);

    // Compute relative airflow velocity in world frame: v_rel = v_aircraft - v_wind
    const vAirWorld = this._airVelocity.copy(linearVelocityWorld).sub(this.windWorld);

    // Transform relative airspeed vector into aircraft body frame
    // Three.js local axes:
    // +X: Right wing
    // +Y: Upward through cabin ceiling
    // -Z: Forward through nose
    const invQuat = this._inverseQuaternion.copy(aircraftMesh.quaternion).invert();
    const vBody = this._bodyVelocity.copy(vAirWorld).applyQuaternion(invQuat);

    // Aeronautical body velocity convention:
    // u: Forward velocity = -vBody.z
    // v: Lateral velocity = vBody.x (rightward)
    // w: Normal downward velocity = -vBody.y (downward)
    const u = -vBody.z;
    const v = vBody.x;
    const w = -vBody.y;

    const tas = Math.sqrt(u * u + v * v + w * w);
    this.tas = tas;
    this.ias = Atmosphere.tasToIas(tas, atmos.densityRatio);
    this.mach = tas / atmos.speedOfSound;

    // Angle of attack (alpha) and sideslip (beta)
    if (tas > 1.5) {
      this.alpha = Math.atan2(w, Math.max(0.5, u));
      this.beta = Math.asin(Math.max(-1.0, Math.min(1.0, v / tas)));
    } else {
      this.alpha = 0;
      this.beta = 0;
    }

    // Dynamic pressure: q = 0.5 * rho * V^2
    const qDyn = 0.5 * atmos.density * (tas * tas);
    this.qDyn = qDyn;

    // --- Flap & Slat Effects ---
    const flapFraction = this.currentFlapAngle / 40.0;
    const cl0 = this.CL0_clean + 0.95 * flapFraction;
    const alphaStall = this.alphaStallClean + THREE.MathUtils.degToRad(2.0 * flapFraction);

    // --- Nonlinear Lift Model driven by the separation state ---
    // Separation magnitude is weighted by airflow validity: at near-stagnant
    // TAS the dynamic pressure is ~0 anyway, but the weight keeps the state
    // model well-posed and prevents spurious AoA (taxi, ground slide) from
    // accumulating a separation history.
    const absAlpha = Math.abs(this.alpha);
    const separationWeight = THREE.MathUtils.clamp((tas - 2.0) / 13.0, 0.0, 1.0);
    const separationTarget = THREE.MathUtils.clamp(
      (absAlpha - alphaStall) / THREE.MathUtils.degToRad(12.0), 0.0, 1.0) * separationWeight;
    // Onset is abrupt; reattachment lags with ~0.5 s exponential time
    // constant (reattachment hysteresis typical of swept transport sections).
    const reattachMix = 1.0 - Math.exp(-dt / 0.5);
    this.separation = Math.max(separationTarget, this.separation * (1.0 - reattachMix));

    // Annunciation flags derived from sensed airflow (like real AoA vane and
    // stick-shaker logic, which genuinely is threshold-based); they never feed
    // the force model.
    this.stallSeverity = this.separation;
    const stallAnnunciationValid = tas > 15.0;
    this.isStalled = stallAnnunciationValid && this.separation > 0.1;
    // Real positive-AoA warning sensors are separate from the magnitude-based
    // separation diagnostic. Inverted attitude alone does not reverse AoA.
    const warning = this.stallWarningConfig;
    let warningAlpha = alphaStall - THREE.MathUtils.degToRad(warning.marginDeg ?? 2.0);
    if (warning.type === 'pneumaticHorn') {
      // Calibrate a fixed AoA threshold to the POH's 5–10 kt warning margin
      // in reference 1g flight. Never gate the horn on IAS: accelerated stalls
      // must still warn. Use the current model's attached-flow CLmax.
      const clMax = cl0 + this.CLa * alphaStall;
      const referenceVs = Math.sqrt(2 * this.warningReferenceMass * Atmosphere.G0 /
        (1.225 * this.wingArea * clMax));
      const speedRatio = referenceVs / (referenceVs + warning.referenceMarginKnots / 1.94384);
      warningAlpha = (clMax * speedRatio * speedRatio - cl0) / this.CLa;
    } else if (warning.type === 'lowSpeed' && (this.gearHandleDown ?? gearState > 0.5)) {
      warningAlpha = THREE.MathUtils.degToRad(warning.gearDownAlphaDeg);
    }
    this.stallWarningAlphaDeg = THREE.MathUtils.radToDeg(warningAlpha);
    this.isStallWarning = stallAnnunciationValid && this.alpha > warningAlpha;
    this.isPreStall = this.isStallWarning && !this.isStalled;

    // Lift is a continuous function of the separation state:
    // - clCapped: linear curve truncated at the stall break (CLmax), C0-continuous
    // - brk: the ~28% loss of peak lift at first separation; sharp (over the
    //   first few tenths of a degree past alphaStall) but not a switch
    // - W: progress of the separated wake toward the flat-plate limit
    // During reattachment (state decaying below alphaStall) the same weights
    // multiply the *current* linear curve, so lingering separation reduces
    // lift instead of inflating it (hysteresis deficit).
    const clCapped = cl0 + this.CLa * Math.sign(this.alpha) * Math.min(absAlpha, alphaStall);
    const clFlatPlate = 2.0 * Math.sin(this.alpha) * Math.cos(this.alpha);
    const brk = 1.0 - Math.exp(-this.separation / 0.01);
    const W = Math.pow(this.separation, 1.3);
    let cl = (1.0 - W) * (1.0 - 0.28 * brk) * clCapped + W * clFlatPlate;

    // Buffet intensity scales with dynamic pressure; turbulent separated
    // wake needs meaningful airflow to shake the airframe.
    const qBuffetScale = Math.min(1.0, qDyn / 500.0);
    this.buffetVibration = Math.min(1.0, this.separation * 1.5) * qBuffetScale;

    // Spoiler lift dump
    cl -= 0.38 * this.spoilers;

    // --- Ground Effect on Lift and Drag ---
    // Ground effect reduces induced drag significantly and adds slight cushion lift
    let geFactor = 1.0;
    if (heightAboveGround < this.wingspan * 1.2) {
      const h_b = Math.max(0.08, heightAboveGround / this.wingspan);
      geFactor = (16.0 * h_b * h_b) / (1.0 + 16.0 * h_b * h_b);
      // Extra cushion lift when within half wingspan
      if (h_b < 0.5) {
        cl *= 1.0 + 0.12 * (0.5 - h_b);
      }
    }

    // --- Drag Polar ---
    // Parasitic drag
    let cdParasitic = this.CD0;
    // Flap drag
    cdParasitic += 0.0012 * this.currentFlapAngle + 0.000045 * (this.currentFlapAngle * this.currentFlapAngle);
    // Landing gear drag
    cdParasitic += this.gearDrag * gearState;
    // Spoiler drag
    cdParasitic += this.spoilerDrag * this.spoilers;
    // Wave drag / high mach compressibility drag
    if (this.mach > this.transonicMachBuffet) {
      cdParasitic += Math.pow(this.mach - this.transonicMachBuffet, 3.5) * 8.0;
    }

    // Induced drag: C_Di = (C_L^2) / (pi * AR * e) * geFactor
    const cdInduced = ((cl * cl) / (Math.PI * this.aspectRatio * this.oswaldEfficiency)) * geFactor;
    // Separation wake drag grows continuously with the separated area
    const cdStall = this.separation * 1.8 * Math.pow(Math.sin(this.alpha), 2);

    const cd = cdParasitic + cdInduced + cdStall;

    // Sideforce coefficient
    const cy = -0.75 * this.beta + 0.18 * this.rudder;

    // Lateral force; the shared longitudinal model below combines the existing
    // whole-aircraft CL/CD with the incremental tail before rotating to world.
    const sideForce = qDyn * this.wingArea * cy;
    this.sideForce = sideForce;

    // --- Aerodynamic Moments (Pitch, Roll, Yaw) in Body Frame ---
    // In Three.js body frame:
    // X-axis: Pitch (q) around lateral axis
    // Y-axis: Yaw (r) around vertical axis
    // Z-axis: Roll (p) around longitudinal axis
    const q = angularVelocityBody.x; // Pitch rate (rad/s)
    const r = angularVelocityBody.y; // Yaw rate (rad/s)
    const p = angularVelocityBody.z; // Roll rate (rad/s)

    // Dynamic damping nondimensional variables: (rate * dimension) / (2 * V)
    const vRef = Math.max(10.0, tas);
    const qHat = (q * this.meanChord) / (2.0 * vRef);
    const pHat = (p * this.wingspan) / (2.0 * vRef);
    const rHat = (r * this.wingspan) / (2.0 * vRef);

    // Physical control surface deflection in radians:
    // Boeing 737 max surface travels:
    // Elevator: +/- 20° (0.349 rad)
    // Aileron: +/- 20° (0.349 rad)
    // Rudder: +/- 26° (0.454 rad)
    const maxElevatorRad = THREE.MathUtils.degToRad(20.0);
    const maxAileronRad = THREE.MathUtils.degToRad(20.0);
    const maxRudderRad = THREE.MathUtils.degToRad(26.0);

    // Pitching moment coefficient Cm:
    // Includes static stability (Cma), elevator input, pitch trim, pitch damping (Cmq)
    const elevatorRad = this.elevator * maxElevatorRad * this.tuning.elevatorSensitivity;
    const trimRad = THREE.MathUtils.degToRad(this.pitchTrim) * TRIM_WHEEL_AUTHORITY;
    // As separation spreads outboard the horizontal tail buries itself in the
    // wake and progressively loses authority (continuous with the state).
    const elevatorEffectiveness = 1.0 - 0.8 * this.separation;
    const elevatorEffective = (elevatorRad + trimRad) * elevatorEffectiveness;
    // In Three.js body frame, positive Mx lifts nose UP, so stick back (-Cm_de > 0) creates positive pitch moment
    let cm = this.Cm0 + this.Cma * this.alpha - this.Cm_de * elevatorEffective + this.Cmq * qHat;

    // Pitch break: outboard lift collapse pushes the nose down continuously
    // with the separated area, stronger as the wing deepens into the stall.
    cm -= 0.55 * this.separation * (1.0 + 0.9 * this.separation) * Math.sign(this.alpha);

    // Effective thrust pitch arm at the structural origin; CG shift is applied below.
    const thrustPitchMoment = engineThrustTotal * this.thrustPitchArmM;

    // Rolling moment coefficient Cl:
    // Includes dihedral effect (Cl_b), aileron input, roll damping (Cl_p), and differential spoiler roll
    const aileronRad = this.aileron * maxAileronRad * this.tuning.aileronSensitivity;
    const spoilerRoll = aileronRad > 0.02 ? aileronRad * 0.05 : (aileronRad < -0.02 ? aileronRad * 0.05 : 0);
    // Separation weakens the dihedral weathervane damping progressively:
    // a partly-separated wing feeds sideslip into a wing drop instead of
    // correcting it.
    const stallRollDivergence = this.separation * 0.8 * this.beta;
    const cl_roll = this.Cl_b * this.beta + this.Cl_da * (aileronRad + spoilerRoll) + Math.abs(this.Cl_p) * pHat + stallRollDivergence;

    // Yawing moment coefficient Cn:
    // Directional stability (Cn_b), rudder input, yaw damping (Cn_r), and adverse yaw from ailerons
    const rudderRad = this.rudder * maxRudderRad * this.tuning.rudderSensitivity;
    const adverseYaw = 0.025 * aileronRad;
    const cn = this.Cn_b * this.beta + this.Cn_dr * rudderRad + this.Cn_r * rHat + adverseYaw;

    // Moments in Body Frame (Newton-meters)
    // Note in Three.js aircraft:
    // +X (Pitch): positive rotation tilts nose UP
    // +Y (Yaw): negative rotation yaws nose RIGHT
    // +Z (Roll): negative rotation banks RIGHT
    const pitchMoment = qDyn * this.wingArea * this.meanChord * cm + thrustPitchMoment;
    const rollMoment = -(qDyn * this.wingArea * this.wingspan * cl_roll);
    const yawMoment = qDyn * this.wingArea * this.wingspan * cn;

    result.momentBody.set(
      pitchMoment, // Rotation around X (Pitch: positive pitch up)
      yawMoment,   // Rotation around Y (Yaw: negative yaw right)
      rollMoment   // Rotation around Z (Roll: negative roll right)
    );

    const longitudinal = longitudinalForces(this, qDyn, this.alpha, cl, cd,
      elevatorEffective, engineThrustTotal, this._longitudinal);
    result.forceWorld.set(sideForce, longitudinal.y, longitudinal.z).applyQuaternion(aircraftMesh.quaternion);
    result.momentBody.x += longitudinal.pitch - (qDyn * this.wingArea * this.meanChord *
      (this.Cm0 + this.Cma * this.alpha - this.Cm_de * elevatorEffective) + thrustPitchMoment);
    result.momentBody.y += this.cg.x * (longitudinal.z - engineThrustTotal) - this.cg.z * sideForce;
    result.momentBody.z += this.cg.y * sideForce - this.cg.x * longitudinal.y;
    this.lift = longitudinal.lift;
    this.drag = longitudinal.drag;
    this.gForce = longitudinal.y / (this.mass * Atmosphere.G0);
    result.tailForce = longitudinal.tailForce;
    result.tailDragDelta = longitudinal.tailDragDelta;

    result.alphaDeg = THREE.MathUtils.radToDeg(this.alpha);
    result.betaDeg = THREE.MathUtils.radToDeg(this.beta);
    result.iasKnots = Atmosphere.msToKnots(this.ias);
    result.tasKnots = Atmosphere.msToKnots(this.tas);
    result.mach = this.mach;
    result.qDyn = this.qDyn;
    result.cl = cl;
    result.cd = cd;
    result.lift = this.lift;
    result.drag = this.drag;
    result.isStalled = this.isStalled;
    result.isPreStall = this.isPreStall;
    result.stallSeverity = this.stallSeverity;
    result.isStallWarning = this.isStallWarning;
    result.stallWarningAlphaDeg = this.stallWarningAlphaDeg;
    result.separation = this.separation;
    result.buffetVibration = this.buffetVibration;
    result.gForce = this.gForce;
    return result;
  }
}
