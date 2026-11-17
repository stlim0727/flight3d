import { autoCameraIntent } from './autoCameraIntent.js';

export function showTemporaryView(cs, m, durationSeconds = 4.5, onComplete = null) {
  if (cs.crashView) return;
  if (cs.autoPaused || cs.userLookOverridden || (cs.userModeSelected && !cs.autoSwitch)) return;
  if (cs.mode !== m && cs.temporaryViewTimer <= 0) cs.savedMode = cs.mode;
  cs.mode = m;
  cs.temporaryViewTimer = durationSeconds;
  cs.onTemporaryViewComplete = onComplete;
  if (cs.mode === cs.constructor.MODES.FLYBY) {
    cs.flybySet = false;
    cs.flybyRegime = null;
  }
}

export function cancelTemporaryView(cs) {
  if (cs.temporaryViewTimer > 0) {
    cs.temporaryViewTimer = 0;
    if (cs.savedMode !== null && cs.savedMode !== undefined) {
      cs.mode = cs.savedMode;
      cs.savedMode = null;
      if (cs.mode === cs.constructor.MODES.DRONE) cs.droneInitialized = false;
    }
    cs.onTemporaryViewComplete = null;
  }
}

export function cycleMode(cs) {
  if (cs.crashView) {
    const selected = cs.mode;
    const index = cs.constructor.CRASH_MODES.indexOf(selected);
    const next = cs.constructor.CRASH_MODES[index === -1 ? 0 : (index + 1) % cs.constructor.CRASH_MODES.length];
    cs.setMode(next, true);
    if (cs.onCycleMode) cs.onCycleMode(cs.mode);
    return cs.getModeName();
  }
  const selected = cs.savedMode ?? cs.mode;
  const index = cs.constructor.QUICK_CYCLE.indexOf(selected);
  const next = cs.autoSwitch ? cs.constructor.MODES.CHASE : cs.constructor.QUICK_CYCLE[(index + 1) % cs.constructor.QUICK_CYCLE.length];
  cs.setMode(next, true);
  if (cs.onCycleMode) cs.onCycleMode(cs.mode);
  return cs.getModeName();
}

export function setMode(cs, m, isUserAction = false) {
  if (cs.crashView) {
    if (!isUserAction || !cs.constructor.CRASH_MODES.includes(m)) return false;
    applyMode(cs, m);
    cs.resetLook({ keepGaze: true });
    return true;
  }
  if ((cs.userLookOverridden || cs.userModeSelected) && !isUserAction) return false;
  if (isUserAction) {
    cs.userModeSelected = true;
    cs.customViewUpdater = null;
  }
  return applyMode(cs, m);
}

export function applyMode(cs, m) {
  if (m === cs.constructor.MODES.COCKPIT && cs.cockpitInteriorGate?.() === 'loading') {
    cs.pendingCockpitEntry = true;
    return false;
  }
  cs.pendingCockpitEntry = false;
  if (m === cs.constructor.MODES.AUTO) cs.autoContext = null;
  cs.userLookOverridden = false;
  cs.cancelTemporaryView();
  cs.autoSwitch = m === cs.constructor.MODES.AUTO;
  cs.autoPaused = false;
  cs.autoSwitchTimer = 0;
  cs.mode = cs.autoSwitch ? cs.constructor.MODES.CHASE : m;
  cs.resetLook({ keepGaze: true });
  if (cs.camera) {
    cs.camera.near = (cs.mode === cs.constructor.MODES.COCKPIT) ? 0.08 : 0.25;
    if (typeof cs.camera.updateProjectionMatrix === 'function') cs.camera.updateProjectionMatrix();
  }
  if (cs.mode === cs.constructor.MODES.FLYBY) {
    cs.flybySet = false;
    cs.flybyRegime = null;
  }
  if (cs.mode === cs.constructor.MODES.DRONE) cs.droneInitialized = false;
  if (cs.mode === cs.constructor.MODES.DIRECTOR) cs.cinematicDirector?.reset?.();
  return true;
}

export function updateAutoAndTemporary(cs, dt, aircraftMesh, flightState) {
  let resumedTouchLook = false;
  if (cs.autoSwitch && !cs.autoPaused && cs.touchAutoResumeTimer !== null && cs.activeTouchId === null && !cs.isPinching && !cs.isDragging) {
    cs.touchAutoResumeTimer = Math.max(0, cs.touchAutoResumeTimer - Math.max(0, dt));
    if (cs.touchAutoResumeTimer === 0) {
      cs.touchAutoResumeTimer = null;
      cs.userLookOverridden = false;
      cs.autoSwitchTimer = 0;
      resumedTouchLook = true;
    }
  }
  if (cs.autoSwitch && !cs.autoPaused && !cs.userLookOverridden && !resumedTouchLook && cs.activeTouchId === null && !cs.isPinching && !cs.isDragging && cs.temporaryViewTimer <= 0) {
    cs.autoSwitchTimer += Math.max(0, dt);
    const agl = aircraftMesh.position.y - cs.queryGroundHeight(aircraftMesh.position.x, aircraftMesh.position.z);
    const intent = autoCameraIntent(flightState, agl);
    if (intent.context !== cs.autoCandidate) {
      cs.autoCandidate = intent.context;
      cs.autoCandidateSeconds = 0;
    }
    cs.autoCandidateSeconds += Math.max(0, dt);
    if (cs.autoSwitchTimer >= 6 && cs.autoCandidateSeconds >= 1 && intent.context !== cs.autoContext) {
      if (intent.mode !== cs.mode) applyMode(cs, intent.mode);
      cs.autoContext = intent.context;
      cs.autoSwitchTimer = 0;
      cs.autoSwitch = true;
    }
  }
  if (cs.temporaryViewTimer > 0) {
    cs.temporaryViewTimer -= dt;
    if (cs.temporaryViewTimer <= 0) {
      cs.temporaryViewTimer = 0;
      if (cs.savedMode !== null && cs.savedMode !== undefined) {
        cs.mode = cs.savedMode;
        cs.savedMode = null;
        if (cs.mode === cs.constructor.MODES.DRONE) cs.droneInitialized = false;
        if (cs.onTemporaryViewComplete) {
          const cb = cs.onTemporaryViewComplete;
          cs.onTemporaryViewComplete = null;
          cb();
        }
      }
    }
  }
}
