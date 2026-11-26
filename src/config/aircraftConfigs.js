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

export function registerAddonAircraft(descriptors = []) {
  for (const descriptor of descriptors) {
    if (!descriptor?.id || !descriptor.config) continue;
    addonConfigs.set(descriptor.id, descriptor.config);
    addonSpecs.set(descriptor.id, descriptor.spec);
  }
  return addonConfigs.size;
}

export function resolveAircraftConfig(aircraftId) {
  return AIRCRAFT_REGISTRY[aircraftId] ?? addonConfigs.get(aircraftId) ?? null;
}

export function resolveAircraftSpec(aircraftId) {
  return AIRCRAFT_SPECS[aircraftId] ?? addonSpecs.get(aircraftId) ?? null;
}

export function addonAircraftIds() {
  return [...addonConfigs.keys()];
}
