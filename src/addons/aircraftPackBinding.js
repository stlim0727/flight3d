import { BUILTIN_AIRCRAFT_IDS, validateAddonManifest } from './addonContract.js';
import { AIRCRAFT_REGISTRY, AIRCRAFT_SPECS } from '../config/aircraftConfigs.js';
import {
  defaultBodySupportPoints,
  normalizeBodySupportPoints,
  resolveBodySupportPoints,
} from '../physics/groundContacts.js';

const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_EXTENDS_DEPTH = 16;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_MERGE_KEYS.has(key)) continue;
      copy[key] = cloneValue(item);
    }
    return copy;
  }
  return value;
}

function deepMerge(base, override) {
  const result = isPlainObject(base) ? cloneValue(base) : {};
  if (!isPlainObject(override)) return result;
  for (const [key, value] of Object.entries(override)) {
    if (FORBIDDEN_MERGE_KEYS.has(key) || value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = cloneValue(value);
    }
  }
  return result;
}

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
  const aerodynamics = { ...physics.aerodynamics };
  if (aerodynamics.claPerRad === undefined && aerodynamics.clAlpha !== undefined) {
    aerodynamics.claPerRad = aerodynamics.clAlpha;
  }
  if (aerodynamics.cd0Clean === undefined && aerodynamics.cd0 !== undefined) {
    aerodynamics.cd0Clean = aerodynamics.cd0;
  }
  return {
    ...physics,
    name: physics.name ?? manifest.attribution,
    configurationLimits: physics.configurationLimits ?? { flap: [0], gearOperating: Infinity, gearExtended: Infinity },
    massProperties,
    massDistribution,
    aerodynamics: {
      ...aerodynamics,
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

function buildExtendedPhysicsConfig(baseConfig, baseSpec, aircraft, manifest, packId) {
  const physics = aircraft.physics ?? {};
  const merged = deepMerge(baseConfig, physics);
  const mergedAero = { ...merged.aerodynamics };
  const overrideAero = physics.aerodynamics ?? {};
  if (overrideAero.claPerRad === undefined && overrideAero.clAlpha !== undefined) {
    mergedAero.claPerRad = overrideAero.clAlpha;
  }
  if (overrideAero.cd0Clean === undefined && overrideAero.cd0 !== undefined) {
    mergedAero.cd0Clean = overrideAero.cd0;
  }
  merged.aerodynamics = mergedAero;
  if (physics.massKg !== undefined && physics.massProperties?.currentMassKg === undefined) {
    merged.massProperties = { ...(merged.massProperties ?? {}), currentMassKg: physics.massKg };
    if (physics.massProperties?.maxTakeoffWeightKg === undefined
      && Number.isFinite(merged.massProperties.maxTakeoffWeightKg)
      && merged.massProperties.maxTakeoffWeightKg < physics.massKg) {
      merged.massProperties.maxTakeoffWeightKg = physics.massKg;
    }
  }
  if (physics.wingspanM !== undefined && physics.aerodynamics?.wingspanM === undefined) {
    merged.aerodynamics = { ...(merged.aerodynamics ?? {}), wingspanM: physics.wingspanM };
  }
  if (physics.wingAreaM2 !== undefined && physics.aerodynamics?.wingAreaM2 === undefined) {
    merged.aerodynamics = { ...(merged.aerodynamics ?? {}), wingAreaM2: physics.wingAreaM2 };
  }
  if (physics.fuelCapacityKg !== undefined && physics.propulsion?.fuelCapacityKg === undefined) {
    merged.propulsion = { ...(merged.propulsion ?? {}), fuelCapacityKg: physics.fuelCapacityKg };
  }
  if (merged.massProperties
    && Number.isFinite(merged.massProperties.currentMassKg)
    && Number.isFinite(merged.massProperties.emptyWeightKg)
    && merged.massProperties.currentMassKg < merged.massProperties.emptyWeightKg) {
    throw new Error(`${packId} physics.massProperties.currentMassKg is below the empty mass`);
  }
  if (merged.propulsion
    && Number.isFinite(merged.propulsion.fuelCapacityKg)
    && merged.propulsion.fuelCapacityKg < 0) {
    throw new Error(`${packId} physics.fuelCapacityKg must be a non-negative number`);
  }
  if (physics.massDistribution?.tanks !== undefined) {
    sumValidatedTankCapacity(physics.massDistribution.tanks, packId);
  }
  if (merged.landingGear && (physics.landingGear?.bodySupportPoints !== undefined || !merged.landingGear.bodySupportPoints)) {
    const lengthM = merged.lengthM ?? 8;
    const wingspanM = merged.aerodynamics?.wingspanM ?? merged.wingspanM ?? 11;
    const cgGroundHeightM = merged.landingGear.cgGroundHeightM ?? 1.3;
    const fallbackPoints = physics.landingGear?.bodySupportPoints !== undefined
      ? defaultBodySupportPoints({ wingspanM, lengthM, cgGroundHeightM })
      : resolveBodySupportPoints(baseConfig);
    merged.landingGear = {
      ...merged.landingGear,
      bodySupportPoints: normalizeBodySupportPoints(
        merged.landingGear.bodySupportPoints,
        fallbackPoints,
      ),
    };
  }
  const id = physics.id ?? aircraft.id.toUpperCase();
  const name = physics.name ?? manifest.attribution;
  const mergedSpecs = deepMerge(
    baseSpec ?? baseConfig.specs ?? buildDefaultSpecs(id, name),
    physics.specs ?? {},
  );
  mergedSpecs.id = physics.specs?.id ?? id;
  mergedSpecs.name = physics.specs?.name ?? name;
  merged.id = id;
  merged.name = name;
  merged.specs = mergedSpecs;
  return merged;
}

function mergeControls(baseControls, aircraft) {
  const controls = cloneValue(baseControls ?? DEFAULT_ANIMATION);
  for (const [control, node] of Object.entries(aircraft.controlBindings ?? {})) {
    controls[control] = { ...(controls[control] ?? {}), node };
  }
  if (aircraft.animation?.controls) {
    for (const [control, binding] of Object.entries(aircraft.animation.controls)) {
      controls[control] = { ...(controls[control] ?? {}), ...binding };
    }
  }
  return controls;
}

function liveryResources(livery) {
  if (!livery) return [];
  const resources = [];
  if (livery.tailEmblem?.map) resources.push(livery.tailEmblem.map);
  for (const spec of Object.values(livery.materials ?? {})) {
    if (spec?.map) resources.push(spec.map);
  }
  return resources;
}

function mergeLivery(baseLivery, overrideLivery) {
  if (!baseLivery && !overrideLivery) return null;
  if (!baseLivery) return cloneValue(overrideLivery);
  if (!overrideLivery) return cloneValue(baseLivery);
  return deepMerge(baseLivery, overrideLivery);
}

function resolveAircraftPack(profile, packId, { coreVersion, visiting = new Set() } = {}) {
  if (visiting.has(packId)) throw new Error(`cyclic aircraft inheritance at ${packId}`);
  if (visiting.size > MAX_EXTENDS_DEPTH) throw new Error(`aircraft inheritance chain too deep at ${packId}`);
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

  if (aircraft.extends !== undefined) {
    visiting.add(packId);
    try {
      let baseConfig;
      let baseSpec;
      let baseModel = null;
      let baseCockpit = null;
      let baseLivery = null;
      let baseControls = DEFAULT_ANIMATION;
      let baseAircraftId = null;

      if (BUILTIN_AIRCRAFT_IDS.has(aircraft.extends)) {
        baseConfig = AIRCRAFT_REGISTRY[aircraft.extends];
        baseSpec = AIRCRAFT_SPECS[aircraft.extends];
        baseAircraftId = aircraft.extends;
      } else {
        const declaredDep = manifest.dependencies.find(dep => dep.id === aircraft.extends);
        if (!declaredDep) {
          throw new Error(`${packId} aircraft.extends ${aircraft.extends} must be declared in dependencies`);
        }
        const parentPin = profile?.pins?.find(entry => entry.id === aircraft.extends);
        if (!parentPin || parentPin.version !== declaredDep.version) {
          throw new Error(`profile does not pin ${aircraft.extends}@${declaredDep.version}`);
        }
        const parent = resolveAircraftPack(profile, aircraft.extends, { coreVersion, visiting });
        baseConfig = parent.config;
        baseSpec = parent.spec;
        baseModel = parent.model;
        baseCockpit = parent.cockpit;
        baseLivery = parent.livery;
        baseControls = parent.controls;
        baseAircraftId = parent.baseAircraftId;
      }

      const model = aircraft.model ?? baseModel ?? null;
      const cockpit = aircraft.cockpit ?? baseCockpit ?? null;
      const livery = mergeLivery(baseLivery, aircraft.livery);
      for (const resource of [model, cockpit, ...liveryResources(livery)].filter(Boolean)) {
        if (!/^https?:\/\//.test(resource.url)) throw new Error('aircraft asset URL must be absolute http(s)');
      }
      const controls = mergeControls(baseControls, aircraft);
      const config = buildExtendedPhysicsConfig(baseConfig, baseSpec, aircraft, manifest, packId);
      return Object.freeze({
        id: aircraft.id,
        packId,
        version: pin.version,
        sha256: pin.sha256,
        extends: aircraft.extends,
        baseAircraftId,
        config: Object.freeze(config),
        spec: Object.freeze(config.specs),
        model: model ? Object.freeze({ ...model }) : null,
        cockpit: cockpit ? Object.freeze({ ...cockpit }) : null,
        livery: livery ? Object.freeze(livery) : null,
        controls: Object.freeze(controls),
        title: config.name ?? packId,
      });
    } finally {
      visiting.delete(packId);
    }
  }

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
  const livery = aircraft.livery ? cloneValue(aircraft.livery) : null;
  for (const resource of [aircraft.model, aircraft.cockpit, ...liveryResources(livery)].filter(Boolean)) {
    if (!/^https?:\/\//.test(resource.url)) throw new Error('aircraft asset URL must be absolute http(s)');
  }
  const controls = mergeControls(DEFAULT_ANIMATION, aircraft);
  const config = aircraft.physics?.id
    ? normalizeFullPhysicsConfig(aircraft, manifest)
    : buildDerivedPhysicsConfig(aircraft, manifest, derivedFuelCapacityKg);
  return Object.freeze({
    id: aircraft.id,
    packId,
    version: pin.version,
    sha256: pin.sha256,
    extends: null,
    baseAircraftId: null,
    config: Object.freeze(config),
    spec: Object.freeze(config.specs ?? { id: aircraft.id, name: config.name }),
    model: Object.freeze(aircraft.model),
    cockpit: aircraft.cockpit ? Object.freeze(aircraft.cockpit) : null,
    livery: livery ? Object.freeze(livery) : null,
    controls: Object.freeze(controls),
    title: config.name ?? packId,
  });
}

export function aircraftPackFromProfile(profile, packId, { coreVersion } = {}) {
  return resolveAircraftPack(profile, packId, { coreVersion });
}
