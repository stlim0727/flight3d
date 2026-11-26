import { validateAddonManifest } from './addonContract.js';

const DEFAULT_ANIMATION = {
  azimuth: { node: 'azimuth_node', axis: 'x', input: 'rpm', continuous: true, rpmRange: [25, 100] },
  elevator: { node: 'elevator_node', axis: 'x', input: 'elevator', rangeDeg: [-20, 20] },
  rudder: { node: 'rudder_node', axis: 'y', input: 'rudder', rangeDeg: [-25, 25] },
  flaps: { node: 'flaps_node', axis: 'x', input: 'flapsIndex', rangeDeg: [0, 40] },
  gear: { node: 'gear_node', axis: 'y', input: 'gearState', rangeDeg: [0, 90] },
};

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
  if (derived) {
    for (const [field, value] of Object.entries({
      massKg: physics.massKg,
      wingspanM: physics.wingspanM,
      wingAreaM2: physics.wingAreaM2,
      lengthM: physics.lengthM,
    })) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${packId} physics.${field} must be a positive number`);
    }
    const fuelCapacityKg = physics.fuelCapacityKg ?? 0;
    if (!Number.isFinite(fuelCapacityKg) || fuelCapacityKg < 0) {
      throw new Error(`${packId} physics.fuelCapacityKg must be a non-negative number`);
    }
    if (fuelCapacityKg >= physics.massKg) {
      throw new Error(`${packId} physics.fuelCapacityKg must leave a positive empty mass`);
    }
    if (physics.massDistribution && fuelCapacityKg > 0
      && !physics.massDistribution.tanks?.some(tank => Number.isFinite(tank?.capacityKg) && tank.capacityKg > 0)) {
      throw new Error(`${packId} physics.massDistribution needs a positive-capacity tank`);
    }
    if (physics.massProperties && physics.massProperties.currentMassKg < physics.massKg - fuelCapacityKg) {
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
    ? aircraft.physics
    : {
      ...aircraft.physics,
      id: aircraft.id.toUpperCase(),
      name: manifest.attribution,
      configurationLimits: { flap: [0], gearOperating: Infinity, gearExtended: Infinity },
      massProperties: {
        currentMassKg: aircraft.physics.massKg,
        emptyWeightKg: aircraft.physics.massKg - (physics.fuelCapacityKg ?? 0),
        maxTakeoffWeightKg: aircraft.physics.massKg,
        Ixx: aircraft.physics.massKg * aircraft.physics.lengthM ** 2 / 12,
        Iyy: aircraft.physics.massKg * aircraft.physics.lengthM ** 2 / 12,
        Izz: aircraft.physics.massKg * aircraft.physics.wingspanM ** 2 / 12,
      },
      massDistribution: aircraft.physics.massDistribution ?? {
        referenceMassKg: aircraft.physics.massKg,
        initialFuelKg: physics.fuelCapacityKg ?? 0,
        initialPayloadKg: 0,
        tanks: physics.fuelCapacityKg
          ? [{ id: 'main', capacityKg: physics.fuelCapacityKg, position: { x: 0, y: 0, z: 0 }, priority: 0 }]
          : [],
        stations: [{ id: 'payload', capacityKg: aircraft.physics.massKg, position: { x: 0, y: 0, z: 0 } }],
      },
      aerodynamics: {
        ...aircraft.physics.aerodynamics,
        wingspanM: aircraft.physics.wingspanM,
        wingAreaM2: aircraft.physics.wingAreaM2,
        flapAngles: aircraft.physics.aerodynamics?.flapAngles ?? [0],
      },
      stallWarning: aircraft.physics.stallWarning ?? { type: 'lowSpeed', marginDeg: 2 },
      propulsion: aircraft.physics.propulsion ?? {
        numEngines: 1,
        engineName: 'Generic piston engine',
        maxStaticThrustPerEngineN: aircraft.physics.massKg * 4,
        idleN1Percent: 25,
        togaN1Percent: 100,
        spoolUpTimeSec: 0.8,
        spoolDownTimeSec: 0.8,
        reverseThrustEfficiency: 0,
        baseFuelFlowKgPerHour: 20,
        maxFuelFlowKgPerHour: 50,
        fuelCapacityKg: physics.fuelCapacityKg ?? 0,
        momentArmMeters: 0,
      },
      landingGear: aircraft.physics.landingGear ?? {
        isFixed: true,
        cgGroundHeightM: 1.3,
        gearTransitTimeSec: 0.1,
        contacts: [
          { id: 'nose', localPos: { x: 0, y: -1.1, z: -aircraft.physics.lengthM * 0.2 }, wheelRadius: 0.2, restLength: 0.5, kSpring: 120000, cDamper: 15000, isSteerable: true, maxSteeringDeg: 30 },
          { id: 'mainLeft', localPos: { x: -1, y: -1.15, z: aircraft.physics.lengthM * 0.05 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000 },
          { id: 'mainRight', localPos: { x: 1, y: -1.15, z: aircraft.physics.lengthM * 0.05 }, wheelRadius: 0.25, restLength: 0.5, kSpring: 180000, cDamper: 20000 },
        ],
        rollingFriction: 0.025,
        maxBrakingFriction: 0.4,
        tireLateralFriction: 0.7,
      },
      cockpit: aircraft.physics.cockpit ?? {
        hasPhotoCockpit: false,
        captainEyePos: { x: 0, y: 0.7, z: -aircraft.physics.lengthM * 0.15 },
        defaultFov: 68,
        exteriorFov: 55,
        chaseDistance: 14,
        chaseHeight: 3,
      },
      specs: aircraft.physics.specs ?? {
        id: aircraft.id.toUpperCase(),
        name: manifest.attribution,
        type: 'generalAviation',
        limitLoad: { min: -1.5, max: 3.8 },
        ultimateLoad: { min: -2.25, max: 5.7 },
        oleoStrokeM: 0.15,
        hardLandingGThreshold: 1.7,
        crashGThreshold: 2.5,
        landingRatings: [],
      },
    };
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
