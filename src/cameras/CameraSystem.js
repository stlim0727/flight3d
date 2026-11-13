import * as THREE from 'three';
import { autoCameraIntent } from './autoCameraIntent.js';
import { CinematicCameraDirector } from './CinematicCameraDirector.js';

/**
 * Camera views with automatic scenic director and cinematic camera director
 * Features G-force cockpit head dynamics, stall buffeting vibration, touchdown shock jolt,
 * smooth exterior damping, and automatic temporary cinematic view cuts for takeoff/landing/gear transit.
 */
function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

export class CameraSystem {
  // Lowest orbit the chase camera may take (radians). The ground clamp, not this
  // limit, keeps the eye out of terrain, so the view may drop below the aircraft.
  static CHASE_PITCH_LOW_LIMIT = 1.0;

  static MODES = {
    COCKPIT: 0,
    CHASE: 1,
    WING: 2,
    TOWER: 3,
    FLYBY: 4,
    GEAR: 5,
    DRONE: 6,
    AUTO: 7,
    HUD: 8,
    DIRECTOR: 9
  };

  // Keep digit shortcuts stable; the quick cycle follows viewing intent instead.
  static QUICK_CYCLE = [1, 6, 4, 2, 0, 8];
  // Crash views exclude cockpit (0), wing (2), gear (5), HUD (8) - exterior vantage points only
  static CRASH_MODES = [1, 6, 4, 3];

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    // Open outside the aircraft: the 3D cockpit interior is a separate
    // asynchronous GLB, so starting in the cockpit shows an unfinished interior.
    this.mode = CameraSystem.MODES.CHASE;
    this.autoSwitch = false;
    this.autoPaused = false;
    this.touchAutoResumeTimer = null;
    // Explicit view choices persist across demo stages, presets and look resets.
    this.userModeSelected = false;
    // A cockpit view needs the streamed interior. The gate reports its state and may start
    // the download; while it says 'loading' the entry is held instead of showing bare airframe.
    this.cockpitInteriorGate = null;
    this.pendingCockpitEntry = false;
    this.autoSwitchTimer = 0;
    this.autoContext = null;
    this.customViewUpdater = null;
    // Optional live combat feed for the director's missile cinematic. main.js
    // supplies { missiles, targets } from the air-to-air system.
    this.combatStateProvider = null;
    this.cinematicDirector = new CinematicCameraDirector({
      camera: this.camera,
      queryGroundHeight: (x, z) => this.queryGroundHeight(x, z),
    });

    // Temporary Cinematic View Cut State (e.g. brief gear cam preview during takeoff, landing, gear transit)
    this.temporaryViewTimer = 0;
    this.savedMode = null;
    this.onTemporaryViewComplete = null;

    // Cockpit Head Dynamics & Look-Around
    this.photoCockpit = false; // Default to high-fidelity 3D Virtual Cockpit with GLTF asset
    this.supportsPhotoCockpit = true; // Enabled for Boeing 737; disabled for 3D-only cockpits (e.g. C172)
    this.cockpitPortraitEyeX = -0.34;
    this.cockpitPortraitEyeY = null;
    this.cockpitHeadOffset = new THREE.Vector3(-0.31, 0.85, -12.35); // Default unconfigured captain eye
    this.headGForceOffset = new THREE.Vector3();
    this.touchJoltOffset = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.25; // Default unconfigured look pitch

    // Landing Gear Belly View Parameters (Oblique angle looking at nose and main gear under fuselage)
    this.gearCamOffset = new THREE.Vector3(2.2, -2.4, 6.2);
    this.gearLookTarget = new THREE.Vector3(-0.5, -1.9, -2.5);
    this.gearLookYaw = 0;
    this.gearLookPitch = 0;

    // Chase Camera Parameters (360° Mouse Orbit & Look)
    this.chaseDistance = 55.0;
    this.chaseHeight = 10.5;
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.chasePos = new THREE.Vector3();
    this.chaseTarget = new THREE.Vector3();
    this.chaseTargetInitialized = false;

    // Speed Sensation & Physical Dynamics (Continuous physics state based)
    this.speedFov = 0; // Dynamic FOV expansion in degrees from airspeed / dynamic pressure
    this.chaseSpeedLag = 0; // Inertial chase distance lag in meters
    this.speedSensationTime = 0; // Deterministic simulation time accumulator for physical vibrations
    this.vibrationOffset = new THREE.Vector3(); // High-frequency runway roll & aerodynamic jitter (head views)
    this.chaseVibration = new THREE.Vector3(); // High-frequency subtle exterior look-target vibration

    // Wing View Parameters
    this.wingLookYaw = 0;
    this.wingLookPitch = 0;

    // Drone Orbit Camera Parameters (Circumnavigating aircraft from slightly above)
    this.droneOrbitAngle = 1.8;
    this.droneOrbitSpeed = 0.28; // rad/s (~22.4s per full 360° circle)
    this.droneDistance = 38.0;   // Distance in meters (fits entire 39m B737 frame)
    this.droneHeight = 11.5;     // Elevated vantage point looking down (~17° downward pitch)
    this.droneLookOffset = new THREE.Vector3(0, 1.8, 0);
    this.dronePos = new THREE.Vector3();
    this.droneInitialized = false;

    // Real-time cursor tracking (subtle gaze shift with mouse movement)
    this.cursorNormX = 0;
    this.cursorNormY = 0;
    this.targetCursorNormX = 0;
    this.targetCursorNormY = 0;
    this.enableCursorTrack = false; // Looking requires an explicit drag or pointer lock.

    // Tower Camera Location (Inside Control Tower Cab at 66m height)
    this.towerPos = new THREE.Vector3(120, 78, 280);

    // Optical magnification keeps exterior eyes outside the aircraft geometry.
    this.exteriorZoomMin = 0.5;
    this.exteriorZoomMax = 6.0;
    // Zoom magnification for cockpit (with a bounded head lean) and tower.
    this.opticalZoom = 1.0;
    this.opticalZoomMin = 1.0;
    this.opticalZoomMax = 4.0;
    // The tower eyes a distant airfield from a cab with no interior geometry to
    // clip against, so it magnifies further than the cockpit, whose cone is
    // already crowded by the windscreen and the panels.
    this.towerZoomMax = 8.0;
    // Aircraft-local metres: lean forward (-Z) and slightly above the panel.
    // Keep room for the 0.08 m near plane, head dynamics and portrait eye lift
    // inside the windscreen (0.41 m ahead) and roof (0.32 m above).
    this.cockpitZoomLean = new THREE.Vector3(0, 0.02, -0.12);
    this.cockpitZoomGazeLift = 0.08; // radians of head-up rotation per unit above 1x

    // Flyby Camera State
    this.flybyPos = new THREE.Vector3();
    this.flybySet = false;
    this.flybyRegime = null;
    this.getTerrainHeight = null;

    // Look gain for the head views (cockpit, wing, gear): radians of head
    // rotation per pixel of pointer travel. The gesture grabs the scenery, so
    // the gain is set near the window's own pixels-per-radian. At 1080p with the
    // 60° cockpit base field of view that is ~0.0011, and one screen-width drag
    // then sweeps the head across its whole look limit rather than running past
    // the pointer several times over.
    this.gazeSensitivity = 0.0011;

    // Look gain for mobile / touch drag gestures in head views (cockpit, wing, gear).
    // Touch swipes on mobile displays have much shorter physical travel (small screens,
    // thumb arcs) than desktop mouse drags. Using 0.0035 rad/px provides a natural ~24°
    // sweep for a 120 px finger swipe without requiring multiple full-screen swipes.
    this.touchGazeSensitivity = 0.0035;

    // Mouse drag & pointer look state
    this.isDragging = false;
    this.pointerLocked = false;
    this.prevMouse = { x: 0, y: 0 };

    // Mobile Touch Look & Pinch Zoom State
    this.activeTouchId = null;
    this.isPinching = false;
    this.pinchDistance = 0;
    this.lastTapTime = 0;
    this.lastTapPos = { x: 0, y: 0 };
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchMoved = false;
    this.onResetLook = null;

    // Automatic slow return of POV look angles to default position after drag,
    // and rapid spring-back return after a HOTAS hat switch glance.
    this.povReturnSpeed = 1.0; // Decay rate (~2-3s gentle settle back to default after mouse/touch drag)
    this.hatGlanceSpeed = 14.0; // Slew rate while holding hat switch (~0.2s quick glance to target angle)
    this.hatReturnSpeed = 8.0; // Spring-back rate when releasing hat switch (~0.35s return to center)
    this.hatGlanceYaw = 1.35; // ~77° cockpit side window glance yaw (radians)
    this.hatGlancePitchUp = 0.55; // ~31.5° cockpit upward glance pitch offset (radians)
    this.hatGlancePitchDown = 0.45; // ~26° cockpit instrument panel downward glance pitch offset (radians)
    this.hatGlanceChaseYaw = Math.PI * 0.5; // 90° exterior chase side glance yaw (radians)
    this.hatGlanceChasePitch = 0.45; // ~26° exterior chase elevation glance pitch (radians)
    this._lastPovModified = false;
    this.povChangedByDrag = false;
    this.povChangedByHat = false;
    this.isHatLooking = false;
    this.onPovChange = null;

    // Manual look holds automatic framing; touch interruptions in AUTO resume after release.
    this.userLookOverridden = false;

    // After a drag or hat-switch glance, gradually return gaze to the default position.
    this.autoResetGaze = true;

    // Continuous Edge Pan / Edge Look state (화면 끝 도달 시 시선 지속 회전)
    this.enableEdgePan = false; // Grab gestures stop when the pointer/finger stops.
    this.edgePanMargin = 30; // Threshold distance in pixels from screen boundary
    this.edgePanSpeedX = 280; // Virtual px/s equivalent for horizontal pan (~0.31 rad/s in cockpit, ~1.4 rad/s in chase)
    this.edgePanSpeedY = 220; // Virtual px/s equivalent for vertical tilt (~0.24 rad/s in cockpit, ~1.1 rad/s in chase)

    if (this.camera) {
      this.camera.near = (this.mode === CameraSystem.MODES.COCKPIT) ? 0.08 : 0.25;
      if (typeof this.camera.updateProjectionMatrix === 'function') {
        this.camera.updateProjectionMatrix();
      }
    }

    this.initMouseLook();
  }

  /**
   * Determine if an event target is an interactive UI control or on-screen touch flight control
   * that should NOT trigger camera look-around dragging.
   */
  isInteractiveUI(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(
      '#pilot-arena, #pilot-score-overlay, .flight-panel, .flight-toolbar, dialog, button, a, input, select, .btn, .modal-card, .presets-bar, .action-panel, .mobile-menu, .hud-strip, #demo-banner, .toast, .stall-banner, .touch-quadrant, .touch-card-header, .touch-throttle-card, .touch-stick-card, .touch-rudder-card, .btn-touch-pill, .btn-touch-brake, .demo-pill-btn, #btn-reset-pov, .btn-reset-pov, #help-modal, #demo-restart-dialog, #diagnostics-overlay, .menu-backdrop, .debrief-overlay'
    );
  }

  initMouseLook() {
    if (!this.domElement && typeof window === 'undefined') return;

    if (this.domElement && this.domElement.style) {
      this.domElement.style.cursor = 'grab';
      this.domElement.style.touchAction = 'none';
    }

    const onMouseDown = (e) => {
      // Ignore synthesized mouse events while touch dragging
      if (this.activeTouchId !== null) return;
      // Ignore clicks on UI buttons/cards
      if (this.isInteractiveUI(e.target)) {
        return;
      }
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.prevMouse.x = e.clientX;
        this.prevMouse.y = e.clientY;
        if (this.domElement && this.domElement.style) {
          this.domElement.style.cursor = 'grabbing';
        }
      } else if (e.button === 1) {
        // Middle click toggles pointer lock (자유 시선 모드)
        this.togglePointerLock();
        if (e.preventDefault) e.preventDefault();
      }
    };

    if (this.domElement && typeof this.domElement.addEventListener === 'function') {
      this.domElement.addEventListener('mousedown', onMouseDown);
      this.domElement.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
      // Mouse wheel zoom
      this.domElement.addEventListener('wheel', (e) => {
        if (this.usesOpticalZoom()) {
          // Scroll down widens the field of view (zoom out), like backing away.
          this.zoomOpticalBy(Math.exp(-e.deltaY * 0.0015));
        }
      }, { passive: true });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('mouseup', () => {
        if (this.activeTouchId !== null) return;
        this.isDragging = false;
        if (this.domElement && this.domElement.style && !this.pointerLocked) {
          this.domElement.style.cursor = 'grab';
        }
      });

      // Suppress context menu on right-click drag so free look is unhindered
      window.addEventListener('contextmenu', (e) => {
        if (e.target === this.domElement || (e.target && e.target.id === 'canvas-container') || (e.target && !this.isInteractiveUI(e.target))) {
          e.preventDefault();
        }
      });

      window.addEventListener('mousemove', (e) => {
        if (this.activeTouchId !== null) return;
        // Real-time cursor tracking (카메라 시선 미세 추종)
        this.setCursorPosition(e.clientX, e.clientY);

        // Active mouse look during drag or pointer lock
        if (this.isDragging || this.pointerLocked) {
          const dx = this.pointerLocked && typeof e.movementX === 'number' ? e.movementX : (e.clientX - this.prevMouse.x);
          const dy = this.pointerLocked && typeof e.movementY === 'number' ? e.movementY : (e.clientY - this.prevMouse.y);
          this.prevMouse.x = e.clientX;
          this.prevMouse.y = e.clientY;

          if (this.pointerLocked) this.applyMouseDelta(dx, dy, false);
          else this.applyDragDelta(dx, dy, false);
        } else {
          this.prevMouse.x = e.clientX;
          this.prevMouse.y = e.clientY;
        }
      });

      // Mobile Touch Event Listeners on Window
      window.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
      window.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
      window.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
      window.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

      window.addEventListener('blur', () => {
        this.isDragging = false;
        this.activeTouchId = null;
        this.isPinching = false;
        if (this.domElement && this.domElement.style && !this.pointerLocked) {
          this.domElement.style.cursor = 'grab';
        }
      });

      window.addEventListener('mouseleave', () => {
        this.targetCursorNormX = 0;
        this.targetCursorNormY = 0;
      });

      // Reset view on double click
      window.addEventListener('dblclick', (e) => {
        if (this.isInteractiveUI(e.target)) {
          return;
        }
        this.resetLook();
      });
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = (document.pointerLockElement === this.domElement);
        if (this.domElement && this.domElement.style) {
          this.domElement.style.cursor = this.pointerLocked ? 'none' : 'grab';
        }
      });
    }
  }

  /**
   * Handle mobile touchstart event for single-finger drag look and two-finger pinch zoom
   */
  handleTouchStart(e) {
    if (!e || e._camHandled) return;
    const touches = e.touches ? Array.from(e.touches) : [];
    const cameraTouches = touches.filter(t => !this.isInteractiveUI(t.target));
    if (cameraTouches.length === 0) return;
    e._camHandled = true;

    // Two-finger pinch gesture on scenery/canvas
    if (cameraTouches.length >= 2) {
      const t0 = cameraTouches[0];
      const t1 = cameraTouches[1];
      this.pinchDistance = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      this.isPinching = true;
      this.activeTouchId = null;
      this.isDragging = false;
      this.lastTapTime = 0;
      if (typeof e.preventDefault === 'function' && e.cancelable) {
        e.preventDefault();
      }
      return;
    }

    // Single-finger touch drag look-around
    const touch = cameraTouches[0];
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dist = Math.hypot(touch.clientX - this.lastTapPos.x, touch.clientY - this.lastTapPos.y);

    // Double tap within 350ms resets camera look orientation to forward center
    if (this.lastTapTime > 0 && (now - this.lastTapTime < 350) && dist < 50) {
      this.resetLook();
      if (typeof this.onResetLook === 'function') {
        this.onResetLook();
      }
      this.lastTapTime = 0;
      this.activeTouchId = null;
      this.isDragging = false;
      this.touchMoved = false;
      if (typeof e.preventDefault === 'function' && e.cancelable) {
        e.preventDefault();
      }
      return;
    }

    this.lastTapTime = now;
    this.lastTapPos = { x: touch.clientX, y: touch.clientY };

    this.activeTouchId = touch.identifier;
    this.isDragging = true;
    this.isPinching = false;
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchMoved = false;
    this.prevMouse.x = touch.clientX;
    this.prevMouse.y = touch.clientY;
    this.setCursorPosition(touch.clientX, touch.clientY);

    if (typeof e.preventDefault === 'function' && e.cancelable) {
      e.preventDefault();
    }
  }

  /**
   * Handle mobile touchmove event for drag look rotation and pinch zoom distance
   */
  handleTouchMove(e) {
    if (!e) return;
    const touches = e.touches ? Array.from(e.touches) : [];
    const cameraTouches = touches.filter(t => !this.isInteractiveUI(t.target));

    // Handle two-finger pinch zoom
    if (this.isPinching) {
      this.lastTapTime = 0;
      if (cameraTouches.length >= 2) {
        const t0 = cameraTouches[0];
        const t1 = cameraTouches[1];
        const currentDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const deltaDist = currentDist - this.pinchDistance;
        this.pinchDistance = currentDist;
        this.applyPinchZoom(deltaDist);
        if (typeof e.preventDefault === 'function' && e.cancelable) {
          e.preventDefault();
        }
      }
      return;
    }

    // Handle single-finger touch drag look
    if (this.activeTouchId !== null && this.isDragging) {
      const touch = cameraTouches.find(t => t.identifier === this.activeTouchId);
      if (touch) {
        const moveDist = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);
        if (moveDist > 10) {
          this.touchMoved = true;
          this.lastTapTime = 0;
        }

        const dx = touch.clientX - this.prevMouse.x;
        const dy = touch.clientY - this.prevMouse.y;
        this.prevMouse.x = touch.clientX;
        this.prevMouse.y = touch.clientY;

        this.applyDragDelta(dx, dy, true);
        this.setCursorPosition(touch.clientX, touch.clientY);

        if (typeof e.preventDefault === 'function' && e.cancelable) {
          e.preventDefault();
        }
      }
    }
  }

  /**
   * Handle mobile touchend & touchcancel event to finish drag or pinch
   */
  handleTouchEnd(e) {
    if (!e) return;
    const touches = e.touches ? Array.from(e.touches) : [];
    const cameraTouches = touches.filter(t => !this.isInteractiveUI(t.target));

    if (this.touchMoved) {
      this.lastTapTime = 0;
    }

    if (this.isPinching) {
      if (cameraTouches.length < 2) {
        this.isPinching = false;
        this.pinchDistance = 0;
        if (cameraTouches.length === 1) {
          this.activeTouchId = cameraTouches[0].identifier;
          this.isDragging = true;
          this.prevMouse.x = cameraTouches[0].clientX;
          this.prevMouse.y = cameraTouches[0].clientY;
        } else {
          this.activeTouchId = null;
          this.isDragging = false;
        }
      }
      return;
    }

    if (this.activeTouchId !== null) {
      const stillActive = cameraTouches.some(t => t.identifier === this.activeTouchId);
      if (!stillActive) {
        this.activeTouchId = null;
        this.isDragging = false;
      }
    }
  }

  /**
   * Apply two-finger pinch magnification without moving the camera eye.
   */
  applyPinchZoom(deltaDist) {
    if (Math.abs(deltaDist) > 0) {
      this.holdForManualLook(true);
    }
    if (this.usesOpticalZoom()) {
      // Fingers spreading apart magnifies, matching the exterior pinch direction.
      this.zoomOpticalBy(Math.exp(deltaDist * 0.0035), true);
    }
  }

  usesOpticalZoom() {
    return [CameraSystem.MODES.COCKPIT, CameraSystem.MODES.TOWER,
      CameraSystem.MODES.CHASE, CameraSystem.MODES.DRONE].includes(this.mode);
  }

  opticalZoomFloor() {
    return this.mode === CameraSystem.MODES.CHASE || this.mode === CameraSystem.MODES.DRONE
      ? this.exteriorZoomMin : this.opticalZoomMin;
  }

  /**
   * Ceiling for the current view. Changing views runs resetLook(), so a zoom
   * carried over from the tower cannot leave the cockpit above its own limit.
   */
  opticalZoomLimit() {
    if (this.mode === CameraSystem.MODES.CHASE || this.mode === CameraSystem.MODES.DRONE) {
      return this.exteriorZoomMax;
    }
    return this.mode === CameraSystem.MODES.TOWER ? this.towerZoomMax : this.opticalZoomMax;
  }

  /**
   * Scale the optical magnification. ratio > 1 zooms in; the result is clamped
   * to the current view's range and reports whether anything changed.
   */
  zoomOpticalBy(ratio, isTouch = false) {
    if (!Number.isFinite(ratio) || ratio === 1) return false;
    const clamped = Math.min(this.opticalZoomLimit(), Math.max(this.opticalZoomFloor(), this.opticalZoom * ratio));
    if (clamped === this.opticalZoom) return false;
    this.opticalZoom = clamped;
    this.holdForManualLook(isTouch);
    return true;
  }

  /**
   * Set the mode's base vertical field of view, then apply the optical zoom.
   * Dividing the half-angle tangent keeps magnification geometric, so 2x
   * doubles the apparent size of the subject.
   */
  applyBaseFov(baseFovDeg) {
    if (this.mode === CameraSystem.MODES.DIRECTOR) {
      return this.camera?.fov ?? baseFovDeg;
    }
    const effectiveBase = baseFovDeg + (this.speedFov || 0);
    const halfTan = Math.tan((effectiveBase * Math.PI) / 360) / this.opticalZoom;
    const zoomedFov = (Math.atan(halfTan) * 360) / Math.PI;
    if (!this.camera) return zoomedFov;
    if (Math.abs(this.camera.fov - zoomedFov) > 0.05) {
      this.camera.fov = zoomedFov;
      if (typeof this.camera.updateProjectionMatrix === 'function') {
        this.camera.updateProjectionMatrix();
      }
    }
    return zoomedFov;
  }

  // Grab the scenery: mouse and touch move it with the gesture. Pointer lock
  // retains directional head movement through applyMouseDelta.
  applyDragDelta(dx, dy, isTouch = (this.activeTouchId !== null)) {
    this.povChangedByDrag = true;
    this.povChangedByHat = false;
    // Gear yaw offsets the look target along +X, unlike the head/orbit yaw
    // rotations. Its original horizontal mapping already grabs the scenery.
    const lookDx = this.mode === CameraSystem.MODES.GEAR ? dx : -dx;
    this.applyMouseDelta(lookDx, -dy, isTouch);
  }

  applyTouchDragDelta(dx, dy) {
    this.applyDragDelta(dx, dy, true);
  }

  applyMouseDelta(dx, dy, isTouch = (this.activeTouchId !== null)) {
    if (this.isDragging) {
      this.povChangedByDrag = true;
    }
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      this.holdForManualLook(isTouch);
    }
    if (this.crashView) {
      if (this.mode === CameraSystem.MODES.DRONE) {
        this.droneOrbitAngle -= dx * 0.005;
        this.droneHeight = Math.max(-15.0, Math.min(45.0, this.droneHeight + dy * 0.05));
      } else if (this.mode === CameraSystem.MODES.FLYBY) {
        this.flybyLookYaw = (this.flybyLookYaw || 0) - dx * 0.005;
      } else {
        this.chaseYaw -= dx * 0.005;
        this.chasePitch -= dy * 0.005;
        this.chasePitch = Math.max(-1.1, Math.min(1.1, this.chasePitch));
      }
      this.updatePovButtonState();
      return;
    }
    const sensitivity = isTouch ? this.touchGazeSensitivity : this.gazeSensitivity;
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        this.lookYaw -= dx * sensitivity;
        this.lookPitch -= dy * sensitivity;
        this.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.lookPitch));
        break;
      }
      case CameraSystem.MODES.CHASE: {
        this.chaseYaw -= dx * 0.005;
        // Chase pitch is an orbit height, so its sign is the mirror of the head
        // views: raising it sinks the camera and lifts the gaze. Both the drag
        // and the pointer-lock path land on that reading, which makes a down
        // gesture lift the view like it does in the cockpit.
        this.chasePitch -= dy * 0.005;
        this.chasePitch = Math.max(-1.1, Math.min(CameraSystem.CHASE_PITCH_LOW_LIMIT, this.chasePitch));
        break;
      }
      case CameraSystem.MODES.WING: {
        this.wingLookYaw -= dx * sensitivity;
        this.wingLookPitch -= dy * sensitivity;
        this.wingLookPitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, this.wingLookPitch));
        this.wingLookYaw = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, this.wingLookYaw));
        break;
      }
      case CameraSystem.MODES.DRONE: {
        this.droneOrbitAngle -= dx * 0.005;
        this.droneHeight = Math.max(-32.0, Math.min(32.0, this.droneHeight + dy * 0.05));
        break;
      }
      case CameraSystem.MODES.GEAR: {
        this.gearLookYaw -= dx * sensitivity;
        this.gearLookPitch -= dy * sensitivity;
        this.gearLookPitch = Math.max(-0.6, Math.min(0.6, this.gearLookPitch));
        this.gearLookYaw = Math.max(-0.8, Math.min(0.8, this.gearLookYaw));
        break;
      }
    }
    this.updatePovButtonState();
  }

  /**
   * Continuous Edge Pan (화면 끝 도달 시 적당한 속도로 시선 지속 회전)
   * When looking around with mouse drag, if the mouse reaches the screen edge,
   * continuously rotate/tilt the view at a smooth, comfortable speed.
   */
  updateEdgePan(dt, width = (typeof window !== 'undefined' ? window.innerWidth : 1920), height = (typeof window !== 'undefined' ? window.innerHeight : 1080)) {
    if (!this.enableEdgePan || !this.isDragging || this.pointerLocked || dt <= 0) {
      return;
    }

    if (!width || !height) return;

    const margin = this.edgePanMargin;
    const x = this.prevMouse.x;
    const y = this.prevMouse.y;

    let dirX = 0;
    let dirY = 0;

    // Horizontal screen edges (left: negative dx, right: positive dx)
    if (x <= margin) {
      const factor = Math.min(1.0, Math.max(0.3, (margin - x) / margin));
      dirX = -factor;
    } else if (x >= width - margin) {
      const factor = Math.min(1.0, Math.max(0.3, (x - (width - margin)) / margin));
      dirX = factor;
    }

    // Vertical screen edges (top: negative dy, bottom: positive dy)
    if (y <= margin) {
      const factor = Math.min(1.0, Math.max(0.3, (margin - y) / margin));
      dirY = -factor;
    } else if (y >= height - margin) {
      const factor = Math.min(1.0, Math.max(0.3, (y - (height - margin)) / margin));
      dirY = factor;
    }

    if (dirX !== 0 || dirY !== 0) {
      const safeDt = Math.min(0.1, dt);
      const virtualDx = dirX * this.edgePanSpeedX * safeDt;
      const virtualDy = dirY * this.edgePanSpeedY * safeDt;
      this.applyMouseDelta(virtualDx, virtualDy);
    }
  }

  setCursorPosition(clientX, clientY, width = (typeof window !== 'undefined' ? window.innerWidth : 1920), height = (typeof window !== 'undefined' ? window.innerHeight : 1080)) {
    if (!width || !height) return;
    const cx = width * 0.5;
    const cy = height * 0.5;
    this.targetCursorNormX = Math.max(-1.0, Math.min(1.0, (clientX - cx) / cx));
    this.targetCursorNormY = Math.max(-1.0, Math.min(1.0, (clientY - cy) / cy));
  }

  /**
   * Determine whether the camera look angle (POV) deviates from its default position.
   */
  isPovModified() {
    if (this.crashView) {
      if (this.mode === CameraSystem.MODES.DRONE) {
        return Math.abs(this.droneOrbitAngle) > 0.01 || Math.abs(this.droneHeight - 11.5) > 0.5 || Math.abs(this.opticalZoom - this.opticalZoomMin) > 0.01;
      }
      if (this.mode === CameraSystem.MODES.FLYBY) {
        return Math.abs(this.flybyLookYaw || 0) > 0.01 || Math.abs(this.opticalZoom - this.opticalZoomMin) > 0.01;
      }
      return Math.abs(normalizeAngle(this.chaseYaw)) > 0.001 || Math.abs(this.chasePitch) > 0.001 || Math.abs(this.opticalZoom - this.opticalZoomMin) > 0.01;
    }
    const defaultPitch = this.aircraftLookPitch ?? -0.25;
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT:
        return Math.abs(normalizeAngle(this.lookYaw)) > 0.001 || Math.abs(this.lookPitch - defaultPitch) > 0.001;
      case CameraSystem.MODES.CHASE:
        return Math.abs(normalizeAngle(this.chaseYaw)) > 0.001 || Math.abs(this.chasePitch) > 0.001;
      case CameraSystem.MODES.WING:
        return Math.abs(normalizeAngle(this.wingLookYaw)) > 0.001 || Math.abs(this.wingLookPitch) > 0.001;
      case CameraSystem.MODES.GEAR:
        return Math.abs(this.gearLookYaw) > 0.001 || Math.abs(this.gearLookPitch) > 0.001;
      default:
        return false;
    }
  }

  /**
   * Calculates the angle (in degrees, 0 = up, 90 = right, 180 = down, -90 = left)
   * pointing toward the default POV forward orientation from the current look angle.
   */
  getPovIndicatorAngle() {
    if (this.crashView) {
      const deltaYaw = normalizeAngle(this.chaseYaw);
      const deltaPitch = this.chasePitch;
      if (Math.hypot(deltaYaw, deltaPitch) < 0.001) {
        return 0;
      }
      return Math.atan2(deltaYaw, -deltaPitch) * (180 / Math.PI);
    }
    let deltaYaw = 0;
    let deltaPitch = 0;
    const defaultPitch = this.aircraftLookPitch ?? -0.25;

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT:
        deltaYaw = normalizeAngle(this.lookYaw);
        deltaPitch = this.lookPitch - defaultPitch;
        break;
      case CameraSystem.MODES.CHASE:
        deltaYaw = normalizeAngle(this.chaseYaw);
        deltaPitch = this.chasePitch;
        break;
      case CameraSystem.MODES.WING:
        deltaYaw = normalizeAngle(this.wingLookYaw);
        deltaPitch = this.wingLookPitch;
        break;
      case CameraSystem.MODES.GEAR:
        deltaYaw = -this.gearLookYaw;
        deltaPitch = this.gearLookPitch;
        break;
      default:
        return 0;
    }

    if (Math.hypot(deltaYaw, deltaPitch) < 0.001) {
      return 0;
    }

    // Direction vector toward default (0, 0):
    // deltaYaw < 0 means looking right, so default is left (x < 0, atan2 -> -90 deg)
    // deltaYaw > 0 means looking left, so default is right (x > 0, atan2 -> +90 deg)
    // deltaPitch > 0 means looking up, so default is down (y < 0, atan2 -> 180 deg)
    // deltaPitch < 0 means looking down, so default is up (y > 0, atan2 -> 0 deg)
    const x = deltaYaw;
    const y = -deltaPitch;
    return Math.atan2(x, y) * (180 / Math.PI);
  }

  /**
   * Immediately resets camera POV to default position.
   */
  resetPov() {
    this.resetLook();
  }

  /**
   * Synchronize DOM button visibility, indicator arrow orientation, and callback
   * when POV modification state changes.
   */
  updatePovButtonState() {
    const modified = this.isPovModified();
    if (this._lastPovModified !== modified) {
      this._lastPovModified = modified;
      if (typeof this.onPovChange === 'function') {
        this.onPovChange(modified);
      }
      if (typeof document !== 'undefined') {
        const btn = document.getElementById('btn-reset-pov');
        if (btn) btn.hidden = !modified;
      }
    }
    if (modified && typeof document !== 'undefined') {
      const arrow = document.getElementById('pov-arrow-icon');
      if (arrow) {
        const angle = this.getPovIndicatorAngle();
        arrow.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      }
    }
  }

  /**
   * Quick glance using HOTAS hat switch / D-pad.
   * Smoothly snaps toward a fixed target angle for the held direction
   * and springs back to center when released.
   * dirX: -1 (left), +1 (right)
   * dirY: -1 (up), +1 (down)
   */
  applyHatLook(dirX, dirY, dt) {
    if (dirX === 0 && dirY === 0) return;
    const safeDt = Math.min(0.1, dt || (1 / 60));
    this.isHatLooking = true;
    this.povChangedByDrag = true;
    this.povChangedByHat = true;
    this.holdForManualLook(false);

    const rate = 1 - Math.exp(-safeDt * (this.hatGlanceSpeed ?? 14.0));
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
    const defaultPitch = this.aircraftLookPitch ?? -0.25;

    if (this.crashView) {
      if (this.mode === CameraSystem.MODES.DRONE || this.mode === CameraSystem.MODES.FLYBY) {
        this.applyMouseDelta(dirX * 700 * safeDt, dirY * 700 * safeDt);
        return;
      }
      const targetYaw = -dirX * (this.hatGlanceChaseYaw ?? Math.PI * 0.5) * diagScale;
      const targetPitch = -dirY * (this.hatGlanceChasePitch ?? 0.45) * diagScale;
      this.chaseYaw = stepTowardAngle(this.chaseYaw, targetYaw);
      this.chasePitch = Math.max(-1.1, Math.min(1.1, stepToward(this.chasePitch, targetPitch)));
      this.updatePovButtonState();
      return;
    }

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        const targetYaw = -dirX * (this.hatGlanceYaw ?? 1.35) * diagScale;
        const pitchDelta = dirY < 0
          ? (-dirY * (this.hatGlancePitchUp ?? 0.55))
          : (-dirY * (this.hatGlancePitchDown ?? 0.45));
        const targetPitch = defaultPitch + pitchDelta * diagScale;
        this.lookYaw = stepTowardAngle(this.lookYaw, targetYaw);
        this.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, stepToward(this.lookPitch, targetPitch)));
        break;
      }
      case CameraSystem.MODES.CHASE: {
        const targetYaw = -dirX * (this.hatGlanceChaseYaw ?? Math.PI * 0.5) * diagScale;
        const targetPitch = -dirY * (this.hatGlanceChasePitch ?? 0.45) * diagScale;
        this.chaseYaw = stepTowardAngle(this.chaseYaw, targetYaw);
        this.chasePitch = Math.max(-1.1, Math.min(CameraSystem.CHASE_PITCH_LOW_LIMIT, stepToward(this.chasePitch, targetPitch)));
        break;
      }
      case CameraSystem.MODES.WING: {
        const targetYaw = -dirX * 0.9 * diagScale;
        const targetPitch = -dirY * 0.45 * diagScale;
        this.wingLookYaw = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, stepTowardAngle(this.wingLookYaw, targetYaw)));
        this.wingLookPitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, stepToward(this.wingLookPitch, targetPitch)));
        break;
      }
      case CameraSystem.MODES.GEAR: {
        const targetYaw = -dirX * 0.65 * diagScale;
        const targetPitch = -dirY * 0.45 * diagScale;
        this.gearLookYaw = Math.max(-0.8, Math.min(0.8, stepToward(this.gearLookYaw, targetYaw)));
        this.gearLookPitch = Math.max(-0.6, Math.min(0.6, stepToward(this.gearLookPitch, targetPitch)));
        break;
      }
      default: {
        this.applyMouseDelta(dirX * 700 * safeDt, dirY * 700 * safeDt);
        return;
      }
    }
    this.updatePovButtonState();
  }

  /**
   * Returns the camera POV back to the default position when not actively dragging or glancing with hat.
   * Uses a rapid spring-back rate after a hat switch glance and a gentle settle rate after mouse/touch drag.
   */
  updatePovReturn(dt) {
    if (this.isDragging || this.pointerLocked || this.isHatLooking || dt <= 0 || !this.povChangedByDrag || !this.autoResetGaze) return;

    const povModes = [
      CameraSystem.MODES.COCKPIT,
      CameraSystem.MODES.CHASE,
      CameraSystem.MODES.WING,
      CameraSystem.MODES.GEAR
    ];
    if (!povModes.includes(this.mode)) return;

    const defaultPitch = this.aircraftLookPitch ?? -0.25;
    const returnSpeed = this.povChangedByHat
      ? (this.hatReturnSpeed ?? 8.0)
      : (this.povReturnSpeed ?? 1.0);
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

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        this.lookYaw = stepTowardAngle(this.lookYaw, 0);
        this.lookPitch = stepToward(this.lookPitch, defaultPitch);
        break;
      }
      case CameraSystem.MODES.CHASE: {
        this.chaseYaw = stepTowardAngle(this.chaseYaw, 0);
        this.chasePitch = stepToward(this.chasePitch, 0);
        break;
      }
      case CameraSystem.MODES.WING: {
        this.wingLookYaw = stepTowardAngle(this.wingLookYaw, 0);
        this.wingLookPitch = stepToward(this.wingLookPitch, 0);
        break;
      }
      case CameraSystem.MODES.GEAR: {
        this.gearLookYaw = stepToward(this.gearLookYaw, 0);
        this.gearLookPitch = stepToward(this.gearLookPitch, 0);
        break;
      }
    }

    if (!this.isPovModified()) {
      if (this.povChangedByHat && Math.abs(this.opticalZoom - this.opticalZoomMin) <= 0.01) {
        this.userLookOverridden = false;
      }
      this.povChangedByDrag = false;
      this.povChangedByHat = false;
      if (this.mode === CameraSystem.MODES.CHASE) this.chaseYaw = 0;
      else if (this.mode === CameraSystem.MODES.COCKPIT) this.lookYaw = 0;
      else if (this.mode === CameraSystem.MODES.WING) this.wingLookYaw = 0;
    }

    this.updatePovButtonState();
  }

  resetLook() {
    this.povChangedByDrag = false;
    this.povChangedByHat = false;
    this.isHatLooking = false;
    this.touchAutoResumeTimer = null;
    this.userLookOverridden = false;
    this.lookYaw = 0;
    this.lookPitch = this.aircraftLookPitch ?? -0.25;
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.chaseDistance = this.aircraftChaseDistance ?? 55.0;
    this.chaseHeight = this.aircraftChaseHeight ?? 10.5;
    this.speedFov = 0;
    this.chaseSpeedLag = 0;
    this.speedSensationTime = 0;
    this.vibrationOffset.set(0, 0, 0);
    this.chaseVibration.set(0, 0, 0);
    this.wingLookYaw = 0;
    this.wingLookPitch = 0;
    this.gearLookYaw = 0;
    this.gearLookPitch = 0;
    this.flybyLookYaw = 0;
    this.droneOrbitAngle = 0;
    this.droneHeight = 11.5;
    this.opticalZoom = this.opticalZoomMin;
    this.targetCursorNormX = 0;
    this.targetCursorNormY = 0;
    this.cursorNormX = 0;
    this.cursorNormY = 0;
    this.cinematicDirector?.reset?.();
    this.updatePovButtonState();
  }

  togglePointerLock() {
    if (typeof document === 'undefined' || !this.domElement) return;
    if (document.pointerLockElement === this.domElement) {
      if (document.exitPointerLock) document.exitPointerLock();
    } else {
      if (this.domElement.requestPointerLock) this.domElement.requestPointerLock();
    }
  }

  isLookingAwayFromCenter() {
    if (this.mode !== CameraSystem.MODES.COCKPIT) return false;
    return Math.abs(this.lookYaw) > 0.38 || Math.abs(this.lookPitch - (this.aircraftLookPitch ?? -0.25)) > 0.42;
  }

  /**
   * Share of the zoom gaze lift that survives a manual aim: whole at the resting
   * centre, gone at the edge of the look-away window. Fading rather than switching
   * keeps a drag across that boundary from snapping the frame by more than the
   * zoom's own lift.
   */
  zoomGazeBlend() {
    const yawAway = Math.abs(this.lookYaw) / 0.38;
    const pitchAway = Math.abs(this.lookPitch - (this.aircraftLookPitch ?? -0.25)) / 0.42;
    return Math.max(0, 1 - Math.max(yawAway, pitchAway));
  }

  resetDroneOrbit(angle = 1.8, distance = 38.0, height = 11.5) {
    if (this.userLookOverridden) {
      return;
    }
    this.droneOrbitAngle = angle;
    this.droneDistance = distance;
    this.droneHeight = height;
    this.droneInitialized = false;
  }

  loadAircraftConfig(config = {}) {
    this.aircraftConfig = config;
    this.cinematicDirector?.loadAircraftConfig?.(config);
    const cockpit = config.cockpit || {};
    this.cockpitPortraitEyeX = cockpit.portraitEyeX ?? -0.34;
    this.cockpitPortraitEyeY = cockpit.portraitEyeY ?? null;
    const aero = config.aerodynamics || {};
    const span = aero.wingspanM ?? 35.8;

    this.supportsPhotoCockpit = cockpit.hasPhotoCockpit ?? (config.id ? config.id === 'B738' : true);
    if (!this.supportsPhotoCockpit) {
      this.photoCockpit = false;
    }

    if (cockpit.captainEyePos) {
      const p = cockpit.captainEyePos;
      this.cockpitHeadOffset.set(p.x, p.y, p.z);
    }
    this.aircraftLookPitch = cockpit.defaultLookPitchRad ?? -0.25;
    if (cockpit.defaultLookPitchRad !== undefined) {
      this.lookPitch = cockpit.defaultLookPitchRad;
    }
    if (cockpit.chaseDistance !== undefined) {
      this.chaseDistance = cockpit.chaseDistance;
    } else if (span) {
      this.chaseDistance = Math.max(12.0, span * 1.5);
    }
    if (cockpit.chaseHeight !== undefined) {
      this.chaseHeight = cockpit.chaseHeight;
    } else if (span) {
      this.chaseHeight = Math.max(3.0, this.chaseDistance * 0.19);
    }
    this.aircraftChaseDistance = this.chaseDistance;
    this.aircraftChaseHeight = this.chaseHeight;
    if (cockpit.droneDistance !== undefined) {
      this.droneDistance = cockpit.droneDistance;
    } else if (span) {
      this.droneDistance = Math.max(10.0, span * 1.05);
    }
    if (cockpit.droneHeight !== undefined) {
      this.droneHeight = cockpit.droneHeight;
    } else if (span) {
      this.droneHeight = Math.max(3.0, this.droneDistance * 0.30);
    }
    if (cockpit.gearCamOffset) {
      const g = cockpit.gearCamOffset;
      this.gearCamOffset.set(g.x, g.y, g.z);
    }
    if (cockpit.gearLookTarget) {
      const gt = cockpit.gearLookTarget;
      this.gearLookTarget.set(gt.x, gt.y, gt.z);
    }
  }

  /**
   * Feed the cinematic director the live air-to-air arrays so a rail release
   * can cut to its launch/follow/bandit-POV sequence.
   */
  setCombatStateProvider(provider) {
    this.combatStateProvider = typeof provider === 'function' ? provider : null;
  }

  setTerrain(terrain) {
    this.terrainObj = terrain;
    if (typeof terrain === 'function') {
      this.getTerrainHeight = terrain;
    } else if (terrain && typeof terrain.getHeight === 'function') {
      this.getTerrainHeight = (x, z) => terrain.getHeight(x, z);
    }
  }

  queryGroundHeight(x, z) {
    let groundH = 0.0;
    if (this.getTerrainHeight) {
      try {
        const h = this.getTerrainHeight(x, z);
        if (typeof h === 'number' && !Number.isNaN(h)) groundH = h;
      } catch (e) {}
    }
    const waterLevel = this.terrainObj?.getWaterLevel?.(x, z) ?? 0.0;
    return Math.max(groundH, waterLevel);
  }
  snapToTarget(aircraftMesh) {
    const behindLocal = new THREE.Vector3(0, this.chaseHeight, this.chaseDistance);
    behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.chasePitch);
    behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.chaseYaw);
    this.chasePos.copy(behindLocal.applyMatrix4(aircraftMesh.matrixWorld));
    this.chaseTarget.copy(aircraftMesh.position);
    this.chaseTargetInitialized = true;

    if (this.mode === CameraSystem.MODES.CHASE) {
      const groundH = this.queryGroundHeight(this.chasePos.x, this.chasePos.z);
      if (this.chasePos.y < groundH + 1.8) {
        this.chasePos.y = groundH + 1.8;
      }
      this.camera.position.copy(this.chasePos);
      const lookTarget = aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(lookTarget);
    } else if (this.mode === CameraSystem.MODES.HUD) {
      this.updateHudView(aircraftMesh);
    } else if (this.mode === CameraSystem.MODES.COCKPIT) {
      const eyeLocal = this.cockpitHeadOffset.clone();
      if (this.camera && this.camera.aspect < 1.0) {
        eyeLocal.x = this.cockpitPortraitEyeX;
        if (this.cockpitPortraitEyeY !== null && this.cockpitPortraitEyeY !== undefined) {
          eyeLocal.y = this.cockpitPortraitEyeY;
        } else {
          eyeLocal.y += 0.03;
        }
      }
      const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
      this.camera.position.copy(eyeWorld);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
      this.camera.up.copy(upWorld);
      const forwardLocal = new THREE.Vector3(0, 0, -100);
      forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch);
      forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
      const forwardWorld = forwardLocal.applyQuaternion(aircraftMesh.quaternion);
      this.camera.lookAt(eyeWorld.clone().add(forwardWorld));
    } else if (this.mode === CameraSystem.MODES.GEAR) {
      const eyeWorld = this.gearCamOffset.clone().applyMatrix4(aircraftMesh.matrixWorld);
      const targetWorld = this.gearLookTarget.clone().applyMatrix4(aircraftMesh.matrixWorld);
      this.camera.position.copy(eyeWorld);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
      this.camera.up.copy(upWorld);
      this.camera.lookAt(targetWorld);
    } else if (this.mode === CameraSystem.MODES.DRONE) {
      const px = aircraftMesh.position.x + Math.sin(this.droneOrbitAngle) * this.droneDistance;
      const py = aircraftMesh.position.y + this.droneHeight;
      const pz = aircraftMesh.position.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;
      // A paused or parked airframe sits on terrain, so the rig must not snap inside it.
      this.dronePos.set(px, Math.max(py, this.queryGroundHeight(px, pz) + 2.5), pz);
      this.droneInitialized = true;
      this.camera.position.copy(this.dronePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(aircraftMesh.position.clone().add(this.droneLookOffset));
    } else if (this.mode === CameraSystem.MODES.FLYBY) {
      const planePos = aircraftMesh.position;
      const planeQuat = aircraftMesh.quaternion;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
      forward.y = 0;
      if (forward.lengthSq() > 0.0001) forward.normalize();
      else forward.set(1, 0, 0);
      const right = new THREE.Vector3(-forward.z, 0, forward.x);

      const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
      const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
      const groundH = this.queryGroundHeight(targetX, targetZ);
      const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

      this.flybyPos.set(targetX, targetY, targetZ);
      this.camera.position.copy(this.flybyPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(planePos.clone().add(new THREE.Vector3(0, 1.2, 0)));
      this.flybySet = true;
      this.flybyRegime = 'parked';
    } else if (this.mode === CameraSystem.MODES.WING) {
      const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
      const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
      this.camera.position.copy(eyeWorld);
      const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
      this.camera.up.copy(upWorld);
      const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
      lookLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.wingLookYaw);
      lookLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.wingLookPitch);
      const lookWorld = eyeWorld.clone().add(lookLocal.applyQuaternion(aircraftMesh.quaternion));
      this.camera.lookAt(lookWorld);
    } else if (this.mode === CameraSystem.MODES.DIRECTOR) {
      this.cinematicDirector?.reset?.();
    } else {
      this.camera.position.copy(this.chasePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    }
  }

  showTemporaryView(m, durationSeconds = 4.5, onComplete = null) {
    if (this.crashView) return;
    if (this.autoPaused || this.userLookOverridden || (this.userModeSelected && !this.autoSwitch)) {
      return;
    }
    if (this.mode !== m && this.temporaryViewTimer <= 0) {
      this.savedMode = this.mode;
    }
    this.mode = m;
    this.temporaryViewTimer = durationSeconds;
    this.onTemporaryViewComplete = onComplete;
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
      this.flybyRegime = null;
    }
  }

  cancelTemporaryView() {
    if (this.temporaryViewTimer > 0) {
      this.temporaryViewTimer = 0;
      if (this.savedMode !== null && this.savedMode !== undefined) {
        this.mode = this.savedMode;
        this.savedMode = null;
        if (this.mode === CameraSystem.MODES.DRONE) {
          this.droneInitialized = false;
        }
      }
      this.onTemporaryViewComplete = null;
    }
  }

  cycleMode() {
    if (this.crashView) {
      const selected = this.mode;
      const index = CameraSystem.CRASH_MODES.indexOf(selected);
      const nextIndex = index === -1 ? 0 : (index + 1) % CameraSystem.CRASH_MODES.length;
      const next = CameraSystem.CRASH_MODES[nextIndex];
      this.setMode(next, true);
      if (this.onCycleMode) {
        this.onCycleMode(this.mode);
      }
      return this.getModeName();
    }
    const selected = this.savedMode ?? this.mode;
    const index = CameraSystem.QUICK_CYCLE.indexOf(selected);
    const next = this.autoSwitch ? CameraSystem.MODES.CHASE
      : CameraSystem.QUICK_CYCLE[(index + 1) % CameraSystem.QUICK_CYCLE.length];
    this.setMode(next, true);
    if (this.onCycleMode) {
      this.onCycleMode(this.mode);
    }
    return this.getModeName();
  }

  holdForManualLook(isTouch = false) {
    this.userLookOverridden = true;
    this.touchAutoResumeTimer = isTouch && this.autoSwitch && !this.autoPaused ? 4 : null;
    this.cancelTemporaryView();
  }

  toggleAutoViewing() {
    if (!this.autoSwitch) {
      this.setMode(CameraSystem.MODES.AUTO, true);
    } else if (this.autoPaused || this.userLookOverridden) {
      // Resume from the current framing, without snapping back to chase.
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

  setCustomViewUpdater(fn) {
    this.customViewUpdater = typeof fn === 'function' ? fn : null;
  }

  setMode(m, isUserAction = false) {
    if (this.crashView) {
      if (!isUserAction) return false;
      if (!CameraSystem.CRASH_MODES.includes(m)) return false;
      this.#applyMode(m);
      this.resetLook();
      return true;
    }
    if ((this.userLookOverridden || this.userModeSelected) && !isUserAction) {
      return false;
    }
    if (isUserAction) {
      this.userModeSelected = true;
      this.customViewUpdater = null;
    }
    return this.#applyMode(m);
  }

  /**
   * Install the interior-readiness probe: a function returning 'ready', 'loading' or
   * 'unavailable'. It is called only when something asks for the cockpit view, so an
   * interior nobody looks at is never downloaded.
   */
  setCockpitInteriorGate(gate) {
    this.cockpitInteriorGate = typeof gate === 'function' ? gate : null;
  }

  /** Land a cockpit entry the gate held, once the interior has arrived. */
  completeCockpitEntry() {
    if (!this.pendingCockpitEntry) return false;
    this.pendingCockpitEntry = false;
    return this.#applyMode(CameraSystem.MODES.COCKPIT);
  }

  /** Arm a cockpit entry to be landed later, after the view was pulled out for a new interior. */
  holdCockpitEntry() {
    this.pendingCockpitEntry = true;
  }

  /** Stop waiting on an interior that will never arrive; true when a held entry was waiting. */
  releaseCockpitEntry() {
    const wasPending = this.pendingCockpitEntry;
    this.pendingCockpitEntry = false;
    return wasPending;
  }

  #applyMode(m) {
    // Every route into the cockpit converges here — the key, the panel, HOTAS, the demo director
    // and AUTO's own intent — so this is where a cockpit view waits for its interior.
    if (m === CameraSystem.MODES.COCKPIT && this.cockpitInteriorGate?.() === 'loading') {
      this.pendingCockpitEntry = true;
      return false;
    }
    this.pendingCockpitEntry = false;
    if (m === CameraSystem.MODES.AUTO) this.autoContext = null;
    this.userLookOverridden = false;
    this.cancelTemporaryView();
    this.autoSwitch = m === CameraSystem.MODES.AUTO;
    this.autoPaused = false;
    this.autoSwitchTimer = 0;
    this.mode = this.autoSwitch ? CameraSystem.MODES.CHASE : m;
    this.resetLook();
    if (this.camera) {
      this.camera.near = (this.mode === CameraSystem.MODES.COCKPIT) ? 0.08 : 0.25;
      if (typeof this.camera.updateProjectionMatrix === 'function') {
        this.camera.updateProjectionMatrix();
      }
    }
    if (this.mode === CameraSystem.MODES.FLYBY) {
      this.flybySet = false;
      this.flybyRegime = null;
    }
    if (this.mode === CameraSystem.MODES.DRONE) {
      this.droneInitialized = false;
    }
    if (this.mode === CameraSystem.MODES.DIRECTOR) {
      this.cinematicDirector?.reset?.();
    }
    return true;
  }

  toggleCockpitPhoto() {
    if (!this.supportsPhotoCockpit) {
      this.photoCockpit = false;
      return false;
    }
    this.photoCockpit = !this.photoCockpit;
    return this.photoCockpit;
  }

  setCockpitPhoto(enabled) {
    if (!this.supportsPhotoCockpit) {
      this.photoCockpit = false;
      return;
    }
    this.photoCockpit = !!enabled;
  }

  getCockpitSubmodeName() {
    return (this.photoCockpit && this.supportsPhotoCockpit) ? 'PHOTO 2D' : '3D VIRTUAL';
  }

  getModeName() {
    const name = this.getViewName();
    return this.autoSwitch ? `AUTO · ${name}` : name;
  }

  // Fixed boresight: HUD symbols and the landscape use the same attitude.
  // Use each aircraft's configured eye point without cockpit gaze tilt or shake.
  updateHudView(aircraftMesh) {
    this.camera.position.copy(this.cockpitHeadOffset).applyMatrix4(aircraftMesh.matrixWorld);
    this.camera.quaternion.copy(aircraftMesh.quaternion);
    this.camera.up.set(0, 1, 0).applyQuaternion(aircraftMesh.quaternion);
  }

  getViewName() {
    if (this.crashView) {
      switch (this.mode) {
        case CameraSystem.MODES.CHASE: return 'WRECKAGE ORBIT';
        case CameraSystem.MODES.DRONE: return 'CRASH SCENE DRONE';
        case CameraSystem.MODES.FLYBY: return 'SPECTATOR VIEW';
        case CameraSystem.MODES.TOWER: return 'AIRPORT TOWER';
        default: return 'CRASH VIEW';
      }
    }
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: return 'COCKPIT (CAPTAIN)';
      case CameraSystem.MODES.CHASE: return 'CHASE (EXTERIOR)';
      case CameraSystem.MODES.WING: return 'WING VIEW';
      case CameraSystem.MODES.TOWER: return 'AIRPORT TOWER';
      case CameraSystem.MODES.FLYBY: return 'CINEMATIC FLYBY';
      case CameraSystem.MODES.GEAR: return 'GEAR CAM (BELLY)';
      case CameraSystem.MODES.DRONE: return 'DRONE (ORBIT VIEW)';
      case CameraSystem.MODES.HUD: return 'HUD';
      case CameraSystem.MODES.DIRECTOR: return 'CINEMATIC DIRECTOR';
      default: return 'CAMERA';
    }
  }

  /**
   * Continuous physical speed sensation:
   * 1. Dynamic FOV expansion (optical flow peripheral expansion proportional to IAS / dynamic pressure)
   * 2. Chase camera dynamic inertial lag and distance breathing
   * 3. High-frequency physical vibrations (runway roll rumble & aerodynamic transonic / spoiler buffet)
   */
  updateSpeedSensation(dt, flightState) {
    if (!flightState) {
      this.speedFov = 0;
      this.chaseSpeedLag = 0;
      this.vibrationOffset.set(0, 0, 0);
      this.chaseVibration.set(0, 0, 0);
      return;
    }

    const safeDt = Math.max(0.001, Math.min(0.1, dt || 0.016));
    const ias = flightState.iasKnots || 0;
    const gs = flightState.groundSpeedKnots || (flightState.groundSpeed ? flightState.groundSpeed * 1.94384 : 0);
    const onGround = !!flightState.onGround;

    // 1. Dynamic Speed FOV Scaling (Physical expansion of optical flow)
    // Normalized against typical airliner max cruise / operating limit (~340-360 KT)
    const speedRatio = Math.max(0, Math.min(1.0, ias / 360.0));
    let targetFovExpansion = 0;
    if (this.mode === CameraSystem.MODES.CHASE) {
      targetFovExpansion = speedRatio * 6.5; // up to +6.5° expansion at high speed
    } else if (this.mode === CameraSystem.MODES.COCKPIT) {
      targetFovExpansion = speedRatio * 3.5; // subtle +3.5° in cockpit to preserve panel readability
    } else if (this.mode === CameraSystem.MODES.WING) {
      targetFovExpansion = speedRatio * 4.0;
    }

    // Optical magnification suppresses speed FOV proportionally
    if (this.opticalZoom > 1.0) {
      targetFovExpansion /= this.opticalZoom;
    }

    // Smooth exponential relaxation (continuous physical transition without sudden pops)
    this.speedFov += (targetFovExpansion - this.speedFov) * (1.0 - Math.exp(-safeDt * 3.0));

    // 2. Chase Camera Dynamic Inertial Lag & Breathing Distance
    // High-speed air resistance causes the camera to drift slightly back (+0m to +5.5m)
    const targetChaseLag = (this.mode === CameraSystem.MODES.CHASE) ? (speedRatio * 5.5) : 0;
    this.chaseSpeedLag += (targetChaseLag - this.chaseSpeedLag) * (1.0 - Math.exp(-safeDt * 2.5));

    // 3. Physical Micro-Vibrations (Deterministic time accumulation)
    this.speedSensationTime += safeDt;
    const now = this.speedSensationTime;
    let vibeX = 0, vibeY = 0, vibeZ = 0;
    let chaseVibeY = 0;

    if (onGround && gs > 12.0) {
      // Runway pavement expansion joints and surface micro-texture rumble (12 KT up to takeoff speed ~150 KT)
      const rollIntensity = Math.min(1.0, Math.max(0, (gs - 12.0) / 120.0));
      const r1 = Math.sin(now * 165.0) * Math.cos(now * 255.0);
      const r2 = Math.cos(now * 185.0) * Math.sin(now * 295.0);
      vibeY = r1 * 0.0035 * rollIntensity; // up to ~3.5mm vertical pavement jolt
      vibeX = r2 * 0.0020 * rollIntensity;
      chaseVibeY = r1 * 0.035 * rollIntensity; // subtle ~3.5cm exterior camera roll tremor
    } else if (!onGround) {
      // Aerodynamic airframe boundary jitter (> 220 KT) + spoiler turbulence buffet
      const highSpeedBuffet = Math.max(0, Math.min(1.0, (ias - 220.0) / 120.0));
      const spoilerBuffet = (flightState.spoilers || 0) * Math.min(1.0, ias / 150.0);
      const aeroIntensity = highSpeedBuffet * 0.65 + spoilerBuffet * 0.75;
      if (aeroIntensity > 0.005) {
        const a1 = (Math.sin(now * 115.0) + Math.cos(now * 195.0)) * 0.5;
        const a2 = (Math.cos(now * 135.0) + Math.sin(now * 220.0)) * 0.5;
        vibeY = a1 * 0.0025 * aeroIntensity;
        vibeX = a2 * 0.0016 * aeroIntensity;
        chaseVibeY = a1 * 0.025 * aeroIntensity;
      }
    }

    this.vibrationOffset.set(vibeX, vibeY, vibeZ);
    this.chaseVibration.set(0, chaseVibeY, 0);
  }

  beginCrashView(wreckage) {
    const returnMode = this.temporaryViewTimer > 0 && this.savedMode != null ? this.savedMode : this.mode;
    this.preCrashState = {
      mode: this.autoSwitch ? CameraSystem.MODES.AUTO : returnMode,
      userModeSelected: this.userModeSelected,
      userLookOverridden: this.userLookOverridden,
      customViewUpdater: this.customViewUpdater,
      autoPaused: this.autoPaused,
      autoSwitchTimer: this.autoSwitchTimer,
      touchAutoResumeTimer: this.touchAutoResumeTimer,
    };
    this.#applyMode(CameraSystem.MODES.CHASE);
    this.crashView = wreckage;
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.droneOrbitAngle = 0;
    this.droneHeight = 11.5;
    this.flybyLookYaw = 0;
    this.crashDirection = new THREE.Vector3(1, 0.65, 1).normalize();
    this.updateCrashView(0, true);
  }

  endCrashView() {
    // The crash rig bypasses normal update/trauma decay. A new flight must
    // never replay the previous impact, including repeated cleanup calls.
    this.trauma = 0;
    if (!this.crashView) return;
    this.crashView = null;
    const { mode, ...state } = this.preCrashState;
    this.#applyMode(mode);
    Object.assign(this, state);
    this.preCrashState = null;
  }

  /**
   * Hold the paused aircraft in a slow drone orbit, then hand the pilot back the exact view
   * they flew with. Goes through the internal mode path because setMode() refuses a
   * programmatic switch once the pilot picked a view; idempotent, and yields to the crash rig.
   */
  beginPauseView() {
    if (this.crashView || this.pauseView) return false;
    const returnMode = this.temporaryViewTimer > 0 && this.savedMode != null ? this.savedMode : this.mode;
    this.pauseView = {
      mode: this.autoSwitch ? CameraSystem.MODES.AUTO : returnMode,
      userModeSelected: this.userModeSelected,
      userLookOverridden: this.userLookOverridden,
      customViewUpdater: this.customViewUpdater,
      autoPaused: this.autoPaused,
      autoSwitchTimer: this.autoSwitchTimer,
      touchAutoResumeTimer: this.touchAutoResumeTimer,
    };
    this.#applyMode(CameraSystem.MODES.DRONE);
    return true;
  }

  endPauseView() {
    if (!this.pauseView) return false;
    const { mode, ...state } = this.pauseView;
    this.pauseView = null;
    this.#applyMode(mode);
    Object.assign(this, state);
    return true;
  }

  updateCrashView(dt, snap = false) {
    if (!this.crashView) return;
    const { target, radius } = this.crashView;
    const halfFov = THREE.MathUtils.degToRad(50 / 2);
    const fit = (radius || 20) / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, this.camera.aspect)));

    if (this.mode === CameraSystem.MODES.DRONE) {
      if (!this.userLookOverridden && !this.autoPaused && dt > 0) {
        this.droneOrbitAngle += 0.22 * dt;
      }
      const dist = Math.max(30, fit * 0.9) / (this.opticalZoom || 1.0);
      const droneH = Math.max(12, (radius || 20) * 0.8) + (this.droneHeight || 0);
      const hoverBob = Math.sin(this.droneOrbitAngle * 1.8) * 0.4;
      const tx = target.x + Math.sin(this.droneOrbitAngle) * dist;
      const tz = target.z + Math.cos(this.droneOrbitAngle) * dist;
      const groundH = this.queryGroundHeight ? this.queryGroundHeight(tx, tz) : (this.getTerrainHeight ? this.getTerrainHeight(tx, tz) : 0);
      const ty = Math.max(target.y + droneH + hoverBob, groundH + 3.0);
      const eye = new THREE.Vector3(tx, ty, tz);
      this.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
    } else if (this.mode === CameraSystem.MODES.FLYBY) {
      const spotterDist = Math.max(50, fit * 1.4) / (this.opticalZoom || 1.0);
      const spotterAngle = (Math.PI / 4) + (this.flybyLookYaw || 0);
      const tx = target.x + Math.sin(spotterAngle) * spotterDist;
      const tz = target.z + Math.cos(spotterAngle) * spotterDist;
      const groundH = this.queryGroundHeight ? this.queryGroundHeight(tx, tz) : (this.getTerrainHeight ? this.getTerrainHeight(tx, tz) : 0);
      const ty = groundH + 2.0;
      const eye = new THREE.Vector3(tx, ty, tz);
      this.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      this.camera.up.set(0, 1, 0);
      const lookOffset = new THREE.Vector3(0, (radius || 20) * 0.2, 0);
      this.camera.lookAt(target.clone().add(lookOffset));
    } else if (this.mode === CameraSystem.MODES.TOWER) {
      this.camera.position.lerp(this.towerPos, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
    } else {
      // CHASE / Wreckage Orbit
      const dist = (fit * 1.15) / (this.opticalZoom || 1.0);
      const baseAzimuth = Math.PI / 4;
      const baseElevation = 0.43;
      const totalYaw = baseAzimuth + (this.chaseYaw || 0);
      const totalPitch = THREE.MathUtils.clamp(baseElevation + (this.chasePitch || 0), 0.08, 1.45);
      const dir = new THREE.Vector3(
        Math.cos(totalPitch) * Math.sin(totalYaw),
        Math.sin(totalPitch),
        Math.cos(totalPitch) * Math.cos(totalYaw)
      );
      const eye = target.clone().addScaledVector(dir, dist);
      const groundH = this.queryGroundHeight ? this.queryGroundHeight(eye.x, eye.z) : (this.getTerrainHeight ? this.getTerrainHeight(eye.x, eye.z) : 0);
      if (Number.isFinite(groundH)) {
        eye.y = Math.max(eye.y, groundH + 2.0);
      }
      this.camera.position.lerp(eye, snap ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(target);
    }

    this.camera.fov = 50;
    if (this.opticalZoom && this.opticalZoom > 1.0) {
      const halfTan = Math.tan((50 * Math.PI) / 360) / this.opticalZoom;
      this.camera.fov = (Math.atan(halfTan) * 360) / Math.PI;
    }
    this.camera.updateProjectionMatrix();
  }

  update(dt, aircraftMesh, flightState = {}, getTerrainHeight = null) {
    if (this.crashView) {
      this.updateCrashView(dt);
      return;
    }
    this.updateSpeedSensation(dt, flightState);
    if (getTerrainHeight) {
      this.setTerrain(getTerrainHeight);
    }
    let resumedTouchLook = false;
    // The four-second grace period starts after the final scenery touch lifts.
    // Explicit pause is sticky; only a touch interruption resumes by itself.
    if (this.autoSwitch && !this.autoPaused && this.touchAutoResumeTimer !== null
        && this.activeTouchId === null && !this.isPinching && !this.isDragging) {
      this.touchAutoResumeTimer = Math.max(0, this.touchAutoResumeTimer - Math.max(0, dt));
      if (this.touchAutoResumeTimer === 0) {
        this.touchAutoResumeTimer = null;
        this.userLookOverridden = false;
        this.autoSwitchTimer = 0;
        resumedTouchLook = true;
      }
    }
    if (this.autoSwitch && !this.autoPaused && !this.userLookOverridden
        && !resumedTouchLook && this.activeTouchId === null && !this.isPinching
        && !this.isDragging && this.temporaryViewTimer <= 0) {
      this.autoSwitchTimer += Math.max(0, dt);
      const agl = aircraftMesh.position.y - this.queryGroundHeight(aircraftMesh.position.x, aircraftMesh.position.z);
      const intent = autoCameraIntent(flightState, agl);
      if (intent.context !== this.autoCandidate) {
        this.autoCandidate = intent.context;
        this.autoCandidateSeconds = 0;
      }
      this.autoCandidateSeconds += Math.max(0, dt);
      // Minimum shot duration suppresses cuts from brief telemetry fluctuations.
      if (this.autoSwitchTimer >= 6 && this.autoCandidateSeconds >= 1 && intent.context !== this.autoContext) {
        if (intent.mode !== this.mode) this.#applyMode(intent.mode);
        this.autoContext = intent.context;
        this.autoSwitchTimer = 0;
        this.autoSwitch = true;
      }
    }
    // 1. Process temporary cinematic view timer (auto-cut during takeoff, landing, gear transit)
    if (this.temporaryViewTimer > 0) {
      this.temporaryViewTimer -= dt;
      if (this.temporaryViewTimer <= 0) {
        this.temporaryViewTimer = 0;
        if (this.savedMode !== null && this.savedMode !== undefined) {
          this.mode = this.savedMode;
          this.savedMode = null;
          if (this.mode === CameraSystem.MODES.DRONE) {
            this.droneInitialized = false;
          }
          if (this.onTemporaryViewComplete) {
            const cb = this.onTemporaryViewComplete;
            this.onTemporaryViewComplete = null;
            cb();
          }
        }
      }
    }

    const planePos = aircraftMesh.position;
    const planeQuat = aircraftMesh.quaternion;

    // Carry translation through immediately, even while another view is active.
    // Damp only changes in orbit/attitude, so variable frame times cannot change
    // the aircraft distance and pitch the horizon during a steady approach.
    if (this.chaseTargetInitialized) {
      if (this.droneInitialized) {
        this.dronePos.add(planePos).sub(this.chaseTarget);
      }
      if (this.flybySet && this.flybyRegime === 'parked') {
        this.flybyPos.add(planePos).sub(this.chaseTarget);
      }
      this.chasePos.add(planePos).sub(this.chaseTarget);
    }
    this.chaseTarget.copy(planePos);
    this.chaseTargetInitialized = true;

    // Smooth Touchdown Jolt with exponential decay (affects cockpit and exterior suspension reaction)
    this.touchJoltOffset = (this.touchJoltOffset || 0) * Math.max(0.0, 1.0 - dt * 6.0);
    if (flightState.touchdown) {
      const vsi = Math.abs(flightState.vsiFpm || 400);
      const severity = Math.min(1.2, Math.max(0.4, vsi / 450.0));
      this.touchJoltOffset = -0.045 * severity;
    }

    // Smoothly interpolate cursor tracking offsets (마우스 움직임에 따른 실시간 시선 부드러운 추종 - 유저 시선 개입 시 오프셋 배제)
    if (!this.userLookOverridden) {
      this.cursorNormX += (this.targetCursorNormX - this.cursorNormX) * Math.min(1.0, dt * 7.0);
      this.cursorNormY += (this.targetCursorNormY - this.cursorNormY) * Math.min(1.0, dt * 7.0);
    } else {
      this.cursorNormX = 0;
      this.cursorNormY = 0;
    }

    // Continuous Edge Pan (마우스 드래그 중 화면 끝 도달 시 적당한 속도로 시선 지속 회전)
    this.updateEdgePan(dt);

    // Slowly return camera POV back to default position after drag
    this.updatePovReturn(dt);
    this.updatePovButtonState();

    if (this.customViewUpdater && !this.userModeSelected && !this.userLookOverridden) {
      const handled = this.customViewUpdater({
        dt,
        camera: this.camera,
        planePos,
        planeQuat,
        aircraftMesh,
        flightState,
        queryGroundHeight: (x, z) => this.queryGroundHeight(x, z)
      });
      if (handled) return;
    }

    switch (this.mode) {
      case CameraSystem.MODES.HUD: {
        this.updateHudView(aircraftMesh);
        break;
      }
      case CameraSystem.MODES.COCKPIT: {
        // First-Person Cockpit View
        // 1. Calculate head displacement from G-forces & buffeting
        // On ground, ignore landing gear suspension spring oscillation to prevent instrument jitter
        const gForce = flightState.onGround ? 1.0 : (flightState.gForce || 1.0);
        const targetGOffset = Math.max(-0.02, Math.min(0.02, -(gForce - 1.0) * 0.015));
        this.headGForceOffset.y += (targetGOffset - this.headGForceOffset.y) * Math.min(1.0, dt * 4.0);

        // Stall Buffeting Shake (airborne only) + pre-stall stick shaker buzz
        let buffetX = 0, buffetY = 0;
        if (flightState.isStalled && !flightState.onGround) {
          const t = performance.now() * 0.03;
          const severity = flightState.buffetVibration || 0.5;
          buffetX = (Math.sin(t * 1.7) + Math.cos(t * 3.1)) * 0.015 * severity;
          buffetY = (Math.cos(t * 2.3) + Math.sin(t * 4.2)) * 0.015 * severity;
        } else if (flightState.isPreStall && !flightState.onGround) {
          // Control-column shaker: tight high-frequency buzz, no vertical component
          const t = performance.now() * 0.09;
          buffetX = Math.sin(t) * 0.0035;
        }

        const eyeLocal = this.cockpitHeadOffset.clone();
        if (this.camera && this.camera.aspect < 1.0) {
          eyeLocal.x = this.cockpitPortraitEyeX;
          if (this.cockpitPortraitEyeY !== null && this.cockpitPortraitEyeY !== undefined) {
            eyeLocal.y = this.cockpitPortraitEyeY;
          } else {
            eyeLocal.y += 0.03;
          }
        }
        if (this.photoCockpit && this.supportsPhotoCockpit) {
          eyeLocal.set(-0.48, 0.88, -12.02);
        }
        // Saturate the lean early so the first wheel/pinch movement feels like
        // leaning out to see; further zoom retains optical magnification. The
        // offset stays in aircraft space even while looking sideways or down.
        if (!(this.photoCockpit && this.supportsPhotoCockpit)) {
          const lean = (1 - 1 / this.opticalZoom) / (1 - 1 / this.opticalZoomMax);
          eyeLocal.addScaledVector(this.cockpitZoomLean, lean);
        }
        eyeLocal.y += this.headGForceOffset.y + buffetY + this.touchJoltOffset + this.vibrationOffset.y;
        eyeLocal.x += buffetX + this.vibrationOffset.x;

        // Transform eye point to world space
        const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        // Up vector tracks aircraft roll (MUST be set BEFORE lookAt)
        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        // Compute forward look target with head rotation and subtle cursor tracking
        const cursorYaw = this.enableCursorTrack ? (-this.cursorNormX * 0.18) : 0;
        const cursorPitch = this.enableCursorTrack ? (-this.cursorNormY * 0.12) : 0;

        const effectiveYaw = this.lookYaw + cursorYaw;
        const isPhoto = this.photoCockpit && this.supportsPhotoCockpit;
        const basePitch = (isPhoto && !this.isLookingAwayFromCenter()) ? (this.lookPitch * 0.2 - 0.04) : this.lookPitch;
        // A manual aim fades the lift out across the look-away window.
        const zoomGazeLift = isPhoto ? 0
          : (this.opticalZoom - 1) * this.cockpitZoomGazeLift * this.zoomGazeBlend();
        const effectivePitch = basePitch + zoomGazeLift + cursorPitch;

        const forwardLocal = new THREE.Vector3(0, 0, -100);
        forwardLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), effectivePitch);
        forwardLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), effectiveYaw);
        const forwardWorld = forwardLocal.applyQuaternion(planeQuat);

        this.camera.lookAt(eyeWorld.clone().add(forwardWorld));
        break;
      }

      case CameraSystem.MODES.CHASE: {
        // Smooth Third-Person Exterior Chase Camera with full 360° mouse look & orbit
        const cursorChaseYaw = this.enableCursorTrack ? (-this.cursorNormX * 0.18) : 0;
        const cursorChasePitch = this.enableCursorTrack ? (-this.cursorNormY * 0.12) : 0;

        const totalYaw = this.chaseYaw + cursorChaseYaw;
        const totalPitch = Math.max(-1.1, Math.min(CameraSystem.CHASE_PITCH_LOW_LIMIT, this.chasePitch + cursorChasePitch));

        const effectiveChaseDist = this.chaseDistance + this.chaseSpeedLag;
        const behindLocal = new THREE.Vector3(0, this.chaseHeight, effectiveChaseDist);
        behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), totalPitch);
        behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);

        const targetBehindWorld = behindLocal.applyMatrix4(aircraftMesh.matrixWorld);

        // Ground safety clamp: prevent exterior camera from clipping into terrain or runway
        const groundH = this.queryGroundHeight(targetBehindWorld.x, targetBehindWorld.z);
        if (targetBehindWorld.y < groundH + 1.8) {
          targetBehindWorld.y = groundH + 1.8;
        }

        // Damped interpolation to smooth camera motion
        this.chasePos.lerp(targetBehindWorld, 1 - Math.exp(-Math.max(0, dt) * 6.5));
        // Clamp the final smoothed position too, especially along steep terrain.
        this.chasePos.y = Math.max(this.chasePos.y,
          this.queryGroundHeight(this.chasePos.x, this.chasePos.z) + 1.8);
        this.camera.position.copy(this.chasePos);

        const lookTarget = planePos.clone().add(new THREE.Vector3(
          this.chaseVibration.x,
          1.5 + this.chaseVibration.y,
          this.chaseVibration.z
        ));
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(lookTarget);
        break;
      }

      case CameraSystem.MODES.WING: {
        // Passenger Window View (Overlooking Left Wing & Engine)
        const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
        windowLocal.y += this.vibrationOffset.y * 0.75;
        windowLocal.x += this.vibrationOffset.x * 0.75;
        const eyeWorld = windowLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.position.copy(eyeWorld);

        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        const cursorWingYaw = this.enableCursorTrack ? (-this.cursorNormX * 0.16) : 0;
        const cursorWingPitch = this.enableCursorTrack ? (-this.cursorNormY * 0.12) : 0;
        const totalWingYaw = this.wingLookYaw + cursorWingYaw;
        const totalWingPitch = this.wingLookPitch + cursorWingPitch;

        // Look outward towards wingtip and engine with mouse pan/tilt
        const lookLocal = new THREE.Vector3(-15.0, -1.2, -4.0);
        lookLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), totalWingYaw);
        lookLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), totalWingPitch);

        const lookWorld = eyeWorld.clone().add(lookLocal.applyQuaternion(planeQuat));
        this.camera.lookAt(lookWorld);
        break;
      }

      case CameraSystem.MODES.TOWER: {
        // Fixed Airport Control Tower View looking at plane
        this.camera.position.copy(this.towerPos);
        this.camera.lookAt(planePos);
        this.camera.up.set(0, 1, 0);
        break;
      }

      case CameraSystem.MODES.FLYBY: {
        const onGround = !!(flightState && flightState.onGround);
        const groundSpeed = flightState
          ? (flightState.groundSpeed !== undefined
              ? flightState.groundSpeed
              : (flightState.groundSpeedKnots !== undefined
                  ? flightState.groundSpeedKnots * 0.514444
                  : (flightState.iasKnots ? flightState.iasKnots * 0.514444 : 0)))
          : 0;

        // Determine current flight regime:
        // 'parked': on ground & low speed (< 12 m/s / ~23 kts) -> 45m front 3/4 showcase
        // 'rollout': on ground & high speed (>= 12 m/s) -> 120m runway-edge spotter
        // 'airborne': in flight -> 260m flyby along flight path
        let currentRegime = 'airborne';
        if (onGround) {
          if (this.flybyRegime === 'rollout') {
            currentRegime = groundSpeed < 9.0 ? 'parked' : 'rollout';
          } else {
            currentRegime = groundSpeed >= 12.0 ? 'rollout' : 'parked';
          }
        }

        // Reinitialize flyby shot when flight regime changes
        if (this.flybyRegime !== currentRegime) {
          this.flybyRegime = currentRegime;
          this.flybySet = false;
        }

        // Aircraft forward vector projected onto horizontal plane
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
        forward.y = 0;
        if (forward.lengthSq() > 0.0001) {
          forward.normalize();
        } else {
          forward.set(1, 0, 0);
        }
        // Lateral right vector orthogonal to forward on horizontal plane
        const right = new THREE.Vector3(-forward.z, 0, forward.x);

        if (currentRegime === 'parked') {
          // Case 1: Landed, parked, or slow taxiing on runway / apron
          // Position camera 45m ahead of nose, 9m to side for an impressive front 3/4 showcase view
          const targetX = planePos.x + forward.x * 45.0 + right.x * 9.0;
          const targetZ = planePos.z + forward.z * 45.0 + right.z * 9.0;
          const groundH = this.queryGroundHeight(targetX, targetZ);
          const targetY = Math.max(groundH + 2.4, planePos.y - 0.5);

          const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
          if (!this.flybySet || this.flybyPos.distanceTo(targetPos) > 75.0) {
            this.flybyPos.copy(targetPos);
            this.flybySet = true;
          } else {
            // Smoothly track in front of aircraft if taxiing or turning
            this.flybyPos.lerp(targetPos, 1 - Math.exp(-Math.max(0, dt) * 6.0));
          }
        } else if (currentRegime === 'rollout') {
          // Case 2: Active takeoff roll or landing rollout at high speed (>= 12 m/s / ~23 kts)
          // Runway-side spotter camera positioned ~120m ahead and 20m off centerline at runway edge
          if (!this.flybySet) {
            const targetX = planePos.x + forward.x * 120.0 + right.x * 20.0;
            const targetZ = planePos.z + forward.z * 120.0 + right.z * 20.0;
            const groundH = this.queryGroundHeight(targetX, targetZ);
            const targetY = groundH + 1.8; // Eye level at runway edge
            this.flybyPos.set(targetX, targetY, targetZ);
            this.flybySet = true;
          }

          // Reset ahead once aircraft rolls past camera by > 140m
          const toPlane = planePos.clone().sub(this.flybyPos);
          if (this.camera.position.distanceTo(planePos) > 180 && forward.dot(toPlane) > 0) {
            this.flybySet = false;
          }
        } else {
          // Case 3: In flight (airborne)
          // Position camera ahead along flight path, safely above ground and sea level
          if (!this.flybySet) {
            const targetX = planePos.x + forward.x * 260.0 + right.x * 28.0;
            const targetZ = planePos.z + forward.z * 260.0 + right.z * 28.0;
            const groundH = this.queryGroundHeight(targetX, targetZ);
            // Height slightly below flight path, but strictly clamped above terrain and water
            const targetY = Math.max(groundH + 4.5, 4.5, planePos.y - 8.0);
            this.flybyPos.set(targetX, targetY, targetZ);
            this.flybySet = true;
          }

          // Reset if aircraft passes far beyond
          if (this.camera.position.distanceTo(planePos) > 600) {
            this.flybySet = false;
          }
        }

        // Final safety clamp: camera Y must NEVER be below terrain height or water surface
        const currentGroundH = this.queryGroundHeight(this.flybyPos.x, this.flybyPos.z);
        if (this.flybyPos.y < currentGroundH + 1.5) {
          this.flybyPos.y = currentGroundH + 1.5;
        }

        this.camera.position.copy(this.flybyPos);
        this.camera.up.set(0, 1, 0);

        // Look at aircraft center with slight vertical offset for good framing
        const lookTarget = planePos.clone().add(new THREE.Vector3(0, 1.2, 0));
        this.camera.lookAt(lookTarget);
        break;
      }

      case CameraSystem.MODES.GEAR: {
        // Fuselage Lower Oblique Belly Cam looking at Landing Gear & Runway
        const eyeLocal = this.gearCamOffset.clone();
        if (Math.abs(this.vibrationOffset.y) > 0.0001) {
          eyeLocal.y += this.vibrationOffset.y * 1.2;
          eyeLocal.x += this.vibrationOffset.x * 1.2;
        }
        const eyeWorld = eyeLocal.applyMatrix4(aircraftMesh.matrixWorld);

        const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuat);
        this.camera.up.copy(upWorld);

        // Dynamic touchdown shock jolt on belly camera
        if (Math.abs(this.touchJoltOffset) > 0.0005) {
          eyeWorld.addScaledVector(upWorld, this.touchJoltOffset * 1.6);
        }

        this.camera.position.copy(eyeWorld);

        const targetLocal = this.gearLookTarget.clone();
        targetLocal.x += this.gearLookYaw * 3.0;
        targetLocal.y += this.gearLookPitch * 3.0;
        const targetWorld = targetLocal.applyMatrix4(aircraftMesh.matrixWorld);
        this.camera.lookAt(targetWorld);
        break;
      }

      case CameraSystem.MODES.DRONE: {
        // Continuous 360° circular drone orbit around aircraft from slightly above (pauses when user overrides look)
        if (!this.userLookOverridden && !this.autoPaused) {
          this.droneOrbitAngle += this.droneOrbitSpeed * dt;
        }

        // Subtle organic drone hovering bob motion
        const hoverBob = Math.sin(this.droneOrbitAngle * 2.2) * 0.55;
        const currentHeight = planePos.y + this.droneHeight + hoverBob;
        const targetX = planePos.x + Math.sin(this.droneOrbitAngle) * this.droneDistance;
        const targetZ = planePos.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;

        const targetPos = new THREE.Vector3(targetX, currentHeight, targetZ);
        targetPos.y = Math.max(targetPos.y, this.queryGroundHeight(targetX, targetZ) + 2.5);
        if (!this.droneInitialized) {
          this.dronePos.copy(targetPos);
          this.droneInitialized = true;
        } else {
          // Smooth position interpolation to prevent abrupt jumps
          this.dronePos.lerp(targetPos, 1 - Math.exp(-Math.max(0, dt) * 8.5));
        }
        this.camera.position.copy(this.dronePos);

        this.camera.up.set(0, 1, 0);
        const lookTarget = planePos.clone().add(this.droneLookOffset);
        this.camera.lookAt(lookTarget);
        break;
      }
      case CameraSystem.MODES.DIRECTOR: {
        this.cinematicDirector.setTerrainQuery((x, z) => this.queryGroundHeight(x, z));
        const combat = this.combatStateProvider ? this.combatStateProvider() : null;
        const clockDt = Number.isFinite(combat?.timeScale) ? dt * combat.timeScale : dt;
        this.cinematicDirector.update({
          dt,
          clockDt,
          camera: this.camera,
          planePos,
          planeQuat,
          aircraftMesh,
          flightState,
          queryGroundHeight: (x, z) => this.queryGroundHeight(x, z),
          missiles: combat?.missiles ?? [],
          targets: combat?.targets ?? [],
        });
        break;
      }
    }

    // Apply catastrophic impact / explosion camera trauma shake
    if (this.trauma > 0) {
      this.trauma = Math.max(0.0, this.trauma - dt * 0.55);
      const shakePower = Math.pow(this.trauma, 2.0);
      const shakeOffset = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2 * shakePower,
        (Math.random() - 0.5) * 2.5 * shakePower,
        (Math.random() - 0.5) * 3.2 * shakePower
      );
      this.camera.position.add(shakeOffset);
    }

    // Reset per-frame hat look flag so release can resume gentle POV decay
    this.isHatLooking = false;
  }

  addTrauma(amount = 1.0) {
    this.trauma = Math.min(1.0, (this.trauma || 0) + amount);
  }
}
