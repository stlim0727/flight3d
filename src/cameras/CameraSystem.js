import * as THREE from 'three';

/**
 * 6-Perspective Camera System (Cockpit, Chase, Wing View, Control Tower, Flyby, Landing Gear Belly Cam)
 * Features G-force cockpit head dynamics, stall buffeting vibration, touchdown shock jolt,
 * smooth exterior damping, and automatic temporary cinematic view cuts for takeoff/landing/gear transit.
 */
export class CameraSystem {
  static MODES = {
    COCKPIT: 0,
    CHASE: 1,
    WING: 2,
    TOWER: 3,
    FLYBY: 4,
    GEAR: 5,
    DRONE: 6,
    AUTO: 7
  };

  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = CameraSystem.MODES.COCKPIT;
    this.autoSwitch = false;
    // Explicit view choices persist across demo stages, presets and look resets.
    this.userModeSelected = false;
    this.autoSwitchTimer = 0;

    // Temporary Cinematic View Cut State (e.g. brief gear cam preview during takeoff, landing, gear transit)
    this.temporaryViewTimer = 0;
    this.savedMode = null;
    this.onTemporaryViewComplete = null;

    // Cockpit Head Dynamics & Look-Around
    this.photoCockpit = false; // Default to high-fidelity 3D Virtual Cockpit with GLTF asset
    this.cockpitHeadOffset = new THREE.Vector3(-0.39, 0.85, -12.35); // Captain eye
    this.headGForceOffset = new THREE.Vector3();
    this.touchJoltOffset = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.25; // Natural pilot head tilt showing MCP, instruments & runway horizon

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

    // Flyby Camera State
    this.flybyPos = new THREE.Vector3();
    this.flybySet = false;
    this.flybyRegime = null;
    this.getTerrainHeight = null;

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

    // User manual look override flag (유저가 시선을 수동 변경한 경우 카메라 모드 전환 전까지 앱 자동 시선 개입 차단)
    this.userLookOverridden = false;

    // Continuous Edge Pan / Edge Look state (화면 끝 도달 시 시선 지속 회전)
    this.enableEdgePan = false; // Grab gestures stop when the pointer/finger stops.
    this.edgePanMargin = 30; // Threshold distance in pixels from screen boundary
    this.edgePanSpeedX = 280; // Virtual px/s equivalent for horizontal pan (~0.98 rad/s in cockpit, ~1.4 rad/s in chase)
    this.edgePanSpeedY = 220; // Virtual px/s equivalent for vertical tilt (~0.77 rad/s)

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
      '.flight-panel, .flight-toolbar, button, a, input, select, .btn, .modal-card, .presets-bar, .action-panel, .mobile-menu, .hud-strip, #demo-banner, .toast, .stall-banner, .crash-overlay, .touch-quadrant, .touch-card-header, .touch-throttle-card, .touch-stick-card, .touch-rudder-card, .btn-touch-pill, .btn-touch-brake, .demo-pill-btn, #help-modal, #diagnostics-overlay, .menu-backdrop'
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
        if (this.mode === CameraSystem.MODES.CHASE) {
          this.chaseDistance = Math.max(20.0, Math.min(140.0, this.chaseDistance + e.deltaY * 0.05));
          this.userLookOverridden = true;
          this.cancelTemporaryView();
        } else if (this.mode === CameraSystem.MODES.DRONE) {
          this.droneDistance = Math.max(16.0, Math.min(85.0, this.droneDistance + e.deltaY * 0.04));
          this.userLookOverridden = true;
          this.cancelTemporaryView();
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

          if (this.pointerLocked) this.applyMouseDelta(dx, dy);
          else this.applyDragDelta(dx, dy);
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

        this.applyDragDelta(dx, dy);
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
   * Apply two-finger pinch zoom to camera distance
   */
  applyPinchZoom(deltaDist) {
    if (Math.abs(deltaDist) > 0) {
      this.userLookOverridden = true;
      this.cancelTemporaryView();
    }
    if (this.mode === CameraSystem.MODES.CHASE) {
      this.chaseDistance = Math.max(20.0, Math.min(140.0, this.chaseDistance - deltaDist * 0.15));
    } else if (this.mode === CameraSystem.MODES.DRONE) {
      this.droneDistance = Math.max(16.0, Math.min(85.0, this.droneDistance - deltaDist * 0.12));
    }
  }

  // Grab the scenery: mouse and touch move it with the gesture. Pointer lock
  // retains directional head movement through applyMouseDelta.
  applyDragDelta(dx, dy) {
    // Gear yaw offsets the look target along +X, unlike the head/orbit yaw
    // rotations. Its original horizontal mapping already grabs the scenery.
    const lookDx = this.mode === CameraSystem.MODES.GEAR ? dx : -dx;
    this.applyMouseDelta(lookDx, -dy);
  }

  applyMouseDelta(dx, dy) {
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      this.userLookOverridden = true;
      this.cancelTemporaryView();
    }
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        this.lookYaw -= dx * 0.0035;
        this.lookPitch -= dy * 0.0035;
        this.lookPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.lookPitch));
        break;
      }
      case CameraSystem.MODES.CHASE: {
        this.chaseYaw -= dx * 0.005;
        this.chasePitch += dy * 0.005; // Drag down = lower camera / look up; drag up = raise camera / look down
        this.chasePitch = Math.max(-1.1, Math.min(0.28, this.chasePitch));
        break;
      }
      case CameraSystem.MODES.WING: {
        this.wingLookYaw -= dx * 0.0035;
        this.wingLookPitch -= dy * 0.0035;
        this.wingLookPitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, this.wingLookPitch));
        this.wingLookYaw = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, this.wingLookYaw));
        break;
      }
      case CameraSystem.MODES.DRONE: {
        this.droneOrbitAngle -= dx * 0.005;
        this.droneHeight = Math.max(4.0, Math.min(32.0, this.droneHeight + dy * 0.05));
        break;
      }
      case CameraSystem.MODES.GEAR: {
        this.gearLookYaw -= dx * 0.0035;
        this.gearLookPitch -= dy * 0.0035;
        this.gearLookPitch = Math.max(-0.6, Math.min(0.6, this.gearLookPitch));
        this.gearLookYaw = Math.max(-0.8, Math.min(0.8, this.gearLookYaw));
        break;
      }
    }
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

  resetLook() {
    this.userLookOverridden = false;
    this.lookYaw = 0;
    this.lookPitch = -0.25;
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.chaseDistance = 55.0;
    this.chaseHeight = 10.5;
    this.wingLookYaw = 0;
    this.wingLookPitch = 0;
    this.gearLookYaw = 0;
    this.gearLookPitch = 0;
    this.targetCursorNormX = 0;
    this.targetCursorNormY = 0;
    this.cursorNormX = 0;
    this.cursorNormY = 0;
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
    return Math.abs(this.lookYaw) > 0.38 || Math.abs(this.lookPitch - (-0.25)) > 0.42;
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

  setTerrain(terrain) {
    if (typeof terrain === 'function') {
      this.getTerrainHeight = terrain;
    } else if (terrain && typeof terrain.getHeight === 'function') {
      this.getTerrainHeight = (x, z) => terrain.getHeight(x, z);
    }
  }

  queryGroundHeight(x, z) {
    if (this.getTerrainHeight) {
      try {
        const h = this.getTerrainHeight(x, z);
        if (typeof h === 'number' && !Number.isNaN(h)) return h;
      } catch (e) {}
    }
    return 12.0; // RKSS airport elevation default fallback
  }
  snapToTarget(aircraftMesh) {
    const behindLocal = new THREE.Vector3(0, this.chaseHeight, this.chaseDistance);
    behindLocal.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.chasePitch);
    behindLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.chaseYaw);
    this.chasePos.copy(behindLocal.applyMatrix4(aircraftMesh.matrixWorld));
    this.chaseTarget.copy(aircraftMesh.position);
    this.chaseTargetInitialized = true;

    if (this.mode === CameraSystem.MODES.COCKPIT) {
      const eyeLocal = this.cockpitHeadOffset.clone();
      if (this.camera && this.camera.aspect < 1.0) {
        eyeLocal.x = -0.34;
        eyeLocal.y += 0.03;
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
      const py = Math.max(aircraftMesh.position.y + 1.5, aircraftMesh.position.y + this.droneHeight);
      const pz = aircraftMesh.position.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;
      this.dronePos.set(px, py, pz);
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
    } else {
      this.camera.position.copy(this.chasePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(aircraftMesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    }
  }

  showTemporaryView(m, durationSeconds = 4.5, onComplete = null) {
    if (this.userLookOverridden || (this.userModeSelected && !this.autoSwitch)) {
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
    const selected = this.autoSwitch ? CameraSystem.MODES.AUTO : (this.savedMode ?? this.mode);
    this.setMode((selected + 1) % 8, true);
    if (this.onCycleMode) {
      this.onCycleMode(this.mode);
    }
    return this.getModeName();
  }

  setMode(m, isUserAction = false) {
    if ((this.userLookOverridden || this.userModeSelected) && !isUserAction) {
      return false;
    }
    if (isUserAction) this.userModeSelected = true;
    return this.#applyMode(m);
  }

  #applyMode(m) {
    this.userLookOverridden = false;
    this.cancelTemporaryView();
    this.autoSwitch = m === CameraSystem.MODES.AUTO;
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
    return true;
  }

  toggleCockpitPhoto() {
    this.photoCockpit = !this.photoCockpit;
    return this.photoCockpit;
  }

  setCockpitPhoto(enabled) {
    this.photoCockpit = !!enabled;
  }

  getCockpitSubmodeName() {
    return this.photoCockpit ? 'PHOTO 2D' : '3D VIRTUAL';
  }

  getModeName() {
    const name = this.getViewName();
    return this.autoSwitch ? `AUTO · ${name}` : name;
  }

  getViewName() {
    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: return 'COCKPIT (CAPTAIN)';
      case CameraSystem.MODES.CHASE: return 'CHASE (EXTERIOR)';
      case CameraSystem.MODES.WING: return 'WING VIEW';
      case CameraSystem.MODES.TOWER: return 'AIRPORT TOWER';
      case CameraSystem.MODES.FLYBY: return 'CINEMATIC FLYBY';
      case CameraSystem.MODES.GEAR: return 'GEAR CAM (BELLY)';
      case CameraSystem.MODES.DRONE: return 'DRONE (ORBIT VIEW)';
      default: return 'CAMERA';
    }
  }

  update(dt, aircraftMesh, flightState = {}, getTerrainHeight = null) {
    if (getTerrainHeight) {
      this.setTerrain(getTerrainHeight);
    }
    if (this.autoSwitch && !this.userLookOverridden && this.temporaryViewTimer <= 0) {
      this.autoSwitchTimer += Math.max(0, dt);
      if (this.autoSwitchTimer >= 10) {
        this.#applyMode((this.mode + 1) % 7);
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

    switch (this.mode) {
      case CameraSystem.MODES.COCKPIT: {
        // First-Person Cockpit View
        // 1. Calculate head displacement from G-forces & buffeting
        // On ground, ignore landing gear suspension spring oscillation to prevent instrument jitter
        const gForce = flightState.onGround ? 1.0 : (flightState.gForce || 1.0);
        const targetGOffset = Math.max(-0.02, Math.min(0.02, -(gForce - 1.0) * 0.015));
        this.headGForceOffset.y += (targetGOffset - this.headGForceOffset.y) * Math.min(1.0, dt * 4.0);

        // Stall Buffeting Shake (airborne only, restrained amplitude)
        let buffetX = 0, buffetY = 0;
        if (flightState.isStalled && !flightState.onGround) {
          const t = performance.now() * 0.03;
          const severity = flightState.buffetVibration || 0.5;
          buffetX = (Math.sin(t * 1.7) + Math.cos(t * 3.1)) * 0.005 * severity;
          buffetY = (Math.cos(t * 2.3) + Math.sin(t * 4.2)) * 0.005 * severity;
        }

        const eyeLocal = this.cockpitHeadOffset.clone();
        if (this.camera && this.camera.aspect < 1.0) {
          eyeLocal.x = -0.34;
          eyeLocal.y += 0.03;
        }
        if (this.photoCockpit) {
          eyeLocal.set(-0.48, 0.88, -12.02);
        }
        eyeLocal.y += this.headGForceOffset.y + buffetY + this.touchJoltOffset;
        eyeLocal.x += buffetX;

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
        const basePitch = (this.photoCockpit && !this.isLookingAwayFromCenter()) ? (this.lookPitch * 0.2 - 0.04) : this.lookPitch;
        const effectivePitch = basePitch + cursorPitch;

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
        const cursorChasePitch = this.enableCursorTrack ? (this.cursorNormY * 0.12) : 0;

        const totalYaw = this.chaseYaw + cursorChaseYaw;
        const totalPitch = Math.max(-1.1, Math.min(0.28, this.chasePitch + cursorChasePitch));

        const behindLocal = new THREE.Vector3(0, this.chaseHeight, this.chaseDistance);
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

        const lookTarget = planePos.clone().add(new THREE.Vector3(0, 1.5, 0));
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(lookTarget);
        break;
      }

      case CameraSystem.MODES.WING: {
        // Passenger Window View (Overlooking Left Wing & Engine)
        const windowLocal = new THREE.Vector3(-1.82, 0.45, 2.2);
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
        if (!this.userLookOverridden) {
          this.droneOrbitAngle += this.droneOrbitSpeed * dt;
        }

        // Subtle organic drone hovering bob motion
        const hoverBob = Math.sin(this.droneOrbitAngle * 2.2) * 0.55;
        const currentHeight = Math.max(planePos.y + 2.0, planePos.y + this.droneHeight + hoverBob);
        const targetX = planePos.x + Math.sin(this.droneOrbitAngle) * this.droneDistance;
        const targetZ = planePos.z + Math.cos(this.droneOrbitAngle) * this.droneDistance;

        const targetPos = new THREE.Vector3(targetX, currentHeight, targetZ);
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
  }

  addTrauma(amount = 1.0) {
    this.trauma = Math.min(1.0, (this.trauma || 0) + amount);
  }
}
