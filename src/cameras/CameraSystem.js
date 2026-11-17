import * as THREE from 'three';
import { CinematicCameraDirector } from './CinematicCameraDirector.js';
import { CockpitCameraMode } from './modes/CockpitCameraMode.js';
import { ChaseCameraMode } from './modes/ChaseCameraMode.js';
import { FlybyCameraMode } from './modes/FlybyCameraMode.js';
import { OrbitCameraMode } from './modes/OrbitCameraMode.js';
import { WingCameraMode } from './modes/WingCameraMode.js';
import { GearCameraMode } from './modes/GearCameraMode.js';
import { TowerCameraMode } from './modes/TowerCameraMode.js';
import { HudCameraMode } from './modes/HudCameraMode.js';
import { BanditCameraMode } from './modes/BanditCameraMode.js';
import { CrashCameraMode } from './modes/CrashCameraMode.js';
import { isInteractiveUI, initMouseLook, handleTouchStart, handleTouchMove, handleTouchEnd, updateEdgePan } from './cameraInput.js';
import { normalizeAngle, isPovModified, getPovIndicatorAngle, updatePovButtonState, applyHatLook, updatePovReturn } from './cameraPovControls.js';
import { updateSpeedSensation } from './cameraSpeedSensation.js';
import { handleCanvasTap, setGazeTarget, clearGaze, isGazeActive, getGazeTargetLabel, notifyGazeChange, applyActiveGaze, toggleBanditGaze, nearestLiveBandit } from './cameraGaze.js';
import { loadAircraftConfig, resetLook, applyOpticalBaseFov } from './cameraStateHelpers.js';
import { initCameraState } from './cameraInitState.js';
import { snapToTarget, applyMouseDelta } from './cameraMotionHelpers.js';
import { showTemporaryView, cancelTemporaryView, cycleMode, setMode, applyMode, updateAutoAndTemporary } from './cameraModeTransitions.js';
import { getViewName, beginPauseView, endPauseView, dispatchActiveMode } from './cameraUpdateDispatcher.js';

export { normalizeAngle };

export class CameraSystem {
  static CHASE_PITCH_LOW_LIMIT = 1.0;
  static MODES = { COCKPIT: 0, CHASE: 1, WING: 2, TOWER: 3, FLYBY: 4, GEAR: 5, DRONE: 6, AUTO: 7, HUD: 8, DIRECTOR: 9, BANDIT_POV: 10 };
  static QUICK_CYCLE = [1, 6, 4, 2, 0, 8];
  static CRASH_MODES = [1, 6, 4, 3];

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.modes = {
      cockpit: CockpitCameraMode, chase: ChaseCameraMode, flyby: FlybyCameraMode, orbit: OrbitCameraMode,
      wing: WingCameraMode, gear: GearCameraMode, tower: TowerCameraMode, hud: HudCameraMode, bandit: BanditCameraMode, crash: CrashCameraMode
    };
    initCameraState(this);
    this.cinematicDirector = new CinematicCameraDirector({ camera: this.camera, queryGroundHeight: (x, z) => this.queryGroundHeight(x, z) });
    if (this.camera) {
      this.camera.near = (this.mode === CameraSystem.MODES.COCKPIT) ? 0.08 : 0.25;
      if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
    }
    this.initMouseLook();
  }

  isInteractiveUI(target) { return isInteractiveUI(target); }
  initMouseLook() { initMouseLook(this); }
  handleTouchStart(e) { handleTouchStart(this, e); }
  handleTouchMove(e) { handleTouchMove(this, e); }
  handleTouchEnd(e) { handleTouchEnd(this, e); }
  applyPinchZoom(deltaDist) {
    if (Math.abs(deltaDist) > 0) this.holdForManualLook(true);
    if (this.usesOpticalZoom()) this.zoomOpticalBy(Math.exp(deltaDist * 0.0035), true);
  }
  usesOpticalZoom() {
    return [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.TOWER, CameraSystem.MODES.CHASE, CameraSystem.MODES.DRONE].includes(this.mode);
  }
  opticalZoomFloor() {
    return (this.mode === CameraSystem.MODES.CHASE || this.mode === CameraSystem.MODES.DRONE) ? this.exteriorZoomMin : this.opticalZoomMin;
  }
  opticalZoomLimit() {
    if (this.mode === CameraSystem.MODES.CHASE || this.mode === CameraSystem.MODES.DRONE) return this.exteriorZoomMax;
    return this.mode === CameraSystem.MODES.TOWER ? this.towerZoomMax : this.opticalZoomMax;
  }
  zoomOpticalBy(ratio, isTouch = false) {
    if (!Number.isFinite(ratio) || ratio === 1) return false;
    const clamped = Math.min(this.opticalZoomLimit(), Math.max(this.opticalZoomFloor(), this.opticalZoom * ratio));
    if (clamped === this.opticalZoom) return false;
    this.opticalZoom = clamped;
    this.holdForManualLook(isTouch);
    return true;
  }
  applyBaseFov(baseFovDeg) { return applyOpticalBaseFov(this, baseFovDeg); }
  applyDragDelta(dx, dy, isTouch = (this.activeTouchId !== null)) {
    this.povChangedByDrag = true;
    this.povChangedByHat = false;
    this.applyMouseDelta(this.mode === CameraSystem.MODES.GEAR ? dx : -dx, -dy, isTouch);
  }
  applyTouchDragDelta(dx, dy) { this.applyDragDelta(dx, dy, true); }
  applyMouseDelta(dx, dy, isTouch = (this.activeTouchId !== null)) { applyMouseDelta(this, dx, dy, isTouch); }
  updateEdgePan(dt, width, height) { updateEdgePan(this, dt, width, height); }
  setCursorPosition(clientX, clientY, width = (typeof window !== 'undefined' ? window.innerWidth : 1920), height = (typeof window !== 'undefined' ? window.innerHeight : 1080)) {
    if (!width || !height) return;
    this.targetCursorNormX = Math.max(-1.0, Math.min(1.0, (clientX - width * 0.5) / (width * 0.5)));
    this.targetCursorNormY = Math.max(-1.0, Math.min(1.0, (clientY - height * 0.5) / (height * 0.5)));
  }
  isPovModified() { return isPovModified(this); }
  getPovIndicatorAngle() { return getPovIndicatorAngle(this); }
  resetPov() { this.resetLook(); }
  setCockpitUserOffset(x, y, z) {
    if (typeof x === 'number' && !Number.isNaN(x)) this.cockpitUserOffset.x = x;
    if (typeof y === 'number' && !Number.isNaN(y)) this.cockpitUserOffset.y = y;
    if (typeof z === 'number' && !Number.isNaN(z)) this.cockpitUserOffset.z = z;
    this.saveCockpitUserOffset();
    if (typeof this.onCockpitUserOffsetChange === 'function') this.onCockpitUserOffsetChange(this.getCockpitUserOffset());
  }
  getCockpitUserOffset() { return this.cockpitUserOffset.clone(); }
  resetCockpitUserOffset() {
    this.cockpitUserOffset.set(0, 0, 0);
    this.saveCockpitUserOffset();
    if (typeof this.onCockpitUserOffsetChange === 'function') this.onCockpitUserOffsetChange(this.getCockpitUserOffset());
  }
  isCockpitUserOffsetModified() { return this.cockpitUserOffset.lengthSq() > 1e-6; }
  saveCockpitUserOffset() {
    try {
      const id = this.aircraftConfig?.id || 'default';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`flight3d.cockpitUserOffset.${id}`, JSON.stringify({
          x: Number(this.cockpitUserOffset.x.toFixed(4)),
          y: Number(this.cockpitUserOffset.y.toFixed(4)),
          z: Number(this.cockpitUserOffset.z.toFixed(4)),
        }));
      }
    } catch {}
  }
  loadCockpitUserOffset() {
    try {
      const id = this.aircraftConfig?.id || 'default';
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(`flight3d.cockpitUserOffset.${id}`);
        if (stored) {
          const data = JSON.parse(stored);
          this.cockpitUserOffset.set(
            typeof data.x === 'number' && !Number.isNaN(data.x) ? data.x : 0,
            typeof data.y === 'number' && !Number.isNaN(data.y) ? data.y : 0,
            typeof data.z === 'number' && !Number.isNaN(data.z) ? data.z : 0
          );
          if (typeof this.onCockpitUserOffsetChange === 'function') this.onCockpitUserOffsetChange(this.getCockpitUserOffset());
          return;
        }
      }
    } catch {}
    this.cockpitUserOffset.set(0, 0, 0);
    if (typeof this.onCockpitUserOffsetChange === 'function') this.onCockpitUserOffsetChange(this.getCockpitUserOffset());
  }
  updatePovButtonState() { updatePovButtonState(this); }
  applyHatLook(dirX, dirY, dt) { applyHatLook(this, dirX, dirY, dt); }
  updatePovReturn(dt) { updatePovReturn(this, dt); }
  resetLook(options = {}) { resetLook(this, options); }
  togglePointerLock() {
    if (typeof document === 'undefined' || !this.domElement) return;
    if (document.pointerLockElement === this.domElement) {
      if (document.exitPointerLock) document.exitPointerLock();
    } else if (this.domElement.requestPointerLock) {
      this.domElement.requestPointerLock();
    }
  }
  isLookingAwayFromCenter() {
    if (this.mode !== CameraSystem.MODES.COCKPIT) return false;
    return Math.abs(this.lookYaw) > 0.38 || Math.abs(this.lookPitch - (this.aircraftLookPitch ?? -0.25)) > 0.42;
  }
  zoomGazeBlend() {
    return Math.max(0, 1 - Math.max(Math.abs(this.lookYaw) / 0.38, Math.abs(this.lookPitch - (this.aircraftLookPitch ?? -0.25)) / 0.42));
  }
  resetDroneOrbit(angle = 1.8, distance = 38.0, height = 11.5) {
    if (this.userLookOverridden) return;
    this.droneOrbitAngle = angle;
    this.droneDistance = distance;
    this.droneHeight = height;
    this.droneInitialized = false;
  }
  loadAircraftConfig(config = {}) { loadAircraftConfig(this, config); }
  setCombatStateProvider(provider) { this.combatStateProvider = typeof provider === 'function' ? provider : null; }
  setTerrain(terrain) {
    this.terrainObj = terrain;
    if (typeof terrain === 'function') this.getTerrainHeight = terrain;
    else if (terrain && typeof terrain.getHeight === 'function') this.getTerrainHeight = (x, z) => terrain.getHeight(x, z);
  }
  queryGroundHeight(x, z) {
    let groundH = 0.0;
    if (this.getTerrainHeight) {
      try {
        const h = this.getTerrainHeight(x, z);
        if (typeof h === 'number' && !Number.isNaN(h)) groundH = h;
      } catch {}
    }
    return Math.max(groundH, this.terrainObj?.getWaterLevel?.(x, z) ?? 0.0);
  }
  snapToTarget(aircraftMesh) { snapToTarget(this, aircraftMesh); }
  showTemporaryView(m, durationSeconds = 4.5, onComplete = null) { showTemporaryView(this, m, durationSeconds, onComplete); }
  cancelTemporaryView() { cancelTemporaryView(this); }
  cycleMode() { return cycleMode(this); }
  holdForManualLook(isTouch = false) {
    this.userLookOverridden = true;
    this.touchAutoResumeTimer = isTouch && this.autoSwitch && !this.autoPaused ? 4 : null;
    this.cancelTemporaryView();
  }
  toggleAutoViewing() {
    if (!this.autoSwitch) {
      this.setMode(CameraSystem.MODES.AUTO, true);
    } else if (this.autoPaused || this.userLookOverridden) {
      this.autoPaused = false;
      this.userLookOverridden = false;
      this.touchAutoResumeTimer = null;
      this.autoSwitchTimer = 0;
    } else {
      this.cancelTemporaryView();
      this.autoPaused = true;
      this.touchAutoResumeTimer = null;
    }
  }
  setCustomViewUpdater(fn) { this.customViewUpdater = typeof fn === 'function' ? fn : null; }
  setMode(m, isUserAction = false) { return setMode(this, m, isUserAction); }
  setCockpitInteriorGate(gate) { this.cockpitInteriorGate = typeof gate === 'function' ? gate : null; }
  completeCockpitEntry() {
    if (!this.pendingCockpitEntry) return false;
    this.pendingCockpitEntry = false;
    return this._applyMode(CameraSystem.MODES.COCKPIT);
  }
  holdCockpitEntry() { this.pendingCockpitEntry = true; }
  releaseCockpitEntry() {
    const wasPending = this.pendingCockpitEntry;
    this.pendingCockpitEntry = false;
    return wasPending;
  }
  _applyMode(m) { return applyMode(this, m); }
  toggleCockpitPhoto() {
    if (!this.supportsPhotoCockpit) return (this.photoCockpit = false);
    return (this.photoCockpit = !this.photoCockpit);
  }
  setCockpitPhoto(enabled) { this.photoCockpit = (!this.supportsPhotoCockpit) ? false : !!enabled; }
  handleCanvasTap(clientX, clientY) { handleCanvasTap(this, clientX, clientY); }
  setGazeTarget(target) { return setGazeTarget(this, target); }
  clearGaze() { return clearGaze(this); }
  isGazeActive() { return isGazeActive(this); }
  getGazeTargetLabel() { return getGazeTargetLabel(this); }
  notifyGazeChange() { notifyGazeChange(this); }
  applyActiveGaze(planePos) { applyActiveGaze(this, planePos); }
  toggleBanditGaze() { return toggleBanditGaze(this); }
  nearestLiveBandit(planePos) { return nearestLiveBandit(this, planePos); }
  getCockpitSubmodeName() { return (this.photoCockpit && this.supportsPhotoCockpit) ? 'PHOTO 2D' : '3D VIRTUAL'; }
  getModeName() {
    const name = this.getViewName();
    return this.autoSwitch ? `AUTO · ${name}` : name;
  }
  updateHudView(aircraftMesh) { HudCameraMode.update(this.camera, aircraftMesh, this); }
  getViewName() { return getViewName(this); }
  setMotionFrozen(frozen) {
    this.motionFrozen = Boolean(frozen);
    if (this.motionFrozen) {
      this.vibrationOffset.set(0, 0, 0);
      this.chaseVibration.set(0, 0, 0);
    }
  }
  updateSpeedSensation(dt, flightState) { updateSpeedSensation(this, dt, flightState); }
  beginCrashView(wreckage) { CrashCameraMode.begin(this, wreckage); }
  endCrashView() { CrashCameraMode.end(this); }
  beginPauseView() { return beginPauseView(this); }
  endPauseView() { return endPauseView(this); }
  updateCrashView(dt, snap = false) { CrashCameraMode.update(this, dt, snap); }
  update(dt, aircraftMesh, flightState = {}, getTerrainHeight = null) {
    if (this.crashView) {
      this.updateCrashView(dt);
      this.applyActiveGaze(this.crashView.target || aircraftMesh?.position);
      return;
    }
    this.updateSpeedSensation(dt, flightState);
    if (getTerrainHeight) this.setTerrain(getTerrainHeight);
    updateAutoAndTemporary(this, dt, aircraftMesh, flightState);

    const planePos = aircraftMesh.position;
    if (this.chaseTargetInitialized) {
      if (this.droneInitialized) this.dronePos.add(planePos).sub(this.chaseTarget);
      if (this.flybySet && this.flybyRegime === 'parked') this.flybyPos.add(planePos).sub(this.chaseTarget);
      this.chasePos.add(planePos).sub(this.chaseTarget);
    }
    this.chaseTarget.copy(planePos);
    this.chaseTargetInitialized = true;

    this.touchJoltOffset = (this.touchJoltOffset || 0) * Math.max(0.0, 1.0 - dt * 6.0);
    if (flightState.touchdown) {
      const vsi = Math.abs(flightState.vsiFpm || 400);
      this.touchJoltOffset = -0.045 * Math.min(1.2, Math.max(0.4, vsi / 450.0));
    }

    if (!this.userLookOverridden) {
      this.cursorNormX += (this.targetCursorNormX - this.cursorNormX) * Math.min(1.0, dt * 7.0);
      this.cursorNormY += (this.targetCursorNormY - this.cursorNormY) * Math.min(1.0, dt * 7.0);
    } else {
      this.cursorNormX = 0;
      this.cursorNormY = 0;
    }

    this.updateEdgePan(dt);
    this.updatePovReturn(dt);
    this.updatePovButtonState();

    if (this.customViewUpdater && !this.userModeSelected && !this.userLookOverridden) {
      if (this.customViewUpdater({
        dt, camera: this.camera, planePos, planeQuat: aircraftMesh.quaternion, aircraftMesh, flightState,
        queryGroundHeight: (x, z) => this.queryGroundHeight(x, z)
      })) {
        this.applyActiveGaze(planePos);
        return;
      }
    }

    this._frameDt = dt;
    dispatchActiveMode(this, dt, aircraftMesh, flightState);
    this.applyActiveGaze(planePos);

    if (this.trauma > 0) {
      this.trauma = Math.max(0.0, this.trauma - dt * 0.55);
      const shakePower = Math.pow(this.trauma, 2.0);
      this.camera.position.add(new THREE.Vector3(
        (Math.random() - 0.5) * 3.2 * shakePower, (Math.random() - 0.5) * 2.5 * shakePower, (Math.random() - 0.5) * 3.2 * shakePower
      ));
    }
    this.isHatLooking = false;
  }
  addTrauma(amount = 1.0) { this.trauma = Math.min(1.0, (this.trauma || 0) + amount); }
}
