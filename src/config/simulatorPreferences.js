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
  if (typeof value.engineVolume === 'number' && Number.isFinite(value.engineVolume)
      && value.engineVolume >= 0 && value.engineVolume <= 1) result.engineVolume = value.engineVolume;
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
    if (value.joystick.customMapping && typeof value.joystick.customMapping === 'object' && !Array.isArray(value.joystick.customMapping)) {
      const cm = value.joystick.customMapping;
      const validAxis = (idx) => typeof idx === 'number' && Number.isInteger(idx) && idx >= -1 && idx <= 32;
      const validBtn = (idx) => typeof idx === 'number' && Number.isInteger(idx) && idx >= -1 && idx <= 64;
      const validNum = (num) => typeof num === 'number' && Number.isFinite(num);
      joy.customMapping = {
        rollAxis: validAxis(cm.rollAxis) ? cm.rollAxis : 0,
        rollInverted: Boolean(cm.rollInverted),
        pitchAxis: validAxis(cm.pitchAxis) ? cm.pitchAxis : 1,
        pitchInverted: Boolean(cm.pitchInverted),
        throttleAxis: validAxis(cm.throttleAxis) ? cm.throttleAxis : 2,
        throttleIdleVal: validNum(cm.throttleIdleVal) ? cm.throttleIdleVal : 1.0,
        throttleMaxVal: validNum(cm.throttleMaxVal) ? cm.throttleMaxVal : -1.0,
        throttleInverted: Boolean(cm.throttleInverted),
        rudderAxis: validAxis(cm.rudderAxis) ? cm.rudderAxis : 3,
        rudderInverted: Boolean(cm.rudderInverted),
        brakesButton: validBtn(cm.brakesButton) ? cm.brakesButton : 0,
        brakesAxis: validAxis(cm.brakesAxis) ? cm.brakesAxis : -1,
      };
    } else if (value.joystick.customMapping === null) {
      joy.customMapping = null;
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

/** Remove one saved preference so its default applies on the next visit. */
export function forgetSimulatorPreference(key, storage) {
  const preferences = loadSimulatorPreferences(storage);
  delete preferences[key];
  try { safeStorage(storage)?.setItem(SIMULATOR_PREFERENCES_KEY, JSON.stringify(preferences)); }
  catch { /* Keep the current session usable when storage is unavailable. */ }
}

/**
 * Hours on the device's local clock. Sun elevation is a continuous function of the
 * hour, so the exact time is used rather than snapping to a lobby preset.
 */
export function deviceTimeOfDay(now = new Date()) {
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

function applySkyTime(sim, hours) {
  sim.sky.setTimeOfDay(hours);
  sim.foliage.setTimeOfDay(sim.sky.timeOfDay);
  sim.water.syncWithAtmosphere(sim.sky);
}

/**
 * Light the scene at the device's local time without recording a user choice, so
 * nothing is persisted and scripted demo times still apply afterwards.
 */
export function applyDeviceTimeOfDay(sim, now = new Date()) {
  applySkyTime(sim, deviceTimeOfDay(now));
}

/** Run before UI bindings and automatic flight start, without starting Web Audio. */
export function restoreSimulatorPreferences(sim, preferences, { now = new Date() } = {}) {
  // A saved choice wins and overrides demo times; a first visit starts at device time.
  if (preferences.timeOfDay !== undefined) {
    applySkyTime(sim, preferences.timeOfDay);
    sim.demoDirector.onUserTimeOfDayChange();
  } else if (sim.sky) {
    applyDeviceTimeOfDay(sim, now);
  }
  if (preferences.audioMuted !== undefined) sim.audio.setMuted(preferences.audioMuted);
  if (preferences.engineVolume !== undefined) sim.audio.setEngineVolume(preferences.engineVolume);
  if (preferences.touchControls !== undefined && preferences.gyroEnabled !== true) {
    if (preferences.touchControls) sim.touchControls.enable();
    else sim.touchControls.disable();
  }
  // Gyro needs the touch-input path; restore it after all visibility preferences.
  if (preferences.gyroEnabled === true) sim.touchControls?.restoreGyroSettings?.();
  if (preferences.joystick && sim.controls?.hotas) {
    sim.controls.hotas.applyConfig(preferences.joystick);
  }
  sim.lobby.demoProfile = preferences.demoProfile;
}
