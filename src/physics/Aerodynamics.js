import * as THREE from 'three';
import { Atmosphere } from './Atmosphere.js';
import { BOEING_737_800 } from '../config/aircraftConfigs.js';

/**
 * 6-DOF Aerodynamic Physics Simulation Engine
 * Implements full rigid body equations of motion, nonlinear lift & stall hysteresis,
 * drag polar with ground effect, stability derivatives, inertia tensor, and control surface responses.
 */
export class Aerodynamics {
  constructor(config = BOEING_737_800) {
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
    this.isStalled = false;
    this.isPreStall = false; // Within shaker margin of the critical AoA
    this.stallSeverity = 0.0; // 0.0 to 1.0
    this.buffetVibration = 0.0; // For cockpit shaking

    this.lift = 0.0;
    this.drag = 0.0;
    this.sideForce = 0.0;
    this.gForce = 1.0;

    // Wind vector in world space (m/s)
    this.windWorld = new THREE.Vector3(0, 0, 0);
  }

  loadConfig(config) {
    const aero = config.aerodynamics || {};
    const mass = config.massProperties || {};

    this.mass = mass.currentMassKg || 66000.0;
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

    this.CL0_clean = aero.cl0Clean || 0.22;
    this.CLa = aero.claPerRad || 5.65;
    this.alphaStallClean = THREE.MathUtils.degToRad(aero.alphaStallDeg || 15.5);
    this.CD0 = aero.cd0Clean || 0.0185;

    this.Cm0 = aero.cm0 || -0.02;
    this.Cma = aero.cma || -0.85;
    this.Cm_de = aero.cmDe || -1.35;
    this.Cmq = aero.cmQ || -15.5;

    this.Cl_b = aero.clBeta || -0.14;
    this.Cl_da = aero.clDa || 0.19;
    this.Cl_p = aero.clP || -0.52;

    this.Cn_b = -Math.abs(aero.cnBeta !== undefined ? aero.cnBeta : 0.22);
    this.Cn_dr = aero.cnDr || -0.12;
    this.Cn_r = aero.cnR || -0.32;
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
  computeAero(dt, aircraftMesh, linearVelocityWorld, angularVelocityBody, altitudeMeters, heightAboveGround, engineThrustTotal, gearState) {
    // Smooth flap mechanical transition
    const targetFlap = this.flapAngles[this.flapsIndex];
    this.currentFlapAngle += (targetFlap - this.currentFlapAngle) * Math.min(1.0, dt * 0.4);

    // Atmospheric properties at current altitude
    const atmos = Atmosphere.getConditions(altitudeMeters);

    // Compute relative airflow velocity in world frame: v_rel = v_aircraft - v_wind
    const vAirWorld = linearVelocityWorld.clone().sub(this.windWorld);

    // Transform relative airspeed vector into aircraft body frame
    // Three.js local axes:
    // +X: Right wing
    // +Y: Upward through cabin ceiling
    // -Z: Forward through nose
    const invQuat = aircraftMesh.quaternion.clone().invert();
    const vBody = vAirWorld.clone().applyQuaternion(invQuat);

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

    // --- Nonlinear Lift Model with Stall & Hysteresis ---
    // AoA vanes need meaningful relative airflow before a stall can be declared;
    // below ~30 kt TAS (e.g. taxiing or sliding on the ground) the flag is inhibited.
    const stallAnnunciationValid = tas > 15.0;
    let cl;
    const absAlpha = Math.abs(this.alpha);
    if (absAlpha <= alphaStall) {
      // Linear unstalled region
      cl = cl0 + this.CLa * this.alpha;
      this.isStalled = false;
      this.stallSeverity = 0.0;
      this.buffetVibration = 0.0;
      // Stick-shaker margin: within ~2 degrees of the critical AoA
      this.isPreStall = stallAnnunciationValid && absAlpha >= alphaStall - THREE.MathUtils.degToRad(2.0);
    } else {
      // Post-stall separation region
      this.isStalled = stallAnnunciationValid;
      this.isPreStall = false;
      const stallExcess = (absAlpha - alphaStall) / THREE.MathUtils.degToRad(12.0);
      this.stallSeverity = Math.min(1.0, stallExcess);
      this.buffetVibration = Math.min(1.0, this.stallSeverity * 1.5) * (qDyn > 500 ? 1.0 : qDyn / 500.0);

      // Flat plate blend at high AoA
      const clLinear = cl0 + this.CLa * Math.sign(this.alpha) * alphaStall;
      const clFlatPlate = 2.0 * Math.sin(this.alpha) * Math.cos(this.alpha);
      const blend = Math.min(1.0, Math.pow(this.stallSeverity, 1.3));
      cl = (1.0 - blend) * clLinear * 0.72 + blend * clFlatPlate;
    }

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
    cdParasitic += 0.024 * gearState;
    // Spoiler drag
    cdParasitic += 0.075 * this.spoilers;
    // Wave drag / high mach compressibility drag
    if (this.mach > 0.78) {
      cdParasitic += Math.pow(this.mach - 0.78, 3.5) * 8.0;
    }

    // Induced drag: C_Di = (C_L^2) / (pi * AR * e) * geFactor
    const cdInduced = ((cl * cl) / (Math.PI * this.aspectRatio * this.oswaldEfficiency)) * geFactor;
    // Stall separation drag
    const cdStall = this.stallSeverity * 1.8 * Math.pow(Math.sin(this.alpha), 2);

    const cd = cdParasitic + cdInduced + cdStall;

    // Sideforce coefficient
    const cy = -0.75 * this.beta + 0.18 * this.rudder;

    // Aerodynamic Force magnitudes (Newtons)
    const liftForce = qDyn * this.wingArea * cl;
    const dragForce = qDyn * this.wingArea * cd;
    const sideForce = qDyn * this.wingArea * cy;

    this.lift = liftForce;
    this.drag = dragForce;
    this.sideForce = sideForce;

    // Aerodynamic forces in wind axis:
    // Lift is perpendicular to airspeed vector, Drag is parallel opposite to airspeed
    // Transform Lift and Drag into aircraft body frame (x_b, y_b, z_b):
    // In Three.js body frame:
    // +X: Right wing
    // +Y: Upward through cabin ceiling
    // -Z: Forward through nose (+Z is backward towards tail)
    // Relative wind blows along (+Z) with angle of attack alpha.
    // Drag acts parallel to relative wind (retarding along +Z).
    // Lift acts perpendicular to relative wind (lifting along +Y, tilted forward -Z with alpha).
    const cosA = Math.cos(this.alpha);
    const sinA = Math.sin(this.alpha);

    const aeroForceBody = new THREE.Vector3(
      sideForce,
      liftForce * cosA + dragForce * sinA, // Total upward force along body +Y
      dragForce * cosA - liftForce * sinA  // Total longitudinal force along body +Z (+Z opposes forward motion)
    );

    // Transform aerodynamic force to world frame
    const aeroForceWorld = aeroForceBody.clone().applyQuaternion(aircraftMesh.quaternion);

    // Calculate aerodynamic load factor: normal force in body Y / (mass * g0)
    this.gForce = Math.max(-3.0, Math.min(6.0, (aeroForceBody.y / (this.mass * Atmosphere.G0))));

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
    const trimRad = THREE.MathUtils.degToRad(this.pitchTrim) * 0.35;
    // Post-stall the horizontal tail sits in the separated wake and loses authority,
    // so the elevator can no longer hold the nose at deep stall AoA.
    const elevatorEffectiveness = 1.0 - 0.8 * this.stallSeverity;
    const elevatorEffective = (elevatorRad + trimRad) * elevatorEffectiveness;
    // In Three.js body frame, positive Mx lifts nose UP, so stick back (-Cm_de > 0) creates positive pitch moment
    let cm = this.Cm0 + this.Cma * this.alpha - this.Cm_de * elevatorEffective + this.Cmq * qHat;

    // Stall pitch break (swept wing airliners pitch down sharply as outboard lift collapses)
    if (this.isStalled) {
      cm -= this.stallSeverity * (0.55 + 0.5 * this.stallSeverity) * Math.sign(this.alpha);
    }

    // Engine thrust pitch coupling: engines slung below CG with 2.5° upward cant (~0.32m effective moment arm)
    const thrustPitchMoment = (engineThrustTotal * 0.32);

    // Rolling moment coefficient Cl:
    // Includes dihedral effect (Cl_b), aileron input, roll damping (Cl_p), and differential spoiler roll
    const aileronRad = this.aileron * maxAileronRad * this.tuning.aileronSensitivity;
    const spoilerRoll = aileronRad > 0.02 ? aileronRad * 0.05 : (aileronRad < -0.02 ? aileronRad * 0.05 : 0);
    // Past the stall the swept wing loses dihedral weathervane stability: sideslip feeds a
    // wing drop instead of damping it, so an asymmetric stall rolls the aircraft over.
    const stallRollDivergence = this.stallSeverity * 0.8 * this.beta;
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

    const aeroMomentBody = new THREE.Vector3(
      pitchMoment, // Rotation around X (Pitch: positive pitch up)
      yawMoment,   // Rotation around Y (Yaw: negative yaw right)
      rollMoment   // Rotation around Z (Roll: negative roll right)
    );

    return {
      forceWorld: aeroForceWorld,
      momentBody: aeroMomentBody,
      alphaDeg: THREE.MathUtils.radToDeg(this.alpha),
      betaDeg: THREE.MathUtils.radToDeg(this.beta),
      iasKnots: Atmosphere.msToKnots(this.ias),
      tasKnots: Atmosphere.msToKnots(this.tas),
      mach: this.mach,
      qDyn: this.qDyn,
      cl,
      cd,
      lift: this.lift,
      drag: this.drag,
      isStalled: this.isStalled,
      isPreStall: this.isPreStall,
      stallSeverity: this.stallSeverity,
      buffetVibration: this.buffetVibration,
      gForce: this.gForce
    };
  }
}
