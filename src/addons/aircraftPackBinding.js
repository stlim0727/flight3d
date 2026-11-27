import { validateAddonManifest } from './addonContract.js';
import { defaultBodySupportPoints, normalizeBodySupportPoints } from '../physics/groundContacts.js';

const DEFAULT_ANIMATION = {
  azimuth: { node: 'azimuth_node', axis: 'x', input: 'rpm', continuous: true, rpmRange: [25, 100] },
  elevator: { node: 'elevator_node', axis: 'x', input: 'elevator', rangeDeg: [-20, 20] },
  rudder: { node: 'rudder_node', axis: 'y', input: 'rudder', rangeDeg: [-25, 25] },
  flaps: { node: 'flaps_node', axis: 'x', input: 'flapsIndex', rangeDeg: [0, 40] },
  gear: { node: 'gear_node', axis: 'y', input: 'gearState', rangeDeg: [0, 90] },
};

function buildDefaultLandingGear({ lengthM = 8, wingspanM = 11, cgGroundHeightM = 1.3 } = {}) {
  return {
    isFixed: true,
    cgGroundHeightM,
    gearTransitTimeSec: 0.1,
    bodySupportPoints: defaultBodySupportPoints({ wingspanM, lengthM, cgGroundHeightM }),
    contacts: [
      { id: 'nose', localPos: { x: 0, y: -1.1, z: -lengthM * 0.2 }, wheelRadius: 0.2, restLength: 0.5, kSpring: 120000, cDamper: 15000, isSteerable: true, maxSteeringDeg: 30 },
      { id: 'mainLeft', localPos: { x: -1, y: -1.15, z: lengthM * 0.05 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000 },
      { id: 'mainRight', localPos: { x: 1, y: -1.15, z: lengthM * 0.05 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000 },
    ],
    rollingFriction: 0.025,
    maxBrakingFriction: 0.4,
    tireLateralFriction: 0.7,
  };
}

function buildDefaultPropulsion(massKg, fuelCapacityKg) {
  return {
    numEngines: 1,
    engineName: 'Generic piston engine',
    maxStaticThrustPerEngineN: massKg * 4,
    idleN1Percent: 25,
    togaN1Percent: 100,
    spoolUpTimeSec: 0.8,
    spoolDownTimeSec: 0.8,
    reverseThrustEfficiency: 0,
    baseFuelFlowKgPerHour: 20,
    maxFuelFlowKgPerHour: 50,
    fuelCapacityKg,
    momentArmMeters: 0,
  };
}

function buildDefaultSpecs(id, name) {
  return {
    id,
    name,
    type: 'generalAviation',
    limitLoad: { min: -1.5, max: 3.8 },
    ultimateLoad: { min: -2.25, max: 5.7 },
    oleoStrokeM: 0.15,
    hardLandingGThreshold: 1.7,
    crashGThreshold: 2.5,
    landingRatings: [],
  };
}

function normalizeLandingGear(gear, { lengthM, wingspanM }) {
  const cgGroundHeightM = gear?.cgGroundHeightM ?? 1.3;
  const defaults = buildDefaultLandingGear({ lengthM, wingspanM, cgGroundHeightM });
  return {
    ...defaults,
    ...gear,
    contacts: Array.isArray(gear?.contacts) && gear.contacts.length >= 3
      ? gear.contacts
      : defaults.contacts,
    bodySupportPoints: normalizeBodySupportPoints(gear?.bodySupportPoints, defaults.bodySupportPoints),
  };
}

function defaultFuelCapacityKg(massKg) {
  const positiveMass = Number.isFinite(massKg) && massKg > 0 ? massKg : 1050;
  const candidate = Math.round(positiveMass * 0.1);
  if (candidate > 0 && candidate < positiveMass) return candidate;
  return positiveMass * 0.1;
}

function mergePropulsion(propulsion, massKg, fuelCapacityKg) {
  const defaults = buildDefaultPropulsion(massKg, fuelCapacityKg);
  if (!propulsion) return defaults;
  return {
    ...defaults,
    ...propulsion,
    fuelCapacityKg: propulsion.fuelCapacityKg ?? fuelCapacityKg,
  };
}

function sumValidatedTankCapacity(tanks, packId) {
  if (!Array.isArray(tanks) || tanks.length === 0) {
    throw new Error(`${packId} physics.massDistribution tanks need positive capacity`);
  }
  return tanks.reduce((total, tank) => {
    if (!Number.isFinite(tank?.capacityKg) || tank.capacityKg <= 0) {
      throw new Error(`${packId} physics.massDistribution tanks need positive capacity`);
    }
    return total + tank.capacityKg;
  }, 0);
}

function buildDefaultMassDistribution(massProperties, fuelCapacityKg) {
  const initialFuelKg = Math.min(
    fuelCapacityKg,
    Math.max(0, massProperties.currentMassKg - massProperties.emptyWeightKg),
  );
  const initialPayloadKg = Math.max(
    0,
    massProperties.currentMassKg - massProperties.emptyWeightKg - initialFuelKg,
  );
  return {
    referenceMassKg: massProperties.currentMassKg,
    initialFuelKg,
    initialPayloadKg,
    tanks: fuelCapacityKg > 0
      ? [{ id: 'main', capacityKg: fuelCapacityKg, position: { x: 0, y: 0, z: 0 }, priority: 0 }]
      : [],
    stations: [{ id: 'payload', capacityKg: massProperties.maxTakeoffWeightKg, position: { x: 0, y: 0, z: 0 } }],
  };
}

function normalizeFullPhysicsConfig(aircraft, manifest) {
  const physics = aircraft.physics;
  const wingspanM = physics.aerodynamics?.wingspanM ?? physics.wingspanM ?? 11;
  const wingAreaM2 = physics.aerodynamics?.wingAreaM2 ?? physics.wingAreaM2 ?? 16;
  const lengthM = physics.lengthM ?? 8;
  const massKg = physics.massProperties?.currentMassKg ?? physics.massKg ?? 1050;
  const explicitFuelCapacity = physics.propulsion?.fuelCapacityKg ?? physics.fuelCapacityKg;
  const tankSum = Array.isArray(physics.massDistribution?.tanks)
    ? physics.massDistribution.tanks.reduce(
      (sum, tank) => sum + (Number.isFinite(tank?.capacityKg) && tank.capacityKg > 0 ? tank.capacityKg : 0),
      0,
    )
    : 0;
  const fuelCapacityKg = explicitFuelCapacity !== undefined
    ? explicitFuelCapacity
    : (tankSum > 0 ? tankSum : defaultFuelCapacityKg(massKg));
  const emptyWeightKg = physics.massProperties?.emptyWeightKg ?? Math.max(1, massKg - fuelCapacityKg);
  const maxTakeoffWeightKg = physics.massProperties?.maxTakeoffWeightKg ?? massKg;
  const massProperties = {
    currentMassKg: massKg,
    emptyWeightKg,
    maxTakeoffWeightKg,
    Ixx: massKg * lengthM ** 2 / 12,
    Iyy: massKg * lengthM ** 2 / 12,
    Izz: massKg * wingspanM ** 2 / 12,
    ...physics.massProperties,
  };
  const massDistribution = physics.massDistribution ?? buildDefaultMassDistribution(massProperties, fuelCapacityKg);
  const flapAngles = Array.isArray(physics.aerodynamics?.flapAngles) && physics.aerodynamics.flapAngles.length > 0
    ? physics.aerodynamics.flapAngles
    : [0];
  return {
    ...physics,
    name: physics.name ?? manifest.attribution,
    configurationLimits: physics.configurationLimits ?? { flap: [0], gearOperating: Infinity, gearExtended: Infinity },
    massProperties,
    massDistribution,
    aerodynamics: {
      ...physics.aerodynamics,
      wingspanM,
      wingAreaM2,
      flapAngles,
    },
    stallWarning: physics.stallWarning ?? { type: 'lowSpeed', marginDeg: 2 },
    propulsion: mergePropulsion(physics.propulsion, massKg, fuelCapacityKg),
    landingGear: normalizeLandingGear(physics.landingGear, { lengthM, wingspanM }),
    cockpit: physics.cockpit ?? {
      hasPhotoCockpit: false,
      captainEyePos: { x: 0, y: 0.7, z: -lengthM * 0.15 },
      defaultFov: 68,
      exteriorFov: 55,
      chaseDistance: 14,
      chaseHeight: 3,
    },
    specs: physics.specs ?? buildDefaultSpecs(physics.id, physics.name ?? manifest.attribution),
  };
}

function buildDerivedPhysicsConfig(aircraft, manifest, derivedFuelCapacityKg) {
  const physics = aircraft.physics;
  const derivedMassProperties = {
    currentMassKg: physics.massKg,
    emptyWeightKg: physics.massKg - derivedFuelCapacityKg,
    maxTakeoffWeightKg: physics.massKg,
    Ixx: physics.massKg * physics.lengthM ** 2 / 12,
    Iyy: physics.massKg * physics.lengthM ** 2 / 12,
    Izz: physics.massKg * physics.wingspanM ** 2 / 12,
    ...physics.massProperties,
  };
  return {
    ...physics,
    id: aircraft.id.toUpperCase(),
    name: manifest.attribution,
    configurationLimits: { flap: [0], gearOperating: Infinity, gearExtended: Infinity },
    massProperties: derivedMassProperties,
    massDistribution: physics.massDistribution ?? buildDefaultMassDistribution(derivedMassProperties, derivedFuelCapacityKg),
    aerodynamics: {
      ...physics.aerodynamics,
      wingspanM: physics.wingspanM,
      wingAreaM2: physics.wingAreaM2,
      flapAngles: physics.aerodynamics?.flapAngles ?? [0],
    },
    stallWarning: physics.stallWarning ?? { type: 'lowSpeed', marginDeg: 2 },
    propulsion: mergePropulsion(physics.propulsion, physics.massKg, derivedFuelCapacityKg),
    landingGear: normalizeLandingGear(physics.landingGear, {
      lengthM: physics.lengthM,
      wingspanM: physics.wingspanM,
    }),
    cockpit: physics.cockpit ?? {
      hasPhotoCockpit: false,
      captainEyePos: { x: 0, y: 0.7, z: -physics.lengthM * 0.15 },
      defaultFov: 68,
      exteriorFov: 55,
      chaseDistance: 14,
      chaseHeight: 3,
    },
    specs: physics.specs ?? buildDefaultSpecs(aircraft.id.toUpperCase(), manifest.attribution),
  };
}

export function aircraftPackFromProfile(profile, packId, { coreVersion } = {}) {
  const pin = profile?.pins?.find(entry => entry.id === packId);
  if (!pin) throw new Error(`profile does not pin ${packId}`);
  const manifest = pin.manifest;
  const result = validateAddonManifest(manifest, { coreVersion });
  if (!result.ok) throw new Error(`invalid pinned addon: ${result.errors.join('; ')}`);
  if (manifest.id !== packId || manifest.version !== pin.version) {
    throw new Error(`pinned manifest identity mismatch for ${packId}`);
  }
  const aircraft = manifest.aircraft;
  if (!aircraft) throw new Error(`${packId} is not an aircraft addon`);
  const physics = aircraft.physics ?? {};
  const derived = !physics.id;
  let derivedFuelCapacityKg = 0;
  if (derived) {
    for (const [field, value] of Object.entries({
      massKg: physics.massKg,
      wingspanM: physics.wingspanM,
      wingAreaM2: physics.wingAreaM2,
      lengthM: physics.lengthM,
    })) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${packId} physics.${field} must be a positive number`);
    }
    const explicitFuelCapacity = physics.propulsion?.fuelCapacityKg ?? physics.fuelCapacityKg;
    let validatedTankCapacityKg = null;
    if (explicitFuelCapacity !== undefined) {
      if (!Number.isFinite(explicitFuelCapacity) || explicitFuelCapacity < 0) {
        throw new Error(`${packId} physics.fuelCapacityKg must be a non-negative number`);
      }
      if (explicitFuelCapacity >= physics.massKg) {
        throw new Error(`${packId} physics.fuelCapacityKg must leave a positive empty mass`);
      }
      derivedFuelCapacityKg = explicitFuelCapacity;
    } else if (physics.massDistribution) {
      validatedTankCapacityKg = sumValidatedTankCapacity(physics.massDistribution.tanks, packId);
      if (validatedTankCapacityKg >= physics.massKg) {
        throw new Error(`${packId} physics.fuelCapacityKg must leave a positive empty mass`);
      }
      derivedFuelCapacityKg = validatedTankCapacityKg;
    } else {
      derivedFuelCapacityKg = defaultFuelCapacityKg(physics.massKg);
    }
    if (physics.massDistribution) {
      const distribution = physics.massDistribution;
      const tankCapacityKg = validatedTankCapacityKg ?? sumValidatedTankCapacity(distribution.tanks, packId);
      if (tankCapacityKg !== derivedFuelCapacityKg) {
        throw new Error(`${packId} physics.massDistribution tank capacity must match declared fuel capacity`);
      }
      const referenceMassKg = distribution.referenceMassKg ?? physics.massKg;
      if (referenceMassKg - (physics.massKg - derivedFuelCapacityKg) - tankCapacityKg < 0) {
        throw new Error(`${packId} physics.massDistribution tank capacity exceeds the reference payload`);
      }
      if (Number.isFinite(distribution.initialFuelKg) && distribution.initialFuelKg > tankCapacityKg) {
        throw new Error(`${packId} physics.massDistribution initial fuel exceeds tank capacity`);
      }
    }
    if (physics.massProperties && physics.massProperties.currentMassKg < physics.massKg - derivedFuelCapacityKg) {
      throw new Error(`${packId} physics.massProperties.currentMassKg is below the empty mass`);
    }
  }
  for (const resource of [aircraft.model, aircraft.cockpit].filter(Boolean)) {
    if (!/^https?:\/\//.test(resource.url)) throw new Error('aircraft asset URL must be absolute http(s)');
  }
  const controls = { ...DEFAULT_ANIMATION };
  for (const [control, node] of Object.entries(aircraft.controlBindings ?? {})) {
    controls[control] = { ...(controls[control] ?? {}), node };
  }
  if (aircraft.animation?.controls) {
    for (const [control, binding] of Object.entries(aircraft.animation.controls)) {
      controls[control] = { ...(controls[control] ?? {}), ...binding };
    }
  }
  const config = aircraft.physics?.id
    ? normalizeFullPhysicsConfig(aircraft, manifest)
    : buildDerivedPhysicsConfig(aircraft, manifest, derivedFuelCapacityKg);
  return Object.freeze({
    id: aircraft.id,
    packId,
    version: pin.version,
    sha256: pin.sha256,
    config: Object.freeze(config),
    spec: Object.freeze(config.specs ?? { id: aircraft.id, name: config.name }),
    model: Object.freeze(aircraft.model),
    cockpit: aircraft.cockpit ? Object.freeze(aircraft.cockpit) : null,
    controls: Object.freeze(controls),
    title: config.name ?? packId,
  });
}
