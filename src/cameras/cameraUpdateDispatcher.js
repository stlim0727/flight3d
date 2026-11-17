import * as THREE from 'three';

export function getViewName(cs) {
  if (cs.crashView) {
    switch (cs.mode) {
      case cs.constructor.MODES.CHASE: return 'WRECKAGE ORBIT';
      case cs.constructor.MODES.DRONE: return 'CRASH SCENE DRONE';
      case cs.constructor.MODES.FLYBY: return 'SPECTATOR VIEW';
      case cs.constructor.MODES.TOWER: return 'AIRPORT TOWER';
      default: return 'CRASH VIEW';
    }
  }
  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT: return 'COCKPIT (CAPTAIN)';
    case cs.constructor.MODES.CHASE: return 'CHASE (EXTERIOR)';
    case cs.constructor.MODES.WING: return 'WING VIEW';
    case cs.constructor.MODES.TOWER: return 'AIRPORT TOWER';
    case cs.constructor.MODES.FLYBY: return 'CINEMATIC FLYBY';
    case cs.constructor.MODES.GEAR: return 'GEAR CAM (BELLY)';
    case cs.constructor.MODES.DRONE: return 'DRONE (ORBIT VIEW)';
    case cs.constructor.MODES.HUD: return 'HUD';
    case cs.constructor.MODES.DIRECTOR: return 'CINEMATIC DIRECTOR';
    case cs.constructor.MODES.BANDIT_POV: return 'BANDIT POV';
    default: return 'CAMERA';
  }
}

export function beginPauseView(cs) {
  if (cs.crashView || cs.pauseView) return false;
  const returnMode = cs.temporaryViewTimer > 0 && cs.savedMode != null ? cs.savedMode : cs.mode;
  cs.pauseView = {
    mode: cs.autoSwitch ? cs.constructor.MODES.AUTO : returnMode,
    userModeSelected: cs.userModeSelected,
    userLookOverridden: cs.userLookOverridden,
    customViewUpdater: cs.customViewUpdater,
    autoPaused: cs.autoPaused,
    autoSwitchTimer: cs.autoSwitchTimer,
    touchAutoResumeTimer: cs.touchAutoResumeTimer,
  };
  cs._applyMode(cs.constructor.MODES.DRONE);
  return true;
}

export function endPauseView(cs) {
  if (!cs.pauseView) return false;
  const { mode, ...state } = cs.pauseView;
  cs.pauseView = null;
  cs._applyMode(mode);
  Object.assign(cs, state);
  return true;
}

export function dispatchActiveMode(cs, dt, aircraftMesh, flightState) {
  switch (cs.mode) {
    case cs.constructor.MODES.HUD: cs.modes.hud.update(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.COCKPIT: cs.modes.cockpit.update(cs.camera, aircraftMesh, flightState, cs); break;
    case cs.constructor.MODES.CHASE: cs.modes.chase.update(cs.camera, aircraftMesh, cs, dt); break;
    case cs.constructor.MODES.WING: cs.modes.wing.update(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.TOWER: cs.modes.tower.update(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.FLYBY: cs.modes.flyby.update(cs.camera, aircraftMesh, flightState, cs, dt); break;
    case cs.constructor.MODES.GEAR: cs.modes.gear.update(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.DRONE: cs.modes.orbit.update(cs.camera, aircraftMesh, cs, dt); break;
    case cs.constructor.MODES.DIRECTOR: {
      cs.cinematicDirector.setTerrainQuery((x, z) => cs.queryGroundHeight(x, z));
      const combat = cs.combatStateProvider ? cs.combatStateProvider() : null;
      const clockDt = Number.isFinite(combat?.timeScale) ? dt * combat.timeScale : dt;
      cs.cinematicDirector.update({
        dt, clockDt, camera: cs.camera, planePos: aircraftMesh.position, planeQuat: aircraftMesh.quaternion, aircraftMesh, flightState,
        queryGroundHeight: (x, z) => cs.queryGroundHeight(x, z), missiles: combat?.missiles ?? [], targets: combat?.targets ?? [],
        flares: combat?.flares ?? [], chaffClouds: combat?.chaffClouds ?? [], targetViews: combat?.targetViews ?? null,
      });
      break;
    }
    case cs.constructor.MODES.BANDIT_POV: cs.modes.bandit.update(cs.camera, aircraftMesh, cs); break;
  }
}
