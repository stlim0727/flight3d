export function handleCanvasTap(cs, clientX, clientY) {
  if (typeof cs.onGazeClick === 'function') {
    cs.onGazeClick(clientX, clientY);
  }
}

export function setGazeTarget(cs, target) {
  cs.gazeTarget = target || null;
  cs.banditGaze = false;
  cs.banditGazeTargetValid = false;
  notifyGazeChange(cs);
  return Boolean(cs.gazeTarget);
}

export function clearGaze(cs) {
  const hadGaze = isGazeActive(cs);
  cs.gazeTarget = null;
  cs.banditGaze = false;
  cs.banditGazeTargetValid = false;
  if (hadGaze) notifyGazeChange(cs);
  return hadGaze;
}

export function isGazeActive(cs) {
  return Boolean(cs.gazeTarget || cs.banditGaze);
}

export function getGazeTargetLabel(cs) {
  if (cs.gazeTarget?.label) return cs.gazeTarget.label;
  if (cs.banditGaze) return 'Bandit';
  return '';
}

export function getGazeTargetPosition(cs) {
  if (cs.gazeTarget) {
    const pos = typeof cs.gazeTarget.getPosition === 'function'
      ? cs.gazeTarget.getPosition()
      : cs.gazeTarget.position;
    if (pos) return pos;
  }
  if (cs.banditGaze) {
    if (cs.banditGazeTargetValid) return cs.banditGazeTarget;
    const referencePos = cs.camera?.position || cs.chaseTarget;
    if (referencePos) {
      const bandit = nearestLiveBandit(cs, referencePos);
      if (bandit?.position) return bandit.position;
    }
  }
  return null;
}

export function notifyGazeChange(cs) {
  if (typeof cs.onGazeChange === 'function') {
    cs.onGazeChange(isGazeActive(cs), getGazeTargetLabel(cs));
  }
}

export function applyActiveGaze(cs, planePos) {
  if (cs.gazeTarget) {
    const targetPos = typeof cs.gazeTarget.getPosition === 'function'
      ? cs.gazeTarget.getPosition()
      : cs.gazeTarget.position;
    if (targetPos) {
      cs.banditGazeTarget.copy(targetPos);
      cs.banditGazeTargetValid = true;
      cs.camera.lookAt(cs.banditGazeTarget);
    } else {
      clearGaze(cs);
    }
  } else if (cs.banditGaze) {
    const bandit = nearestLiveBandit(cs, planePos);
    if (bandit) {
      cs.banditGazeTarget.copy(bandit.position);
      cs.banditGazeTargetValid = true;
      cs.camera.lookAt(cs.banditGazeTarget);
    } else {
      clearGaze(cs);
    }
  }
}

export function toggleBanditGaze(cs) {
  if (cs.gazeTarget) {
    cs.gazeTarget = null;
    cs.banditGaze = true;
  } else {
    cs.banditGaze = !cs.banditGaze;
  }
  cs.banditGazeTargetValid = false;
  notifyGazeChange(cs);
  return cs.banditGaze;
}

export function nearestLiveBandit(cs, planePos) {
  const combat = cs.combatStateProvider ? cs.combatStateProvider() : null;
  let best = null, bestDistance = Infinity;
  for (const target of combat?.targets ?? []) {
    if (!target?.alive || !target.position) continue;
    const distance = planePos.distanceToSquared(target.position);
    if (distance < bestDistance) { bestDistance = distance; best = target; }
  }
  return best;
}
