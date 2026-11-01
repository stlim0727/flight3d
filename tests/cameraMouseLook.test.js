import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

describe('CameraSystem Mouse Look & Camera Gaze Controls', () => {
  const mockDom = {
    addEventListener: () => {},
    style: {}
  };

  it('grabs scenery only while dragging, stops at edges and release, and preserves pointer-lock direction', () => {
    const previousWindow = globalThis.window;
    const listeners = new Map();
    const domListeners = new Map();
    globalThis.window = {
      innerWidth: 1200, innerHeight: 800,
      addEventListener: (name, fn) => listeners.set(name, fn)
    };
    try {
      const dom = { style: {}, addEventListener: (name, fn) => domListeners.set(name, fn) };
      const cam = new CameraSystem(new THREE.PerspectiveCamera(), dom);
      cam.setMode(CameraSystem.MODES.COCKPIT, true);
      const aircraft = new THREE.Object3D();
      const move = (x, y) => listeners.get('mousemove')({ clientX: x, clientY: y });
      move(600, 400);
      cam.update(0.1, aircraft);
      assert.equal(cam.lookYaw, 0, 'ordinary hover must not rotate the view');
      assert.equal(Math.abs(cam.camera.getWorldDirection(new THREE.Vector3()).x), 0, 'hover has no rendered yaw offset');
      const ui = { closest: () => ({}) };
      domListeners.get('mousedown')({ button: 0, clientX: 600, clientY: 400, target: ui });
      move(650, 400);
      assert.equal(cam.lookYaw, 0, 'UI cannot start dragging');
      domListeners.get('mousedown')({ button: 0, clientX: 600, clientY: 400, target: dom });
      move(700, 480);
      assert.ok(cam.lookYaw > 0, 'right drag moves scenery right');
      assert.ok(cam.lookPitch > -0.25, 'down drag moves scenery down');
      move(1200, 800);
      const held = [cam.lookYaw, cam.lookPitch];
      cam.update(0.1, aircraft);
      cam.update(0.1, aircraft);
      assert.deepEqual([cam.lookYaw, cam.lookPitch], held, 'stationary edge hold cannot keep panning');
      listeners.get('mouseup')();
      move(500, 400);
      assert.deepEqual([cam.lookYaw, cam.lookPitch], held, 'release retains orientation');
      cam.resetLook();
      cam.pointerLocked = true;
      listeners.get('mousemove')({ clientX: 500, clientY: 400, movementX: 100, movementY: 80 });
      assert.ok(cam.lookYaw < 0, 'pointer lock still looks toward mouse movement');
      assert.ok(cam.lookPitch < -0.25);
      cam.pointerLocked = false;
      domListeners.get('mousedown')({ button: 2, clientX: 500, clientY: 400, target: dom });
      listeners.get('blur')();
      const blurred = cam.lookYaw;
      move(800, 400);
      assert.equal(cam.lookYaw, blurred, 'blur cancels dragging');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  for (const input of ['mouse', 'touch']) {
    for (const direction of [-1, 1]) {
      it(`gear scenery follows ${input} dragging ${direction > 0 ? 'right/down' : 'left/up'} on screen`, () => {
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 1000);
        const cam = new CameraSystem(camera, mockDom);
        const aircraft = new THREE.Object3D();
        aircraft.updateMatrixWorld(true);
        cam.setMode(CameraSystem.MODES.GEAR, true);
        const point = cam.gearLookTarget.clone();
        const project = () => {
          cam.update(0.016, aircraft, { onGround: true });
          camera.updateMatrixWorld(true);
          return point.clone().project(camera);
        };
        const before = project();
        if (input === 'mouse') {
          cam.applyDragDelta(direction * 40, direction * 30);
        } else {
          const target = { closest: () => null };
          cam.handleTouchStart({ touches: [{ identifier: 1, clientX: 600, clientY: 400, target }] });
          cam.handleTouchMove({ touches: [{ identifier: 1, clientX: 600 + direction * 40, clientY: 400 + direction * 30, target }] });
          cam.handleTouchEnd({ touches: [] });
        }
        const after = project();
        assert.ok((after.x - before.x) * direction > 0, 'scenery follows horizontal drag on screen');
        assert.ok((after.y - before.y) * direction < 0, 'scenery follows vertical drag (screen down is negative NDC Y)');
        assert.equal(cam.isDragging, false);
      });
    }
  }

  it('should initialize default mouse look parameters and states', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);

    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);
    assert.strictEqual(camSys.chaseDistance, 55.0);
    assert.strictEqual(camSys.lookYaw, 0);
    assert.strictEqual(camSys.lookPitch, -0.25);
    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);
    assert.strictEqual(camSys.isDragging, false);
    assert.strictEqual(camSys.pointerLocked, false);
    assert.strictEqual(camSys.enableCursorTrack, false);
    assert.strictEqual(camSys.mode, CameraSystem.MODES.CHASE,
      'The opening view is exterior while the cockpit interior GLB streams in');
    assert.strictEqual(camera.near, 0.25, 'Exterior default should configure near clipping plane to 0.25m');

    camSys.setMode(CameraSystem.MODES.COCKPIT, true);
    assert.strictEqual(camera.near, 0.08, 'Cockpit mode should configure near clipping plane to 0.08m');
  });

  it('should update chase orbit angles and clamp pitch on mouse delta in CHASE mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);
    assert.strictEqual(camera.near, 0.25, 'CHASE mode should configure near clipping plane to 0.25m');

    // Initial angles are zero
    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);

    // Drag right (dx = 100) -> chaseYaw decreases
    camSys.applyMouseDelta(100, 0);
    assert.ok(camSys.chaseYaw < 0, `chaseYaw (${camSys.chaseYaw}) should be negative after dragging right`);

    // Drag left (dx = -200) -> chaseYaw increases
    camSys.applyMouseDelta(-200, 0);
    assert.ok(camSys.chaseYaw > 0, `chaseYaw (${camSys.chaseYaw}) should be positive after dragging left`);

    // Pointer lock is directional aim, so pushing the mouse down (dy = 500)
    // pitches the gaze down: the orbit climbs toward the aircraft and rests on
    // the high-side clamp. Pulling it up drops the orbit to the low-side clamp.
    camSys.applyMouseDelta(0, 500);
    assert.ok(camSys.chasePitch <= -1.1 + 1e-9, `chasePitch (${camSys.chasePitch}) should reach the -1.1 aiming-down clamp`);

    camSys.chasePitch = 0;
    camSys.applyMouseDelta(0, -500);
    assert.ok(camSys.chasePitch >= 0.28 - 1e-9, `chasePitch (${camSys.chasePitch}) should reach the 0.28 aiming-up clamp`);
  });

  it('should lift the chase gaze on a down drag so the exterior orbit grabs scenery like the head views', () => {
    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 60, 0);
    aircraft.updateMatrixWorld(true);

    // Rendered gaze, not the state variable: chase pitch is an orbit height whose
    // sign is the mirror of a head rotation, so only the view direction compares.
    const gazeShift = (mode, gesture) => {
      const camera = new THREE.PerspectiveCamera(60, 16 / 9);
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(mode, true);
      camSys.snapToTarget(aircraft);
      const before = camSys.camera.getWorldDirection(new THREE.Vector3()).y;
      gesture(camSys);
      camSys.snapToTarget(aircraft);
      return camSys.camera.getWorldDirection(new THREE.Vector3()).y - before;
    };

    const downDrag = (camSys) => camSys.applyDragDelta(0, 120);   // clientY grows
    const downLock = (camSys) => camSys.applyMouseDelta(0, 120);  // movementY grows

    assert.ok(gazeShift(CameraSystem.MODES.COCKPIT, downDrag) > 0, 'a down drag lifts the cockpit gaze');
    assert.ok(gazeShift(CameraSystem.MODES.CHASE, downDrag) > 0, 'a down drag lifts the chase gaze');
    assert.ok(gazeShift(CameraSystem.MODES.COCKPIT, downLock) < 0, 'pointer lock down drops the cockpit gaze');
    assert.ok(gazeShift(CameraSystem.MODES.CHASE, downLock) < 0, 'pointer lock down drops the chase gaze');
  });

  it('should turn the head at about the pointer rate instead of outrunning it', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT, true);

    // A thousand pixels of travel is roughly a window width. The previous
    // 0.0035 rad/px gain swept the whole ±81° look limit within 400px and
    // saturated here; a grab should still be following the pointer at this far.
    camSys.applyDragDelta(1000, 0);
    assert.ok(Math.abs(camSys.lookYaw) < Math.PI * 0.45 - 1e-9,
      `lookYaw (${camSys.lookYaw}) should not saturate after a window-width drag`);
    assert.ok(Math.abs(camSys.lookYaw) > 1.0,
      `lookYaw (${camSys.lookYaw}) should still turn a useful amount`);

    camSys.setMode(CameraSystem.MODES.WING, true);
    camSys.applyDragDelta(1000, 0);
    assert.ok(Math.abs(camSys.wingLookYaw) < Math.PI * 0.55 - 1e-9,
      `wingLookYaw (${camSys.wingLookYaw}) shares the gentler gain`);
  });

  it('should orbit camera around aircraft position in CHASE mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 50, 0);
    aircraft.updateMatrixWorld(true);

    // Snap and update directly behind (chaseYaw = 0)
    camSys.snapToTarget(aircraft);
    camSys.update(0.016, aircraft, { onGround: false });

    // Initial behind position: Z should be positive (behind tail), X approx 0
    assert.ok(camera.position.z > 30, `Camera Z should be behind aircraft`);
    assert.ok(Math.abs(camera.position.x) < 2.0, `Camera X should be centered`);

    // Orbit 90 degrees to right side (yaw = Math.PI / 2)
    camSys.chaseYaw = Math.PI / 2;
    camSys.snapToTarget(aircraft);
    camSys.update(0.016, aircraft, { onGround: false });

    // With chaseYaw = Math.PI / 2, camera should orbit to positive X side
    assert.ok(camera.position.x > 30, `Camera X (${camera.position.x}) should be positive on right side orbit`);
  });

  it('should update cockpit look yaw and pitch with limits in COCKPIT mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT);

    // Drag left (dx = -100) -> lookYaw increases
    camSys.applyMouseDelta(-100, 0);
    assert.ok(camSys.lookYaw > 0, 'lookYaw should turn left');

    // Drag up/down pitch clamping
    camSys.applyMouseDelta(0, -1000);
    assert.ok(camSys.lookPitch <= Math.PI * 0.45, 'lookPitch should be clamped to upper limit');

    camSys.applyMouseDelta(0, 2000);
    assert.ok(camSys.lookPitch >= -Math.PI * 0.45, 'lookPitch should be clamped to lower limit');
  });

  it('should detect when pilot is looking away from forward panel', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT);

    // At default look (-0.18 pitch, 0 yaw), pilot is looking straight forward
    assert.strictEqual(camSys.isLookingAwayFromCenter(), false);

    // Turn head to the left window (yaw = 0.8 rad)
    camSys.lookYaw = 0.8;
    assert.strictEqual(camSys.isLookingAwayFromCenter(), true);

    // Reset back to center
    camSys.resetLook();
    assert.strictEqual(camSys.isLookingAwayFromCenter(), false);

    // Tilt head up at overhead panel
    camSys.lookPitch = 0.5;
    assert.strictEqual(camSys.isLookingAwayFromCenter(), true);
  });

  it('should adapt cockpit eye offset when in portrait mode (aspect < 1.0)', () => {
    const portraitCamera = new THREE.PerspectiveCamera(60, 390 / 844, 0.08, 1000);
    const camSys = new CameraSystem(portraitCamera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 50, 0);
    aircraft.updateMatrixWorld(true);

    camSys.snapToTarget(aircraft);
    camSys.update(0.016, aircraft, { onGround: false });

    // In portrait mode, eyeLocal.x is shifted to -0.34 and y to 0.88 to center windshield
    assert.strictEqual(portraitCamera.position.x, -0.34);
    assert.strictEqual(Math.round(portraitCamera.position.y * 100) / 100, 50.88);
  });

  it('should update wing view look angles on mouse delta in WING mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.WING);

    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);

    camSys.applyMouseDelta(50, -30);
    assert.ok(camSys.wingLookYaw < 0, 'wingLookYaw should adjust on horizontal drag');
    assert.ok(camSys.wingLookPitch > 0, 'wingLookPitch should adjust on vertical drag');
  });

  it('should smoothly interpolate cursor position tracking on mouse move', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 100, 0);
    aircraft.updateMatrixWorld(true);

    // Cursor on far right (clientX = 1920, screen width = 1920)
    camSys.setCursorPosition(1920, 540, 1920, 1080);
    assert.ok(camSys.targetCursorNormX > 0.9, 'targetCursorNormX should be near 1.0');

    camSys.enableCursorTrack = true;
    // Run frame update to interpolate
    camSys.update(0.05, aircraft, { onGround: false });
    assert.ok(camSys.cursorNormX > 0, 'cursorNormX should smoothly advance towards target');
  });

  it('should reset all camera look angles and zoom to default with resetLook()', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);

    // Mutate various look parameters
    camSys.chaseYaw = 1.2;
    camSys.chasePitch = -0.5;
    camSys.chaseDistance = 90.0;
    camSys.lookYaw = 0.7;
    camSys.lookPitch = 0.3;
    camSys.wingLookYaw = -0.4;
    camSys.wingLookPitch = 0.2;
    camSys.gearLookYaw = 0.3;
    camSys.gearLookPitch = -0.2;
    camSys.cursorNormX = 0.8;
    camSys.targetCursorNormX = 0.8;

    // Reset look
    camSys.resetLook();

    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);
    assert.strictEqual(camSys.chaseDistance, 55.0);
    assert.strictEqual(camSys.lookYaw, 0);
    assert.strictEqual(camSys.lookPitch, -0.25);
    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);
    assert.strictEqual(camSys.gearLookYaw, 0);
    assert.strictEqual(camSys.gearLookPitch, 0);
    assert.strictEqual(camSys.cursorNormX, 0);
    assert.strictEqual(camSys.targetCursorNormX, 0);
  });

  describe('Continuous Edge Pan (화면 끝 도달 시 시선 지속 회전)', () => {
    it('should initialize default edge pan properties', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);

      assert.strictEqual(camSys.enableEdgePan, false);
      assert.strictEqual(camSys.edgePanMargin, 30);
      assert.strictEqual(camSys.edgePanSpeedX, 280);
      assert.strictEqual(camSys.edgePanSpeedY, 220);
    });

    it('should continuously rotate cockpit view to the right when mouse is held at the right edge during drag', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 1920, y: 540 }; // Exactly at right edge (1920x1080)
      const initialYaw = camSys.lookYaw;

      // Update 1 frame at 60 FPS (dt = 0.016s)
      camSys.updateEdgePan(0.016, 1920, 1080);

      // In cockpit mode, dragging/moving right decreases lookYaw (turns head right)
      assert.ok(camSys.lookYaw < initialYaw, `lookYaw (${camSys.lookYaw}) should decrease to turn right at right edge`);

      // Multiple frames should continuously advance yaw
      const prevYaw = camSys.lookYaw;
      camSys.updateEdgePan(0.016, 1920, 1080);
      assert.ok(camSys.lookYaw < prevYaw, `lookYaw (${camSys.lookYaw}) should continuously decrease across frames`);
    });

    it('should continuously rotate cockpit view to the left when mouse is held at the left edge during drag', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 0, y: 540 }; // Exactly at left edge
      const initialYaw = camSys.lookYaw;

      camSys.updateEdgePan(0.016, 1920, 1080);

      // Moving left increases lookYaw (turns head left)
      assert.ok(camSys.lookYaw > initialYaw, `lookYaw (${camSys.lookYaw}) should increase to turn left at left edge`);
    });

    it('should continuously pitch cockpit view up/down at top/bottom edges and respect pitch limits', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 960, y: 0 }; // Top edge -> pitch up
      const initialPitch = camSys.lookPitch;

      camSys.updateEdgePan(0.016, 1920, 1080);
      assert.ok(camSys.lookPitch > initialPitch, 'lookPitch should increase (tilt up) at top edge');

      // Continuous pitch up should clamp at upper limit (Math.PI * 0.45)
      for (let i = 0; i < 300; i++) {
        camSys.updateEdgePan(0.05, 1920, 1080);
      }
      assert.ok(camSys.lookPitch <= Math.PI * 0.45 + 0.0001, 'lookPitch should respect upper clamp');

      // Bottom edge -> pitch down
      camSys.prevMouse = { x: 960, y: 1080 };
      for (let i = 0; i < 300; i++) {
        camSys.updateEdgePan(0.05, 1920, 1080);
      }
      assert.ok(camSys.lookPitch >= -Math.PI * 0.45 - 0.0001, 'lookPitch should respect lower clamp');
    });

    it('should continuously orbit chase camera in CHASE mode at screen edge', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.CHASE);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 1920, y: 540 }; // Right edge
      const initialChaseYaw = camSys.chaseYaw;

      camSys.updateEdgePan(0.016, 1920, 1080);
      assert.ok(camSys.chaseYaw < initialChaseYaw, 'chaseYaw should rotate around aircraft at right edge');
    });

    it('should NOT trigger edge pan when isDragging is false', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.isDragging = false;
      camSys.prevMouse = { x: 1920, y: 540 }; // At right edge, but not dragging
      const initialYaw = camSys.lookYaw;

      camSys.updateEdgePan(0.05, 1920, 1080);
      assert.strictEqual(camSys.lookYaw, initialYaw, 'lookYaw must not change when isDragging is false');
    });

    it('should NOT trigger edge pan when pointerLocked is true', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.pointerLocked = true;
      camSys.prevMouse = { x: 1920, y: 540 };
      const initialYaw = camSys.lookYaw;

      camSys.updateEdgePan(0.05, 1920, 1080);
      assert.strictEqual(camSys.lookYaw, initialYaw, 'lookYaw must not change when pointerLocked is true');
    });

    it('should NOT trigger edge pan when mouse is inside screen away from edge margin', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 960, y: 540 }; // Center of 1920x1080 screen
      const initialYaw = camSys.lookYaw;

      camSys.updateEdgePan(0.05, 1920, 1080);
      assert.strictEqual(camSys.lookYaw, initialYaw, 'lookYaw must not change when cursor is away from edges');
    });

    it('should integrate edge pan into CameraSystem.update() frame loop', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 50, 0);
      aircraft.updateMatrixWorld(true);

      camSys.enableEdgePan = true; // Legacy opt-in only.
      camSys.isDragging = true;
      camSys.prevMouse = { x: 1920, y: 540 };
      const initialYaw = camSys.lookYaw;

      camSys.update(0.016, aircraft, { onGround: false });
      assert.ok(camSys.lookYaw < initialYaw, 'update() should execute edge pan when dragging at edge');
    });
  });

  describe('Mobile Touch Drag Look & Gestures (모바일 터치 시선 변경)', () => {
    it('should initialize mobile touch state variables', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);

      assert.strictEqual(camSys.activeTouchId, null);
      assert.strictEqual(camSys.isPinching, false);
      assert.strictEqual(camSys.pinchDistance, 0);
      assert.strictEqual(camSys.lastTapTime, 0);
      assert.strictEqual(camSys.isDragging, false);
    });

    it('should turn the head faster on touch drag than mouse drag to compensate for mobile swipe travel', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT, true);

      // Mouse drag of 120px uses desktop pixels-per-radian gain (0.0011 rad/px)
      camSys.applyDragDelta(120, 0, false);
      const mouseYaw = Math.abs(camSys.lookYaw);
      assert.ok(Math.abs(mouseYaw - 120 * 0.0011) < 1e-6, `mouseYaw (${mouseYaw}) matches 0.0011 rad/px`);
      const mouseDeg = mouseYaw * 180 / Math.PI;
      assert.ok(mouseDeg < 10, `mouse drag sweeps under 10° (${mouseDeg.toFixed(1)}°) for 120px`);

      camSys.resetLook();

      // Touch drag of 120px via touch event uses touchGazeSensitivity (0.0035 rad/px)
      const canvasTarget = { closest: () => null };
      camSys.handleTouchStart({
        touches: [{ identifier: 77, clientX: 200, clientY: 200, target: canvasTarget }]
      });
      camSys.handleTouchMove({
        touches: [{ identifier: 77, clientX: 320, clientY: 200, target: canvasTarget }]
      });
      camSys.handleTouchEnd({ touches: [] });

      const touchYaw = Math.abs(camSys.lookYaw);
      assert.ok(Math.abs(touchYaw - 120 * 0.0035) < 1e-6, `touchYaw (${touchYaw}) matches 0.0035 rad/px`);
      const touchDeg = touchYaw * 180 / Math.PI;
      assert.ok(touchDeg > 20, `touch swipe sweeps ~24° (${touchDeg.toFixed(1)}°) for 120px`);
      assert.ok(touchYaw > mouseYaw * 3.0, 'touch look gain is >3x desktop mouse gain');
    });

    it('should rotate cockpit gaze (yaw and pitch) on single-finger touch drag', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      const canvasTarget = { closest: () => null };

      // Touch down at (500, 300)
      camSys.handleTouchStart({
        touches: [{ identifier: 101, clientX: 500, clientY: 300, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.strictEqual(camSys.activeTouchId, 101);
      assert.strictEqual(camSys.isDragging, true);
      assert.strictEqual(camSys.prevMouse.x, 500);
      assert.strictEqual(camSys.prevMouse.y, 300);

      const initialYaw = camSys.lookYaw;
      const initialPitch = camSys.lookPitch;

      // Drag right by 100px, drag down by 80px (clientX: 600, clientY: 380)
      camSys.handleTouchMove({
        touches: [{ identifier: 101, clientX: 600, clientY: 380, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.ok(camSys.lookYaw > initialYaw, 'lookYaw should increase (grab scenery right) on right drag');
      assert.ok(camSys.lookPitch > initialPitch, 'lookPitch should increase (grab scenery down) on downward drag');
      assert.strictEqual(camSys.prevMouse.x, 600);
      assert.strictEqual(camSys.prevMouse.y, 380);

      // Touch end
      camSys.handleTouchEnd({
        touches: [],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.strictEqual(camSys.activeTouchId, null);
      assert.strictEqual(camSys.isDragging, false);
    });

    it('should orbit chase camera in 360° on single-finger touch drag in CHASE mode', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.CHASE);

      const canvasTarget = { closest: () => null };

      // Touch down at (400, 200)
      camSys.handleTouchStart({
        touches: [{ identifier: 202, clientX: 400, clientY: 200, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.strictEqual(camSys.chaseYaw, 0);
      assert.strictEqual(camSys.chasePitch, 0);

      // Grab left by 120px (clientX: 280) -> chaseYaw decreases
      camSys.handleTouchMove({
        touches: [{ identifier: 202, clientX: 280, clientY: 200, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.ok(camSys.chaseYaw < 0, `chaseYaw (${camSys.chaseYaw}) should decrease on dragging left`);

      camSys.handleTouchEnd({ touches: [] });
      assert.strictEqual(camSys.isDragging, false);
    });

    it('should adjust look angles in WING, DRONE, and GEAR modes on touch drag', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      const canvasTarget = { closest: () => null };

      // WING mode
      camSys.setMode(CameraSystem.MODES.WING);
      camSys.handleTouchStart({
        touches: [{ identifier: 301, clientX: 300, clientY: 300, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });
      camSys.handleTouchMove({
        touches: [{ identifier: 301, clientX: 350, clientY: 260, target: canvasTarget }]
      });
      assert.ok(camSys.wingLookYaw > 0, 'wingLookYaw should adjust on touch drag');
      assert.ok(camSys.wingLookPitch < 0, 'wingLookPitch should adjust on touch drag');
      camSys.handleTouchEnd({ touches: [] });

      // DRONE mode
      camSys.setMode(CameraSystem.MODES.DRONE, true);
      const initialDroneAngle = camSys.droneOrbitAngle;
      const initialDroneHeight = camSys.droneHeight;
      camSys.handleTouchStart({
        touches: [{ identifier: 302, clientX: 300, clientY: 300, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });
      camSys.handleTouchMove({
        touches: [{ identifier: 302, clientX: 250, clientY: 340, target: canvasTarget }]
      });
      assert.ok(camSys.droneOrbitAngle < initialDroneAngle, 'droneOrbitAngle should decrease on left touch drag');
      assert.ok(camSys.droneHeight < initialDroneHeight, 'droneHeight should decrease on downward touch drag');
      camSys.handleTouchEnd({ touches: [] });
    });

    it('should ignore touchstart on interactive UI elements and touch flight controls', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      // Mock UI element inside .touch-stick-card
      const stickTarget = {
        closest: (selector) => selector.includes('.touch-stick-card') ? stickTarget : null
      };

      camSys.handleTouchStart({
        touches: [{ identifier: 401, clientX: 800, clientY: 350, target: stickTarget }]
      });

      assert.strictEqual(camSys.activeTouchId, null, 'activeTouchId must remain null when touching stick');
      assert.strictEqual(camSys.isDragging, false, 'isDragging must remain false when touching flight controls');
    });

    it('leaves pilot panel summary taps and content scrolling to the browser', () => {
      const camSys = new CameraSystem(new THREE.PerspectiveCamera(), mockDom);
      for (const surface of ['summary span', 'textarea', 'log pre', 'panel padding']) {
        const target = { closest: selector => selector.includes('#pilot-arena') ? target : null };
        let prevented = false;
        camSys.handleTouchStart({
          touches: [{ identifier: 402, clientX: 300, clientY: 140, target }],
          cancelable: true,
          preventDefault() { prevented = true; },
        });
        assert.equal(prevented, false, `${surface}: native touch activation must remain available`);
        assert.equal(camSys.activeTouchId, null);
        assert.equal(camSys.isDragging, false);
        assert.equal(camSys.isPinching, false);
        camSys.handleTouchEnd({ touches: [] });
      }
    });

    it('should allow camera touch look when another finger is holding the flight stick (multi-touch)', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      const stickTarget = {
        closest: (selector) => selector.includes('.touch-stick-card') ? stickTarget : null
      };
      const canvasTarget = {
        closest: () => null
      };

      // Two touches: Touch 1 on flight stick, Touch 2 on canvas
      camSys.handleTouchStart({
        touches: [
          { identifier: 501, clientX: 800, clientY: 350, target: stickTarget },
          { identifier: 502, clientX: 300, clientY: 200, target: canvasTarget }
        ],
        cancelable: true,
        preventDefault: () => {}
      });

      // CameraSystem should isolate the non-UI touch (identifier 502)
      assert.strictEqual(camSys.activeTouchId, 502, 'Camera should track the canvas touch identifier');
      assert.strictEqual(camSys.isDragging, true);
      assert.strictEqual(camSys.isPinching, false);

      const initialYaw = camSys.lookYaw;

      // Finger 2 drags to the right (clientX: 400)
      camSys.handleTouchMove({
        touches: [
          { identifier: 501, clientX: 820, clientY: 360, target: stickTarget },
          { identifier: 502, clientX: 400, clientY: 200, target: canvasTarget }
        ],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.ok(camSys.lookYaw > initialYaw, 'lookYaw should grab scenery right with multi-touch camera finger');

      // Finger 2 lifts up while stick touch 501 remains
      camSys.handleTouchEnd({
        touches: [
          { identifier: 501, clientX: 820, clientY: 360, target: stickTarget }
        ]
      });

      assert.strictEqual(camSys.activeTouchId, null);
      assert.strictEqual(camSys.isDragging, false);
    });

    it('should perform two-finger optical pinch-to-zoom in CHASE mode', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.CHASE);

      const canvasTarget = { closest: () => null };

      // Initial chase distance is 55.0
      assert.strictEqual(camSys.chaseDistance, 55.0);

      // Two fingers touch down 100px apart: (300, 200) and (400, 200)
      camSys.handleTouchStart({
        touches: [
          { identifier: 601, clientX: 300, clientY: 200, target: canvasTarget },
          { identifier: 602, clientX: 400, clientY: 200, target: canvasTarget }
        ],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.strictEqual(camSys.isPinching, true);
      assert.strictEqual(camSys.isDragging, false);
      assert.strictEqual(camSys.activeTouchId, null);
      assert.strictEqual(Math.round(camSys.pinchDistance), 100);

      // Pinch out (spread fingers apart to 180px -> deltaDist = +80px) -> zooms closer
      camSys.handleTouchMove({
        touches: [
          { identifier: 601, clientX: 260, clientY: 200, target: canvasTarget },
          { identifier: 602, clientX: 440, clientY: 200, target: canvasTarget }
        ],
        cancelable: true,
        preventDefault: () => {}
      });

      assert.equal(camSys.chaseDistance, 55.0);
      assert.ok(camSys.opticalZoom > 1, 'pinch spread magnifies without moving the eye');

      // Pinch end
      camSys.handleTouchEnd({
        touches: []
      });

      assert.strictEqual(camSys.isPinching, false);
    });

    it('should reset camera look orientation on double tap within 350ms', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT);

      let resetCount = 0;
      camSys.onResetLook = () => { resetCount++; };

      // Mutate look angles
      camSys.lookYaw = 0.85;
      camSys.lookPitch = 0.35;

      const canvasTarget = { closest: () => null };

      // First tap at (400, 300) without drag
      camSys.handleTouchStart({
        touches: [{ identifier: 701, clientX: 400, clientY: 300, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });
      camSys.handleTouchEnd({ touches: [] });

      assert.strictEqual(camSys.lookYaw, 0.85);

      // Second tap within 100ms at same spot (402, 301)
      camSys.handleTouchStart({
        touches: [{ identifier: 702, clientX: 402, clientY: 301, target: canvasTarget }],
        cancelable: true,
        preventDefault: () => {}
      });

      // Should have triggered resetLook() and onResetLook callback
      assert.strictEqual(camSys.lookYaw, 0, 'lookYaw should be reset to 0');
      assert.strictEqual(camSys.lookPitch, -0.25, 'lookPitch should be reset to -0.25');
      assert.strictEqual(resetCount, 1, 'onResetLook callback should be fired');
      assert.strictEqual(camSys.isDragging, false);
    });
  });

  describe('User Manual Look Override Protection (유저 시선 변경 시 자동 개입 차단)', () => {
    it('should initialize userLookOverridden as false', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      assert.strictEqual(camSys.userLookOverridden, false);
    });

    it('should set userLookOverridden to true on mouse drag and pinch zoom', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);

      assert.strictEqual(camSys.userLookOverridden, false);
      camSys.applyMouseDelta(15, -10);
      assert.strictEqual(camSys.userLookOverridden, true);

      camSys.resetLook();
      assert.strictEqual(camSys.userLookOverridden, false);

      camSys.applyPinchZoom(25);
      assert.strictEqual(camSys.userLookOverridden, true);
    });

    it('should prevent automated setMode calls while userLookOverridden is true', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT, true);

      // User adjusts cockpit gaze
      camSys.applyMouseDelta(100, 50);
      assert.strictEqual(camSys.userLookOverridden, true);
      const savedYaw = camSys.lookYaw;
      const savedPitch = camSys.lookPitch;

      // Automated camera change (e.g. from scenario timer) without isUserAction
      const switched = camSys.setMode(CameraSystem.MODES.CHASE);
      assert.strictEqual(switched, false, 'automated setMode should be blocked');
      assert.strictEqual(camSys.mode, CameraSystem.MODES.COCKPIT, 'camera mode should remain COCKPIT');
      assert.strictEqual(camSys.lookYaw, savedYaw, 'lookYaw should NOT be reset');
      assert.strictEqual(camSys.lookPitch, savedPitch, 'lookPitch should NOT be reset');
    });

    it('should prevent showTemporaryView cuts while userLookOverridden is true', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT, true);

      camSys.applyMouseDelta(50, 0);
      assert.strictEqual(camSys.userLookOverridden, true);

      // Automated cinematic cut (e.g. takeoff liftoff or gear transit)
      camSys.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
      assert.strictEqual(camSys.mode, CameraSystem.MODES.COCKPIT, 'temporary view should not activate');
      assert.strictEqual(camSys.temporaryViewTimer, 0, 'temporary timer should not start');
    });

    it('should pause DRONE continuous orbit auto-rotation while userLookOverridden is true', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.DRONE, true);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 100, 0);

      // 1. Without override, drone continuously orbits
      const initialAngle = camSys.droneOrbitAngle;
      camSys.update(0.1, aircraft);
      assert.ok(camSys.droneOrbitAngle > initialAngle, 'drone orbit should advance normally');

      // 2. User manually rotates/adjusts drone view
      camSys.applyMouseDelta(60, 0);
      assert.strictEqual(camSys.userLookOverridden, true);
      const angleAfterUserDrag = camSys.droneOrbitAngle;

      // 3. Subsequent frame updates should pause auto-rotation
      camSys.update(0.1, aircraft);
      camSys.update(0.1, aircraft);
      assert.strictEqual(camSys.droneOrbitAngle, angleAfterUserDrag, 'drone orbit auto-rotation should pause');
    });

    it('should suppress cursor tracking drift while userLookOverridden is true', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT, true);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 100, 0);

      camSys.applyMouseDelta(80, -30);
      assert.strictEqual(camSys.userLookOverridden, true);

      // Set non-zero target cursor tracking
      camSys.setCursorPosition(1900, 100, 1920, 1080);
      camSys.update(0.1, aircraft);

      assert.strictEqual(camSys.cursorNormX, 0, 'cursor tracking offset X should remain 0');
      assert.strictEqual(camSys.cursorNormY, 0, 'cursor tracking offset Y should remain 0');
    });

    it('should clear userLookOverridden and allow mode changes on user cycleMode() or explicit setMode(m, true)', () => {
      const camera = new THREE.PerspectiveCamera();
      const camSys = new CameraSystem(camera, mockDom);
      camSys.setMode(CameraSystem.MODES.COCKPIT, true);

      // 1. User manual drag
      camSys.applyMouseDelta(100, 50);
      assert.strictEqual(camSys.userLookOverridden, true);

      // 2. User presses CAM button / 'C' key -> cycleMode()
      const nextModeName = camSys.cycleMode();
      assert.strictEqual(camSys.userLookOverridden, false, 'cycleMode should clear userLookOverridden');
      assert.strictEqual(camSys.mode, CameraSystem.MODES.HUD);
      assert.equal(nextModeName, 'HUD');
      camSys.cycleMode();
      assert.strictEqual(camSys.mode, CameraSystem.MODES.CHASE);

      // 3. User drags in CHASE mode
      camSys.applyMouseDelta(50, 50);
      assert.strictEqual(camSys.userLookOverridden, true);

      // 4. User explicitly clicks a camera view or preset -> setMode(m, true)
      const switched = camSys.setMode(CameraSystem.MODES.WING, true);
      assert.strictEqual(switched, true);
      assert.strictEqual(camSys.userLookOverridden, false);
      assert.strictEqual(camSys.mode, CameraSystem.MODES.WING);

      // 5. User double taps or resets view -> resetLook()
      camSys.applyMouseDelta(30, 30);
      assert.strictEqual(camSys.userLookOverridden, true);
      camSys.resetLook();
      assert.strictEqual(camSys.userLookOverridden, false);
    });
  });
});

