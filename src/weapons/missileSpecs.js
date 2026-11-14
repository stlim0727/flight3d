/**
 * Air-to-air weapon data shared by the F-16 rail models, the guidance core and
 * the HUD. Values are game-calibrated to the published missile dimensions and
 * produce plausible kinematic performance, not manufacturer certifications.
 */
export const MISSILE_TYPES = {
  AIM9X: {
    id: 'AIM9X',
    labelKey: 'weapons.aim9x',
    fox: 2,
    lengthM: 3.02,
    diameterM: 0.127,
    dryMassKg: 70,
    propellantMassKg: 15,
    burnSeconds: 4.5,
    maxThrustN: 9000,
    dragCoefficient: 0.32,
    maxLateralG: 35,
    // Frontal-area coefficients and response lag: simulation assumptions,
    // not source-confirmed AIM-9X aerodynamic or actuator specifications.
    maxLiftCoefficient: 12,
    inducedDragFactor: 0.025,
    autopilotTimeConstantS: 0.12,
    // Sensor-state simulation assumptions, not measured weapon specifications.
    seekerType: 'IR',
    seekerAcquireSeconds: 0.15,
    seekerMemorySeconds: 0.6,
    seekerMinSignalQuality: 0.25,
    seekerFovDeg: 28,
    seekerRangeM: 8500,
    gimbalDeg: 65,
    // Simulation assumptions, independent sensing and damage distances.
    fuseRadiusM: 14,
    lethalRadiusM: 5,
    fragmentRadiusM: 14,
    navigationConstant: 4.0,
    maxLifeSeconds: 20,
  },
  AIM120C: {
    id: 'AIM120C',
    labelKey: 'weapons.aim120c',
    fox: 3,
    lengthM: 3.66,
    diameterM: 0.178,
    dryMassKg: 110,
    propellantMassKg: 42,
    burnSeconds: 6.5,
    maxThrustN: 16000,
    dragCoefficient: 0.28,
    maxLateralG: 35,
    // Same bounded aerodynamic approximation; no manufacturer calibration.
    maxLiftCoefficient: 12,
    inducedDragFactor: 0.025,
    autopilotTimeConstantS: 0.12,
    seekerType: 'ACTIVE_RADAR',
    seekerAcquireSeconds: 0.25,
    seekerMemorySeconds: 1.5,
    seekerMinSignalQuality: 0.25,
    seekerFovDeg: 28,
    seekerRangeM: 8500,
    gimbalDeg: 65,
    // Simulation assumptions, independent sensing and damage distances.
    fuseRadiusM: 14,
    lethalRadiusM: 5,
    fragmentRadiusM: 14,
    navigationConstant: 4.0,
    maxLifeSeconds: 24,
  },
};

for (const spec of Object.values(MISSILE_TYPES)) {
  spec.crossSectionM2 = Math.PI * (spec.diameterM / 2) ** 2;
  spec.massAtLaunchKg = spec.dryMassKg + spec.propellantMassKg;
}

/** Aircraft frame: +X starboard, +Y up, -Z nose. Order is the rail release order. */
export const F16_MISSILE_STATIONS = [
  { id: 'STA 1', type: 'AIM9X', position: [-5.04, 0.04, 2.45] },
  { id: 'STA 9', type: 'AIM9X', position: [5.04, 0.04, 2.45] },
  { id: 'STA 2', type: 'AIM9X', position: [-4.22, -0.50, 2.31] },
  { id: 'STA 8', type: 'AIM9X', position: [4.22, -0.50, 2.31] },
  { id: 'STA 3', type: 'AIM120C', position: [-3.22, -0.52, 1.66] },
  { id: 'STA 7', type: 'AIM120C', position: [3.22, -0.52, 1.66] },
];

export function missileSpec(type) {
  return MISSILE_TYPES[type] || null;
}
