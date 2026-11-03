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
  for (const key of ['audioMuted', 'touchControls', 'gyroEnabled']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (['auto', 'portrait', 'landscape'].includes(value.gyroOrientation)) result.gyroOrientation = value.gyroOrientation;
  if (typeof value.demoProfile === 'string' && /^[a-z0-9-]{1,64}$/.test(value.demoProfile)) {
    result.demoProfile = value.demoProfile;
  }
  if (value.joystick && typeof value.joystick === 'object' && !Array.isArray(value.joystick)) {
    const joy = {};
    if (typeof value.joystick.profileOverride === 'string' && /^[a-z0-9-]{1,32}$/.test(value.joystick.profileOverride)) {
      joy.profileOverride = value.joystick.profileOverride;
    }
    if (['thrustmaster', 'legacy', 'auto'].includes(value.joystick.axesLayout)) {
      joy.axesLayout = value.joystick.axesLayout;
    }
    if (typeof value.joystick.throttleInverted === 'boolean') joy.throttleInverted = value.joystick.throttleInverted;
    if (typeof value.joystick.pitchInverted === 'boolean') joy.pitchInverted = value.joystick.pitchInverted;
    if (['auto', 'twist', 'pedals'].includes(value.joystick.rudderMode)) joy.rudderMode = value.joystick.rudderMode;
    if (typeof value.joystick.deadzoneStick === 'number' && Number.isFinite(value.joystick.deadzoneStick)) {
      joy.deadzoneStick = Math.max(0, Math.min(0.2, value.joystick.deadzoneStick));
    }
    if (typeof value.joystick.deadzoneRudder === 'number' && Number.isFinite(value.joystick.deadzoneRudder)) {
      joy.deadzoneRudder = Math.max(0, Math.min(0.2, value.joystick.deadzoneRudder));
    }
    result.joystick = joy;
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
  if (preferences.touchControls !== undefined && preferences.gyroEnabled !== true) {
    if (preferences.touchControls) sim.touchControls.enable();
    else sim.touchControls.disable();
  }
  // Gyro needs the touch-input path; restore it after all visibility preferences.
  if (preferences.gyroEnabled === true) sim.touchControls.restoreGyroSettings();
  if (preferences.joystick && sim.controls?.hotas) {
    sim.controls.hotas.applyConfig(preferences.joystick);
  }
  sim.lobby.demoProfile = preferences.demoProfile;
}
