export const SIMULATOR_PREFERENCES_KEY = 'flight3d.preferences.v1';

function safeStorage(storage) {
  try { return storage === undefined ? globalThis.localStorage : storage; }
  catch { return null; }
}

/** Persist user preferences, never transient aircraft state or scripted demo time. */
export function validateSimulatorPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.timeOfDay === 'number' && Number.isFinite(value.timeOfDay)
      && value.timeOfDay >= 0 && value.timeOfDay < 24) result.timeOfDay = value.timeOfDay;
  for (const key of ['audioMuted', 'touchControls']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (typeof value.demoProfile === 'string' && /^[a-z0-9-]{1,64}$/.test(value.demoProfile)) {
    result.demoProfile = value.demoProfile;
  }
  return result;
}

export function loadSimulatorPreferences(storage) {
  try {
    return validateSimulatorPreferences(JSON.parse(safeStorage(storage)?.getItem(SIMULATOR_PREFERENCES_KEY) ?? 'null'));
  } catch { return {}; }
}

export function saveSimulatorPreferences(patch, storage) {
  const preferences = { ...loadSimulatorPreferences(storage), ...validateSimulatorPreferences(patch) };
  try { safeStorage(storage)?.setItem(SIMULATOR_PREFERENCES_KEY, JSON.stringify(preferences)); }
  catch { /* Keep the current session usable when storage is unavailable. */ }
}

/** Run before UI bindings and automatic flight start, without starting Web Audio. */
export function restoreSimulatorPreferences(sim, preferences) {
  if (preferences.timeOfDay !== undefined) {
    sim.sky.setTimeOfDay(preferences.timeOfDay);
    sim.foliage.setTimeOfDay(sim.sky.timeOfDay);
    sim.water.syncWithAtmosphere(sim.sky);
    sim.demoDirector.onUserTimeOfDayChange();
  }
  if (preferences.audioMuted !== undefined) sim.audio.setMuted(preferences.audioMuted);
  if (preferences.touchControls !== undefined) {
    if (preferences.touchControls) sim.touchControls.enable();
    else sim.touchControls.disable();
  }
  sim.lobby.demoProfile = preferences.demoProfile;
}
