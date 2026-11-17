import * as THREE from 'three';

export function loadAircraftConfig(cs, config = {}) {
  cs.aircraftConfig = config;
  cs.cinematicDirector?.loadAircraftConfig?.(config);
  const cockpit = config.cockpit || {};
  cs.cockpitPortraitEyeX = cockpit.portraitEyeX ?? -0.34;
  cs.cockpitPortraitEyeY = cockpit.portraitEyeY ?? null;
  const aero = config.aerodynamics || {};
  const span = aero.wingspanM ?? 35.8;
  cs.supportsPhotoCockpit = cockpit.hasPhotoCockpit ?? (config.id ? config.id === 'B738' : true);
  if (!cs.supportsPhotoCockpit) cs.photoCockpit = false;
  if (cockpit.captainEyePos) cs.cockpitHeadOffset.copy(cockpit.captainEyePos);
  cs.aircraftLookPitch = cockpit.defaultLookPitchRad ?? -0.25;
  if (cockpit.defaultLookPitchRad !== undefined) cs.lookPitch = cockpit.defaultLookPitchRad;
  if (cockpit.chaseDistance !== undefined) cs.chaseDistance = cockpit.chaseDistance;
  else if (span) cs.chaseDistance = Math.max(12.0, span * 1.5);
  if (cockpit.chaseHeight !== undefined) cs.chaseHeight = cockpit.chaseHeight;
  else if (span) cs.chaseHeight = Math.max(3.0, cs.chaseDistance * 0.19);
  cs.aircraftChaseDistance = cs.chaseDistance;
  cs.aircraftChaseHeight = cs.chaseHeight;
  if (cockpit.droneDistance !== undefined) cs.droneDistance = cockpit.droneDistance;
  else if (span) cs.droneDistance = Math.max(10.0, span * 1.05);
  if (cockpit.droneHeight !== undefined) cs.droneHeight = cockpit.droneHeight;
  else if (span) cs.droneHeight = Math.max(3.0, cs.droneDistance * 0.30);
  if (cockpit.gearCamOffset) cs.gearCamOffset.copy(cockpit.gearCamOffset);
  if (cockpit.gearLookTarget) cs.gearLookTarget.copy(cockpit.gearLookTarget);
  cs.loadCockpitUserOffset();
}

export function resetLook(cs, options = {}) {
  if (!options?.keepGaze) cs.clearGaze();
  cs.povChangedByDrag = false;
  cs.povChangedByHat = false;
  cs.isHatLooking = false;
  cs.touchAutoResumeTimer = null;
  cs.userLookOverridden = false;
  cs.lookYaw = 0;
  cs.lookPitch = cs.aircraftLookPitch ?? -0.25;
  cs.chaseYaw = 0;
  cs.chasePitch = 0;
  cs.chaseDistance = cs.aircraftChaseDistance ?? 55.0;
  cs.chaseHeight = cs.aircraftChaseHeight ?? 10.5;
  cs.speedFov = 0;
  cs.chaseSpeedLag = 0;
  cs.speedSensationTime = 0;
  cs.vibrationOffset.set(0, 0, 0);
  cs.chaseVibration.set(0, 0, 0);
  cs.wingLookYaw = 0;
  cs.wingLookPitch = 0;
  cs.gearLookYaw = 0;
  cs.gearLookPitch = 0;
  cs.flybyLookYaw = 0;
  cs.droneOrbitAngle = 0;
  cs.droneHeight = 11.5;
  cs.opticalZoom = cs.opticalZoomMin;
  cs.targetCursorNormX = 0;
  cs.targetCursorNormY = 0;
  cs.cursorNormX = 0;
  cs.cursorNormY = 0;
  cs.cinematicDirector?.reset?.();
  cs.updatePovButtonState();
}

export function applyOpticalBaseFov(cs, baseFovDeg) {
  if (cs.mode === cs.constructor.MODES.DIRECTOR) return cs.camera?.fov ?? baseFovDeg;
  const effectiveBase = baseFovDeg + (cs.speedFov || 0);
  const halfTan = Math.tan((effectiveBase * Math.PI) / 360) / cs.opticalZoom;
  const zoomedFov = (Math.atan(halfTan) * 360) / Math.PI;
  if (!cs.camera) return zoomedFov;
  if (Math.abs(cs.camera.fov - zoomedFov) > 0.05) {
    cs.camera.fov = zoomedFov;
    if (typeof cs.camera.updateProjectionMatrix === 'function') cs.camera.updateProjectionMatrix();
  }
  return zoomedFov;
}
