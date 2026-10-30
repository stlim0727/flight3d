import { B738_MASS_DISTRIBUTION, C172_MASS_DISTRIBUTION, F16_MASS_DISTRIBUTION } from './massDistributions.js';
import { C172_BODY_SUPPORT_POINTS } from '../physics/groundContacts.js';

/**
 * @file aircraftConfigs.js
 * @description Centralized, typed, and extensible Aircraft Specification & Aerodynamic Configurations.
 * Allows adding new aircraft types (e.g. B737, B777, F-16, Cessna 172) by defining configuration objects.
 */

/**
 * @typedef {Object} AircraftConfig
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {Object} massProperties - Mass and inertia tensor values
 * @property {Object} aerodynamics - Dimensionless aerodynamic derivatives and geometry
 * @property {Object} propulsion - Engine thrust and spool dynamics
 * @property {Object} landingGear - Gear suspension, steering, and braking parameters
 * @property {Object} cockpit - Cockpit geometry, eye offsets, and instrument placements
 * @property {Object} [audio] - Engine sound profile and synthesized RPM tuning
 */

export const BOEING_737_800 = {
  id: 'B738',
  massDistribution: B738_MASS_DISTRIBUTION,
  name: 'Boeing 737-800',
  description: 'Twin-engine narrow-body jet airliner with CFM56-7B high-bypass turbofans',

  // 1. Mass & Inertial Properties
  massProperties: {
    emptyWeightKg: 41413,
    maxTakeoffWeightKg: 79010,
    currentMassKg: 66000.0,
    // Principal moments of inertia (kg·m^2) for heavy twin-jet airliner
    Ixx: 1650000.0, // Roll inertia (heavy fuel wings)
    Iyy: 3450000.0, // Pitch inertia (long heavy passenger fuselage)
    Izz: 4850000.0  // Yaw inertia
  },

  // 2. Aerodynamic Geometry & Stability Derivatives
  aerodynamics: {
    wingspanM: 35.8,       // Span b (m)
    wingAreaM2: 124.6,     // Area S (m^2)
    meanChordM: 3.99,      // MAC c_bar (m)
    // Calibrated game tail estimates, not manufacturer performance data.
    tailArmM: 12, tailAreaM2: 32, tailInducedFactor: 0.10,
    oswaldEfficiency: 0.82,// Span efficiency factor e

    // Lift parameters
    cl0Clean: 0.22,        // Zero-AoA clean lift
    claPerRad: 5.65,       // Lift slope dCL/dAlpha
    alphaStallDeg: 15.5,   // Clean stall angle of attack
    clFlapBoostMax: 0.95,  // Max lift boost at full flaps (40 deg)
    spoilerLiftDump: 0.38, // Lift dump with flight spoilers deployed

    // Drag parameters
    cd0Clean: 0.0185,      // Parasitic zero-lift drag
    gearDrag: 0.024,       // Additional parasitic drag with gear down
    spoilerDrag: 0.075,    // Additional drag with speedbrakes extended
    transonicMachBuffet: 0.78, // Mach threshold for compressibility drag

    // Longitudinal (Pitch) Stability Derivatives
    cm0: -0.02,            // Trim pitching moment at zero AoA
    cma: -0.90,            // Static pitch stability (dCm/dAlpha < 0)
    cmDe: -1.25,           // Elevator pitch control authority (dCm/dDe per rad)
    cmQ: -26.0,            // Heavy transport pitch rate damping derivative

    // Lateral-Directional (Roll & Yaw) Stability Derivatives
    clBeta: -0.14,         // Dihedral effect / sweepback roll (dCl/dBeta)
    clDa: 0.18,            // Aileron roll control authority (dCl/dDa per rad)
    clP: -0.65,            // Roll rate damping derivative
    cnBeta: -0.22,         // Directional weathercock stability (dCn/dBeta < 0 in Three.js Y-up)
    cnDr: -0.12,           // Rudder yaw control authority (dCn/dDr per rad)
    cnR: -0.32,            // Yaw rate damping derivative
    adverseYaw: -0.025,    // Adverse yaw coupling from aileron deflection

    // Flap detents (degrees)
    flapAngles: [0, 1, 5, 15, 20, 30, 40]
  },

  // See docs/development/stall-warning.md for sources and approximation limits.
  stallWarning: { type: 'stickShaker', marginDeg: 2.0 },

  // 3. Propulsion System (Twin Turbofans)
  propulsion: {
    numEngines: 2,
    engineName: 'CFM56-7B26',
    maxStaticThrustPerEngineN: 121000.0, // ~27,000 lbf each
    idleN1Percent: 22.0,
    togaN1Percent: 100.0,
    spoolUpTimeSec: 3.2,                 // Idle to TOGA response lag
    spoolDownTimeSec: 2.4,               // TOGA to Idle lag
    reverseThrustEfficiency: 0.45,       // 45% reverse thrust deflection
    baseFuelFlowKgPerHour: 350.0,
    maxFuelFlowKgPerHour: 2500.0,
    fuelCapacityKg: 14200.0
  },

  // 4. Landing Gear & Ground Interaction
  landingGear: {
    isFixed: false,
    cgGroundHeightM: 3.5,
    gearTransitTimeSec: 8.0,
    contacts: [
      {
        id: 'nose',
        name: 'Nose Gear',
        localPos: { x: 0.0, y: -3.27, z: -12.5 },
        wheelRadius: 0.38,
        restLength: 0.9,
        kSpring: 420000, // N/m
        cDamper: 48000,  // N/(m/s)
        isSteerable: true,
        maxSteeringDeg: 55.0
      },
      {
        id: 'mainLeft',
        name: 'Left Main Gear',
        localPos: { x: -3.2, y: -3.30, z: 1.8 },
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false
      },
      {
        id: 'mainRight',
        name: 'Right Main Gear',
        localPos: { x: 3.2, y: -3.30, z: 1.8 },
        wheelRadius: 0.48,
        restLength: 0.9,
        kSpring: 850000,
        cDamper: 72000,
        isSteerable: false
      }
    ],
    rollingFriction: 0.02,
    maxBrakingFriction: 0.45,
    tireLateralFriction: 0.75
  },

  // 5. Cockpit Camera & Instrument Layout
  cockpit: {
    hasPhotoCockpit: true,
    captainEyePos: { x: -0.39, y: 0.85, z: -12.35 },
    defaultLookPitchRad: -0.25,
    defaultFov: 68.0,
    exteriorFov: 55.0,
    chaseDistance: 55.0,
    chaseHeight: 10.5,
    droneDistance: 38.0,
    droneHeight: 11.5,
    gearCamOffset: { x: 2.2, y: -2.4, z: 6.2 },
    gearLookTarget: { x: -0.5, y: -1.9, z: -2.5 }
  }
};

export const F16_FALCON = {
  id: 'F16',
  massDistribution: F16_MASS_DISTRIBUTION,
  name: 'F-16 Fighting Falcon',
  description: 'Single-engine supersonic multirole fighter aircraft with afterburning turbofan',

  // 1. Mass & Inertial Properties
  massProperties: {
    emptyWeightKg: 8570,
    maxTakeoffWeightKg: 19200,
    currentMassKg: 12000.0,
    Ixx: 12800.0,
    Iyy: 75000.0,
    Izz: 82000.0
  },

  // 2. Aerodynamic Geometry & Stability Derivatives
  aerodynamics: {
    wingspanM: 9.96,
    wingAreaM2: 27.87,
    meanChordM: 3.45,
    // Calibrated game tail estimates, not manufacturer performance data.
    tailArmM: 4, tailAreaM2: 6, tailInducedFactor: 0.10,
    oswaldEfficiency: 0.75,

    cl0Clean: 0.05,
    claPerRad: 4.2,
    alphaStallDeg: 28.0,
    clFlapBoostMax: 0.35,
    spoilerLiftDump: 0.25,

    cd0Clean: 0.015,
    gearDrag: 0.030,
    spoilerDrag: 0.080,
    transonicMachBuffet: 0.95,

    cm0: 0.0,
    cma: -0.45,
    cmDe: -1.8,
    cmQ: -12.0,

    clBeta: -0.08,
    clDa: 0.35,
    clP: -0.45,
    cnBeta: -0.18,
    cnDr: -0.15,
    cnR: -0.25,
    adverseYaw: -0.010,

    flapAngles: [0, 20]
  },

  stallWarning: { type: 'lowSpeed', marginDeg: 2.0, gearDownAlphaDeg: 15.0 },

  // 3. Propulsion System (Single Afterburning Turbofan)
  propulsion: {
    numEngines: 1,
    engineName: 'F110-GE-129',
    // Centerline engine: no reference-origin thrust pitch moment. CG shifts
    // are accounted for separately by the longitudinal force model.
    pitchMomentArmMeters: 0.0,
    maxStaticThrustPerEngineN: 131000.0,
    idleN1Percent: 60.0,
    togaN1Percent: 100.0,
    spoolUpTimeSec: 1.2,
    spoolDownTimeSec: 1.5,
    reverseThrustEfficiency: 0.0,
    baseFuelFlowKgPerHour: 600.0,
    maxFuelFlowKgPerHour: 4500.0,
    fuelCapacityKg: 3200.0,
    momentArmMeters: 0.0
  },

  // 4. Landing Gear & Ground Interaction
  landingGear: {
    isFixed: false,
    bodySupportPoints: [
      ['belly', [0, -0.9, 0]], ['nose', [0, 0, -7.8]],
      ['tail', [0, 0, 8]], ['wingL', [-4.98, 0, 1.8]],
      ['wingR', [4.98, 0, 1.8]], ['engineL', [0, -0.7, 7.5]],
    ].map(([id, position], index) => ({ id, key: `${id}:${index}`, position, weight: 1 })),
    cgGroundHeightM: 1.85,
    gearTransitTimeSec: 5.0,
    contacts: [
      {
        id: 'nose',
        name: 'Nose Gear',
        localPos: { x: 0.0, y: -1.65, z: -2.35 },
        wheelRadius: 0.25,
        restLength: 0.8,
        kSpring: 350000,
        cDamper: 32000,
        isSteerable: true,
        maxSteeringDeg: 35.0
      },
      {
        id: 'mainLeft',
        name: 'Left Main Gear',
        localPos: { x: -1.1, y: -1.65, z: 1.65 },
        wheelRadius: 0.35,
        restLength: 0.8,
        kSpring: 450000,
        cDamper: 40000,
        isSteerable: false
      },
      {
        id: 'mainRight',
        name: 'Right Main Gear',
        localPos: { x: 1.1, y: -1.65, z: 1.65 },
        wheelRadius: 0.35,
        restLength: 0.8,
        kSpring: 450000,
        cDamper: 40000,
        isSteerable: false
      }
    ],
    rollingFriction: 0.02,
    maxBrakingFriction: 0.55,
    tireLateralFriction: 0.80
  },

  // 5. Cockpit Camera & Instrument Layout
  cockpit: {
    hasPhotoCockpit: false,
    captainEyePos: { x: 0.0, y: 1.08, z: -3.35 },
    portraitEyeX: 0.0, // Single seat stays centered in narrow viewports too.
    defaultLookPitchRad: -0.06,
    defaultFov: 75.0,
    exteriorFov: 60.0,
    chaseDistance: 18.0,
    chaseHeight: 4.5,
    droneDistance: 14.0,
    droneHeight: 4.8,
    gearCamOffset: { x: 3.0, y: -3.0, z: 5.0 },
    gearLookTarget: { x: 0.0, y: -1.0, z: -0.3 }
  }
};

export const CESSNA_172 = {
  id: 'C172',
  massDistribution: C172_MASS_DISTRIBUTION,
  name: 'Cessna 172 Skyhawk',
  description: 'Single-engine four-seat high-wing general aviation aircraft with piston engine',

  // 1. Mass & Inertial Properties
  massProperties: {
    emptyWeightKg: 767,
    maxTakeoffWeightKg: 1157,
    currentMassKg: 1050.0,
    Ixx: 1285.0,
    Iyy: 1825.0,
    Izz: 2667.0
  },

  // 2. Aerodynamic Geometry & Stability Derivatives
  aerodynamics: {
    wingspanM: 11.0,
    wingAreaM2: 16.2,
    meanChordM: 1.47,
    // Calibrated game tail estimates, not manufacturer performance data.
    tailArmM: 4, tailAreaM2: 4, tailInducedFactor: 0.10,
    oswaldEfficiency: 0.80,

    cl0Clean: 0.35,
    claPerRad: 5.1,
    alphaStallDeg: 14.0,
    clFlapBoostMax: 0.65,
    spoilerLiftDump: 0.0,

    cd0Clean: 0.027,
    gearDrag: 0.015,
    spoilerDrag: 0.0,
    transonicMachBuffet: 0.60,

    cm0: -0.04,
    cma: -0.75,
    cmDe: -1.35,
    cmQ: -14.0,

    clBeta: -0.09,
    clDa: 0.22,
    clP: -0.50,
    cnBeta: 0.12,
    cnDr: -0.09,
    cnR: -0.18,
    adverseYaw: -0.020,

    flapAngles: [0, 10, 20, 30]
  },

  stallWarning: { type: 'pneumaticHorn', referenceMarginKnots: 7.5 },

  // 3. Propulsion System (Single Piston Engine)
  propulsion: {
    numEngines: 1,
    engineName: 'Lycoming IO-360-L2A',
    maxStaticThrustPerEngineN: 3200.0,
    idleN1Percent: 25.0,
    togaN1Percent: 100.0,
    spoolUpTimeSec: 0.8,
    spoolDownTimeSec: 0.8,
    reverseThrustEfficiency: 0.0,
    baseFuelFlowKgPerHour: 28.0,
    maxFuelFlowKgPerHour: 48.0,
    fuelCapacityKg: 144.0,
    momentArmMeters: 0.0
  },

  // Synthesized piston/propeller sound tuning. RPM is estimated from the
  // current normalized engine telemetry, rather than treated as turbine N1.
  audio: {
    engineType: 'piston',
    idleRpm: 700,
    maxRpm: 2700,
    cylinders: 4,
    propellerBlades: 2
  },

  // 4. Landing Gear & Ground Interaction (Fixed Tricycle Gear)
  landingGear: {
    isFixed: true,
    cgGroundHeightM: 1.35,
    gearTransitTimeSec: 0.1,
    bodySupportPoints: C172_BODY_SUPPORT_POINTS,
    contacts: [
      {
        id: 'nose',
        name: 'Nose Gear',
        localPos: { x: 0.0, y: -1.1, z: -1.5 },
        wheelRadius: 0.20,
        restLength: 0.5,
        kSpring: 120000,
        cDamper: 15000,
        isSteerable: true,
        maxSteeringDeg: 30.0
      },
      {
        id: 'mainLeft',
        name: 'Left Main Gear',
        localPos: { x: -1.05, y: -1.15, z: 0.4 },
        wheelRadius: 0.25,
        restLength: 0.5,
        kSpring: 180000,
        cDamper: 20000,
        isSteerable: false
      },
      {
        id: 'mainRight',
        name: 'Right Main Gear',
        localPos: { x: 1.05, y: -1.15, z: 0.4 },
        wheelRadius: 0.25,
        restLength: 0.5,
        kSpring: 180000,
        cDamper: 20000,
        isSteerable: false
      }
    ],
    rollingFriction: 0.025,
    maxBrakingFriction: 0.40,
    tireLateralFriction: 0.70
  },

  // 5. Cockpit Camera & Instrument Layout
  cockpit: {
    hasPhotoCockpit: false,
    captainEyePos: { x: -0.22, y: 0.72, z: -1.18 },
    defaultLookPitchRad: -0.05,
    defaultFov: 68.0,
    exteriorFov: 55.0,
    chaseDistance: 14.0,
    chaseHeight: 3.2,
    droneDistance: 12.0,
    droneHeight: 3.5,
    gearCamOffset: { x: 0.8, y: -0.6, z: 1.2 },
    gearLookTarget: { x: 0.0, y: -0.8, z: -0.2 }
  }
};

/**
 * Registry of available aircraft configurations
 */
export const AIRCRAFT_REGISTRY = {
  B738: BOEING_737_800,
  F16: F16_FALCON,
  C172: CESSNA_172
};

export const DEFAULT_AIRCRAFT_ID = 'B738';
