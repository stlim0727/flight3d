import * as THREE from 'three';

/**
 * CrashCameraMode — exterior vantage points for crash scene & wreckage inspection.
 */
export class CrashCameraMode {
  static begin(cs, wreckage) {
    const returnMode = cs.temporaryViewTimer > 0 && cs.savedMode != null ? cs.savedMode : cs.mode;
    cs.preCrashState = {
      mode: cs.autoSwitch ? cs.constructor.MODES.AUTO : returnMode,
      userModeSelected: cs.userModeSelected,
      userLookOverridden: cs.userLookOverridden,
      customViewUpdater: cs.customViewUpdater,
      autoPaused: cs.autoPaused,
      autoSwitchTimer: cs.autoSwitchTimer,
      touchAutoResumeTimer: cs.touchAutoResumeTimer,
    };
    cs._applyMode(cs.constructor.MODES.CHASE);
    cs.crashView = wreckage;
    cs.chaseYaw = 0;
    cs.chasePitch = 0;
    cs.droneOrbitAngle = 0;
    cs.droneHeight = 11.5;
    cs.flybyLookYaw = 0;
    cs.crashDirection = new THREE.Vector3(1, 0.65, 1).normalize();
    this.update(cs, 0, true);
  }

  static end(cs) {
    cs.trauma = 0;
    if (!cs.crashView) return;
    cs.crashView = null;
    const { mode, ...state } = cs.preCrashState;
    cs._applyMode(mode);
    Object.assign(cs, state);
    cs.preCrashState = null;
  }

  static update(cs, dt, snap = false) {
    if (!cs.crashView) return;
    const { target, radius } = cs.crashView;
    const halfFov = THREE.MathUtils.degToRad(50 / 2);
    const fit = (radius || 20) / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, cs.camera.aspect)));

    if (cs.mode === cs.constructor.MODES.DRONE) {
      if (!cs.userLookOverridden && !cs.autoPaused && dt > 0) {
        cs.droneOrbitAngle += 0.22 * dt;
      }
      const dist = Math.max(30, fit * 0.9) / (cs.opticalZoom || 1.0);
      const droneH = Math.max(12, (radius || 20) * 0.8) + (cs.droneHeight || 0);
      const hoverBob = Math.sin(cs.droneOrbitAngle * 1.8) * 0.4;
      const tx = target.x + Math.sin(cs.droneOrbitAngle) * dist;
      const tz = target.z + Math.cos(cs.droneOrbitAngle) * dist;
      const groundH = cs.queryGroundHeight ? cs.queryGroundHeight(tx, tz) : (cs.getTerrainHeight ? cs.getTerrainHeight(tx, tz) : 0);
      const ty = Math.max(target.y + droneH + hoverBob, groundH + 3.0);
      const eye = new THREE.Vector3(tx, ty, tz);
      cs.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      cs.camera.up.set(0, 1, 0);
      cs.camera.lookAt(target);
    } else if (cs.mode === cs.constructor.MODES.FLYBY) {
      const spotterDist = Math.max(50, fit * 1.4) / (cs.opticalZoom || 1.0);
      const spotterAngle = (Math.PI / 4) + (cs.flybyLookYaw || 0);
      const tx = target.x + Math.sin(spotterAngle) * spotterDist;
      const tz = target.z + Math.cos(spotterAngle) * spotterDist;
      const groundH = cs.queryGroundHeight ? cs.queryGroundHeight(tx, tz) : (cs.getTerrainHeight ? cs.getTerrainHeight(tx, tz) : 0);
      const ty = groundH + 2.0;
      const eye = new THREE.Vector3(tx, ty, tz);
      cs.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      cs.camera.up.set(0, 1, 0);
      const lookOffset = new THREE.Vector3(0, (radius || 20) * 0.2, 0);
      cs.camera.lookAt(target.clone().add(lookOffset));
    } else if (cs.mode === cs.constructor.MODES.TOWER) {
      cs.camera.position.lerp(cs.towerPos, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      cs.camera.up.set(0, 1, 0);
      cs.camera.lookAt(target);
    } else {
      const dist = (fit * 1.15) / (cs.opticalZoom || 1.0);
      const baseAzimuth = Math.PI / 4;
      const baseElevation = 0.43;
      const totalYaw = baseAzimuth + (cs.chaseYaw || 0);
      const totalPitch = THREE.MathUtils.clamp(baseElevation + (cs.chasePitch || 0), 0.08, 1.45);
      const dir = new THREE.Vector3(
        Math.cos(totalPitch) * Math.sin(totalYaw),
        Math.sin(totalPitch),
        Math.cos(totalPitch) * Math.cos(totalYaw)
      );
      const eye = target.clone().addScaledVector(dir, dist);
      const groundH = cs.queryGroundHeight ? cs.queryGroundHeight(eye.x, eye.z) : (cs.getTerrainHeight ? cs.getTerrainHeight(eye.x, eye.z) : 0);
      if (Number.isFinite(groundH)) {
        eye.y = Math.max(eye.y, groundH + 2.0);
      }
      cs.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      cs.camera.up.set(0, 1, 0);
      cs.camera.lookAt(target);
    }

    cs.camera.fov = 50;
    if (cs.opticalZoom && cs.opticalZoom > 1.0) {
      const halfTan = Math.tan((50 * Math.PI) / 360) / cs.opticalZoom;
      cs.camera.fov = (Math.atan(halfTan) * 360) / Math.PI;
    }
    cs.camera.updateProjectionMatrix();
  }
}
