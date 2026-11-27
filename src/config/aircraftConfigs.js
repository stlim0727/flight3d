// Implementation lives in the independently versioned flightsim-core package.
// Flight3d exposes the subset of core aircraft that have Flight3d 3D models,
// cockpits, and scenario/demo profiles.
import {
  BOEING_737_800,
  F16_FALCON,
  CESSNA_172,
  AIRCRAFT_SPECS as CORE_AIRCRAFT_SPECS,
} from '@stlim0727/flightsim-core/config/aircraftConfigs.js';
export * from '@stlim0727/flightsim-core/config/aircraftConfigs.js';

export const AIRCRAFT_REGISTRY = Object.freeze({
  B738: BOEING_737_800,
  F16: F16_FALCON,
  C172: CESSNA_172,
});

export const AIRCRAFT_SPECS = Object.freeze({
  B738: CORE_AIRCRAFT_SPECS.B738,
  F16: CORE_AIRCRAFT_SPECS.F16,
  C172: CORE_AIRCRAFT_SPECS.C172,
});

export const AircraftSpecs = AIRCRAFT_SPECS;

const addonConfigs = new Map();
const addonSpecs = new Map();
const addonBaseAircraftIds = new Map();

export function registerAddonAircraft(descriptors = []) {
  for (const descriptor of descriptors) {
    if (!descriptor?.id || !descriptor.config) continue;
    addonConfigs.set(descriptor.id, descriptor.config);
    addonSpecs.set(descriptor.id, descriptor.spec);
    if (descriptor.baseAircraftId) addonBaseAircraftIds.set(descriptor.id, descriptor.baseAircraftId);
    else addonBaseAircraftIds.delete(descriptor.id);
  }
  return addonConfigs.size;
}

export function unregisterAddonAircraft(aircraftId) {
  const removedConfig = addonConfigs.delete(aircraftId);
  const removedSpec = addonSpecs.delete(aircraftId);
  const removedBase = addonBaseAircraftIds.delete(aircraftId);
  return removedConfig || removedSpec || removedBase;
}

export function resolveAircraftConfig(aircraftId) {
  return AIRCRAFT_REGISTRY[aircraftId] ?? addonConfigs.get(aircraftId) ?? null;
}

export function resolveAircraftSpec(aircraftId) {
  return AIRCRAFT_SPECS[aircraftId] ?? addonSpecs.get(aircraftId) ?? null;
}

export function resolveAddonBaseAircraftId(aircraftId) {
  return addonBaseAircraftIds.get(aircraftId) ?? null;
}

export function addonAircraftIds() {
  return [...addonConfigs.keys()];
}

/** Map any aircraft (including registered addons) to its closest built-in spawn speed profile. */
export function spawnProfileAircraftId(aircraftId) {
  if (aircraftId === 'B738' || aircraftId === 'C172' || aircraftId === 'F16') return aircraftId;
  const baseId = addonBaseAircraftIds.get(aircraftId);
  if (baseId === 'B738' || baseId === 'C172' || baseId === 'F16') return baseId;
  const config = resolveAircraftConfig(aircraftId);
  if (!config) return 'B738';
  const specType = config.specs?.type;
  if (specType === 'fighter' || specType === 'military') return 'F16';
  if (specType === 'generalAviation' || config.audio?.engineType === 'piston'
    || (Number.isFinite(config.massProperties?.currentMassKg) && config.massProperties.currentMassKg < 5000)) {
    return 'C172';
  }
  return 'B738';
}
