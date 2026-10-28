import { AIRCRAFT_REGISTRY, DEFAULT_AIRCRAFT_ID } from './aircraftConfigs.js';
import { DEFAULT_SCENARIO, isScenarioAvailable } from './scenarioRegistry.js';

export const AIRPORT_STORAGE_KEY = 'flight3d.airport';
export const AIRCRAFT_STORAGE_KEY = 'flight3d.aircraft';
export const PLANE_STORAGE_KEY = 'flight3d.plane';
export const SCENARIO_STORAGE_KEY = 'flight3d.scenario';
export const PRESET_STORAGE_KEY = 'flight3d.preset';

export const VALID_AIRPORTS = Object.freeze(['coastal', 'lukla', 'incheon', 'neon']);
export const DEFAULT_AIRPORT = 'coastal';
export const DEFAULT_AIRCRAFT = DEFAULT_AIRCRAFT_ID || 'B738';

export function resolveAirport(airport) {
  return VALID_AIRPORTS.includes(airport) ? airport : DEFAULT_AIRPORT;
}

export function resolveAircraft(aircraft) {
  return Object.hasOwn(AIRCRAFT_REGISTRY, aircraft) ? aircraft : DEFAULT_AIRCRAFT;
}

export function resolveScenario(scenario, airport = DEFAULT_AIRPORT, aircraft = DEFAULT_AIRCRAFT) {
  if (!scenario || typeof scenario !== 'string') return DEFAULT_SCENARIO;
  if (!isScenarioAvailable(airport, scenario)) return DEFAULT_SCENARIO;
  if (scenario === 'demo') {
    if (aircraft === 'F16' && !['lukla','incheon'].includes(airport)) return DEFAULT_SCENARIO;
    if (airport === 'incheon' && !['B738', 'C172','F16'].includes(aircraft)) return DEFAULT_SCENARIO;
  }
  return scenario;
}

function getSafeStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSavedFlightSelection(storage) {
  const s = getSafeStorage(storage);
  let savedAirport = null;
  let savedAircraft = null;
  let savedScenario = null;
  try {
    savedAirport = s?.getItem(AIRPORT_STORAGE_KEY);
    savedAircraft = s?.getItem(AIRCRAFT_STORAGE_KEY) || s?.getItem(PLANE_STORAGE_KEY);
    savedScenario = s?.getItem(SCENARIO_STORAGE_KEY) || s?.getItem(PRESET_STORAGE_KEY);
  } catch {
    /* Storage unavailable or throws */
  }
  const airport = resolveAirport(savedAirport);
  const aircraft = resolveAircraft(savedAircraft);
  const scenario = resolveScenario(savedScenario, airport, aircraft);
  return { airport, aircraft, scenario };
}

export function saveSavedAirport(airport, storage) {
  if (!airport) return;
  const s = getSafeStorage(storage);
  try {
    s?.setItem(AIRPORT_STORAGE_KEY, airport);
  } catch {
    /* Storage unavailable */
  }
}

export function saveSavedAircraft(aircraft, storage) {
  if (!aircraft) return;
  const s = getSafeStorage(storage);
  try {
    s?.setItem(AIRCRAFT_STORAGE_KEY, aircraft);
    s?.setItem(PLANE_STORAGE_KEY, aircraft);
  } catch {
    /* Storage unavailable */
  }
}

export function saveSavedScenario(scenario, storage) {
  if (!scenario) return;
  const s = getSafeStorage(storage);
  try {
    s?.setItem(SCENARIO_STORAGE_KEY, scenario);
    s?.setItem(PRESET_STORAGE_KEY, scenario);
  } catch {
    /* Storage unavailable */
  }
}

export function saveFlightSelection({ airport, aircraft, scenario } = {}, storage) {
  if (airport) saveSavedAirport(airport, storage);
  if (aircraft) saveSavedAircraft(aircraft, storage);
  if (scenario) saveSavedScenario(scenario, storage);
}
