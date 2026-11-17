import * as THREE from 'three';

export function snapToTarget(cs, aircraftMesh) {
  const behindLocal = new THREE.Vector3(0, cs.chaseHeight, cs.chaseDistance);
  behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), cs.chasePitch);
  behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), cs.chaseYaw);
  cs.chasePos.copy(behindLocal.applyMatrix4(aircraftMesh.matrixWorld));
  cs.chaseTarget.copy(aircraftMesh.position);
  cs.chaseTargetInitialized = true;

  switch (cs.mode) {
    case cs.constructor.MODES.CHASE: cs.modes.chase.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.HUD: cs.modes.hud.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.COCKPIT: cs.modes.cockpit.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.GEAR: cs.modes.gear.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.DRONE: cs.modes.orbit.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.FLYBY: cs.modes.flyby.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.WING: cs.modes.wing.snap(cs.camera, aircraftMesh, cs); break;
    case cs.constructor.MODES.DIRECTOR: cs.cinematicDirector?.reset?.(); break;
    default:
      cs.camera.position.copy(cs.chasePos);
      cs.camera.up.set(0, 1, 0);
      cs.camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
      break;
  }
}

export function applyMouseDelta(cs, dx, dy, isTouch = (cs.activeTouchId !== null)) {
  if (cs.isDragging) cs.povChangedByDrag = true;
  if (Math.abs(dx) > 0 || Math.abs(dy) > 0) cs.holdForManualLook(isTouch);
  if (cs.crashView) {
    if (cs.mode === cs.constructor.MODES.DRONE) {
      cs.droneOrbitAngle -= dx * 0.005;
      cs.droneHeight = Math.max(-15.0, Math.min(45.0, cs.droneHeight + dy * 0.05));
    } else if (cs.mode === cs.constructor.MODES.FLYBY) {
      cs.flybyLookYaw = (cs.flybyLookYaw || 0) - dx * 0.005;
    } else {
      cs.chaseYaw -= dx * 0.005;
      cs.chasePitch -= dy * 0.005;
      cs.chasePitch = Math.max(-1.1, Math.min(1.1, cs.chasePitch));
    }
    cs.updatePovButtonState();
    return;
  }
  const sensitivity = isTouch ? cs.touchGazeSensitivity : cs.gazeSensitivity;
  switch (cs.mode) {
    case cs.constructor.MODES.COCKPIT:
      cs.lookYaw -= dx * sensitivity;
      cs.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, cs.lookPitch - dy * sensitivity));
      break;
    case cs.constructor.MODES.CHASE:
      cs.chaseYaw -= dx * 0.005;
      cs.chasePitch = Math.max(-1.1, Math.min(cs.constructor.CHASE_PITCH_LOW_LIMIT, cs.chasePitch - dy * 0.005));
      break;
    case cs.constructor.MODES.WING:
      cs.wingLookYaw = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, cs.wingLookYaw - dx * sensitivity));
      cs.wingLookPitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, cs.wingLookPitch - dy * sensitivity));
      break;
    case cs.constructor.MODES.DRONE:
      cs.droneOrbitAngle -= dx * 0.005;
      cs.droneHeight = Math.max(-32.0, Math.min(32.0, cs.droneHeight + dy * 0.05));
      break;
    case cs.constructor.MODES.GEAR:
      cs.gearLookYaw = Math.max(-0.8, Math.min(0.8, cs.gearLookYaw - dx * sensitivity));
      cs.gearLookPitch = Math.max(-0.6, Math.min(0.6, cs.gearLookPitch - dy * sensitivity));
      break;
  }
  cs.updatePovButtonState();
}
