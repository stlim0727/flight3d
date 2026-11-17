import * as THREE from 'three';

export function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

export function isPovModified(cs) {
  if (cs.crashView) {
    if (cs.mode === cs.constructor.MODES.DRONE) {
      return Math.abs(cs.droneOrbitAngle) > 0.01 || Math.abs(cs.droneHeight - 11.5) > 0.5 || Math.abs(cs.opticalZoom - cs.opticalZoomMin) > 0.01;
    }
    if (cs.mode === cs.constructor.MODES.FLYBY) {
      return Math.abs(cs.flybyLookYaw || 0) > 0.01 || Math.abs(cs.opticalZoom - cs.opticalZoomMin) > 0.01;
    }
    return Math.abs(normalizeAngle(cs.chaseYaw)) > 0.001 || Math.abs(cs.chasePitch) > 0.001 || Math.abs(cs.opticalZoom - cs.opticalZoomMin) > 0.01;
  }
  const defaultPitch = cs.aircraftLookPitch ?? -0.25;
  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT:
      return Math.abs(normalizeAngle(cs.lookYaw)) > 0.001 || Math.abs(cs.lookPitch - defaultPitch) > 0.001;
    case cs.constructor.MODES.CHASE:
      return Math.abs(normalizeAngle(cs.chaseYaw)) > 0.001 || Math.abs(cs.chasePitch) > 0.001;
    case cs.constructor.MODES.WING:
      return Math.abs(normalizeAngle(cs.wingLookYaw)) > 0.001 || Math.abs(cs.wingLookPitch) > 0.001;
    case cs.constructor.MODES.GEAR:
      return Math.abs(cs.gearLookYaw) > 0.001 || Math.abs(cs.gearLookPitch) > 0.001;
    default:
      return false;
  }
}

export function getPovIndicatorAngle(cs) {
  if (cs.crashView) {
    const deltaYaw = normalizeAngle(cs.chaseYaw);
    const deltaPitch = cs.chasePitch;
    if (Math.hypot(deltaYaw, deltaPitch) < 0.001) return 0;
    return Math.atan2(deltaYaw, -deltaPitch) * (180 / Math.PI);
  }
  let deltaYaw = 0;
  let deltaPitch = 0;
  const defaultPitch = cs.aircraftLookPitch ?? -0.25;

  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT:
      deltaYaw = normalizeAngle(cs.lookYaw);
      deltaPitch = cs.lookPitch - defaultPitch;
      break;
    case cs.constructor.MODES.CHASE:
      deltaYaw = normalizeAngle(cs.chaseYaw);
      deltaPitch = cs.chasePitch;
      break;
    case cs.constructor.MODES.WING:
      deltaYaw = normalizeAngle(cs.wingLookYaw);
      deltaPitch = cs.wingLookPitch;
      break;
    case cs.constructor.MODES.GEAR:
      deltaYaw = -cs.gearLookYaw;
      deltaPitch = cs.gearLookPitch;
      break;
    default:
      return 0;
  }

  if (Math.hypot(deltaYaw, deltaPitch) < 0.001) return 0;
  const x = deltaYaw;
  const y = -deltaPitch;
  return Math.atan2(x, y) * (180 / Math.PI);
}

export function updatePovButtonState(cs) {
  const modified = cs.isPovModified();
  if (cs._lastPovModified !== modified) {
    cs._lastPovModified = modified;
    if (typeof cs.onPovChange === 'function') {
      cs.onPovChange(modified);
    }
    if (typeof document !== 'undefined') {
      const btn = document.getElementById('btn-reset-pov');
      if (btn) btn.hidden = !modified;
    }
  }
  if (modified && typeof document !== 'undefined') {
    const arrow = document.getElementById('pov-arrow-icon');
    if (arrow) {
      const angle = cs.getPovIndicatorAngle();
      arrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    }
  }
}

export function applyHatLook(cs, dirX, dirY, dt) {
  if (dirX === 0 && dirY === 0) return;
  const safeDt = Math.min(0.1, dt || (1 / 60));
  cs.isHatLooking = true;
  cs.povChangedByDrag = true;
  cs.povChangedByHat = true;
  cs.holdForManualLook(false);

  const rate = 1 - Math.exp(-safeDt * (cs.hatGlanceSpeed ?? 14.0));
  const stepToward = (current, target) => {
    const diff = target - current;
    if (Math.abs(diff) < 0.001) return target;
    const next = current + diff * rate;
    return (Math.abs(target - next) < 0.001) ? target : next;
  };
  const stepTowardAngle = (current, target) => {
    const cur = normalizeAngle(current);
    const diff = normalizeAngle(target - cur);
    if (Math.abs(diff) < 0.001) return target;
    const next = cur + diff * rate;
    return (Math.abs(normalizeAngle(target - next)) < 0.001) ? target : next;
  };

  const diagScale = (dirX !== 0 && dirY !== 0) ? Math.SQRT1_2 : 1.0;
  const defaultPitch = cs.aircraftLookPitch ?? -0.25;

  if (cs.crashView) {
    if (cs.mode === cs.constructor.MODES.DRONE || cs.mode === cs.constructor.MODES.FLYBY) {
      cs.applyMouseDelta(dirX * 700 * safeDt, dirY * 700 * safeDt);
      return;
    }
    const targetYaw = -dirX * (cs.hatGlanceChaseYaw ?? Math.PI * 0.5) * diagScale;
    const targetPitch = -dirY * (cs.hatGlanceChasePitch ?? 0.45) * diagScale;
    cs.chaseYaw = stepTowardAngle(cs.chaseYaw, targetYaw);
    cs.chasePitch = Math.max(-1.1, Math.min(1.1, stepToward(cs.chasePitch, targetPitch)));
    cs.updatePovButtonState();
    return;
  }

  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT: {
      const targetYaw = -dirX * (cs.hatGlanceYaw ?? 1.35) * diagScale;
      const pitchDelta = dirY < 0
        ? (-dirY * (cs.hatGlancePitchUp ?? 0.55))
        : (-dirY * (cs.hatGlancePitchDown ?? 0.45));
      const targetPitch = defaultPitch + pitchDelta * diagScale;
      cs.lookYaw = stepTowardAngle(cs.lookYaw, targetYaw);
      cs.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, stepToward(cs.lookPitch, targetPitch)));
      break;
    }
    case cs.constructor.MODES.CHASE: {
      const targetYaw = -dirX * (cs.hatGlanceChaseYaw ?? Math.PI * 0.5) * diagScale;
      const targetPitch = -dirY * (cs.hatGlanceChasePitch ?? 0.45) * diagScale;
      cs.chaseYaw = stepTowardAngle(cs.chaseYaw, targetYaw);
      cs.chasePitch = Math.max(-1.1, Math.min(cs.constructor.CHASE_PITCH_LOW_LIMIT, stepToward(cs.chasePitch, targetPitch)));
      break;
    }
    case cs.constructor.MODES.WING: {
      const targetYaw = -dirX * 0.9 * diagScale;
      const targetPitch = -dirY * 0.45 * diagScale;
      cs.wingLookYaw = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, stepTowardAngle(cs.wingLookYaw, targetYaw)));
      cs.wingLookPitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, stepToward(cs.wingLookPitch, targetPitch)));
      break;
    }
    case cs.constructor.MODES.GEAR: {
      const targetYaw = -dirX * 0.65 * diagScale;
      const targetPitch = -dirY * 0.45 * diagScale;
      cs.gearLookYaw = Math.max(-0.8, Math.min(0.8, stepToward(cs.gearLookYaw, targetYaw)));
      cs.gearLookPitch = Math.max(-0.6, Math.min(0.6, stepToward(cs.gearLookPitch, targetPitch)));
      break;
    }
    default: {
      cs.applyMouseDelta(dirX * 700 * safeDt, dirY * 700 * safeDt);
      return;
    }
  }
  cs.updatePovButtonState();
}

export function updatePovReturn(cs, dt) {
  if (cs.isDragging || cs.pointerLocked || cs.isHatLooking || dt <= 0 || !cs.povChangedByDrag || !cs.autoResetGaze) return;

  const povModes = [
    cs.constructor.MODES.COCKPIT,
    cs.constructor.MODES.CHASE,
    cs.constructor.MODES.WING,
    cs.constructor.MODES.GEAR
  ];
  if (!povModes.includes(cs.mode)) return;

  const defaultPitch = cs.aircraftLookPitch ?? -0.25;
  const returnSpeed = cs.povChangedByHat
    ? (cs.hatReturnSpeed ?? 8.0)
    : (cs.povReturnSpeed ?? 1.0);
  const rate = 1 - Math.exp(-Math.min(0.1, dt) * returnSpeed);

  const stepToward = (current, target) => {
    const diff = target - current;
    if (Math.abs(diff) < 0.001) return target;
    const step = diff * rate;
    const next = current + step;
    return (Math.abs(target - next) < 0.001) ? target : next;
  };

  const stepTowardAngle = (current, target) => {
    const cur = normalizeAngle(current);
    const diff = normalizeAngle(target - cur);
    if (Math.abs(diff) < 0.001) return target;
    const step = diff * rate;
    const next = cur + step;
    return (Math.abs(normalizeAngle(target - next)) < 0.001) ? target : next;
  };

  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT: {
      cs.lookYaw = stepTowardAngle(cs.lookYaw, 0);
      cs.lookPitch = stepToward(cs.lookPitch, defaultPitch);
      break;
    }
    case cs.constructor.MODES.CHASE: {
      cs.chaseYaw = stepTowardAngle(cs.chaseYaw, 0);
      cs.chasePitch = stepToward(cs.chasePitch, 0);
      break;
    }
    case cs.constructor.MODES.WING: {
      cs.wingLookYaw = stepTowardAngle(cs.wingLookYaw, 0);
      cs.wingLookPitch = stepToward(cs.wingLookPitch, 0);
      break;
    }
    case cs.constructor.MODES.GEAR: {
      cs.gearLookYaw = stepToward(cs.gearLookYaw, 0);
      cs.gearLookPitch = stepToward(cs.gearLookPitch, 0);
      break;
    }
  }

  if (!cs.isPovModified()) {
    if (cs.povChangedByHat && Math.abs(cs.opticalZoom - cs.opticalZoomMin) <= 0.01) {
      cs.userLookOverridden = false;
    }
    cs.povChangedByDrag = false;
    cs.povChangedByHat = false;
    if (cs.mode === cs.constructor.MODES.CHASE) cs.chaseYaw = 0;
    else if (cs.mode === cs.constructor.MODES.COCKPIT) cs.lookYaw = 0;
    else if (cs.mode === cs.constructor.MODES.WING) cs.wingLookYaw = 0;
  }

  cs.updatePovButtonState();
}
