import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => () => ({ addColorStop: noop })
  });
  globalThis.document = {
    createElement: () => ({
      getContext: () => mockCtx,
      width: 64,
      height: 64
    }),
    getElementById: () => ({
      style: {},
      textContent: '',
      addEventListener: noop,
      classList: { add: noop, remove: noop, toggle: noop }
    })
  };
  globalThis.window = {
    addEventListener: noop,
    innerWidth: 1920,
    innerHeight: 1080
  };
}

import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';

describe('Drone Orbit View & Demo Pre/Post-Flight Integration', () => {
  describe('CameraSystem (DRONE Orbit Mode)', () => {
    it('should position camera slightly above aircraft and look at aircraft center', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.15, 0); // Runway elevation
      aircraft.updateMatrixWorld(true);

      camSystem.setMode(CameraSystem.MODES.DRONE);
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.DRONE);
      assert.strictEqual(camSystem.getModeName(), 'DRONE (ORBIT VIEW)');

      camSystem.update(0.016, aircraft, { onGround: true });

      // In DRONE mode, camera should be elevated above aircraft (Y > 14.15 + 5.0)
      assert.ok(camera.position.y > 14.15 + 5.0, `Camera Y (${camera.position.y}) should be well above aircraft`);
      // Distance in horizontal XZ plane should approximate droneDistance (~38m)
      const horizontalDist = Math.sqrt(
        Math.pow(camera.position.x - aircraft.position.x, 2) +
        Math.pow(camera.position.z - aircraft.position.z, 2)
      );
      assert.ok(horizontalDist > 30.0 && horizontalDist < 45.0, `Horizontal distance (${horizontalDist}) should match drone radius`);
    });

    it('should continuously orbit around aircraft over time', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.15, 0);
      aircraft.updateMatrixWorld(true);

      camSystem.setMode(CameraSystem.MODES.DRONE);
      camSystem.resetDroneOrbit(0);
      assert.strictEqual(camSystem.droneOrbitAngle, 0);

      // Initial update
      camSystem.update(0.016, aircraft, { onGround: true });
      const initialAngle = camSystem.droneOrbitAngle;

      // Step 5 seconds forward
      camSystem.update(5.0, aircraft, { onGround: true });
      assert.ok(camSystem.droneOrbitAngle > initialAngle + 1.0, 'Drone orbit angle should increase over time');
    });

    it('should correctly snapToTarget in DRONE mode', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(100, 50, -200);
      aircraft.updateMatrixWorld(true);

      camSystem.setMode(CameraSystem.MODES.DRONE);
      camSystem.snapToTarget(aircraft);

      assert.ok(camera.position.y > aircraft.position.y, 'Camera Y should be above aircraft upon snap');
      const dist = camera.position.distanceTo(aircraft.position);
      assert.ok(dist > 30.0 && dist < 50.0, 'Camera distance upon snap should be close to drone radius');
    });

    it('should reset framing (distance, height) and initialization flag in resetDroneOrbit', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      camSystem.setMode(CameraSystem.MODES.DRONE);
      // Simulate user custom zoom and elevation
      camSystem.droneDistance = 20.0;
      camSystem.droneHeight = 5.0;
      camSystem.droneOrbitAngle = 4.2;

      // Calling resetDroneOrbit should restore standard framing
      camSystem.resetDroneOrbit(1.8, 38.0, 11.5);
      assert.strictEqual(camSystem.droneOrbitAngle, 1.8);
      assert.strictEqual(camSystem.droneDistance, 38.0);
      assert.strictEqual(camSystem.droneHeight, 11.5);
      assert.strictEqual(camSystem.droneInitialized, false);
    });

    it('should reset droneInitialized when temporary view restores DRONE mode to snap instantly without lerp lag', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const camSystem = new CameraSystem(camera, mockDom);

      const aircraft = new THREE.Object3D();
      aircraft.position.set(0, 14.15, 0);
      aircraft.updateMatrixWorld(true);

      // Start in DRONE mode and update once
      camSystem.setMode(CameraSystem.MODES.DRONE);
      camSystem.update(0.016, aircraft, { onGround: true });
      assert.strictEqual(camSystem.droneInitialized, true);

      // Trigger temporary GEAR view (e.g. liftoff or gear transit)
      camSystem.showTemporaryView(CameraSystem.MODES.GEAR, 3.0);
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.GEAR);

      // Move aircraft far ahead (simulating takeoff roll / flight during 3.0 seconds)
      aircraft.position.set(500, 150, 0);
      aircraft.updateMatrixWorld(true);

      // Expire temporary view
      camSystem.update(3.1, aircraft, { onGround: false });
      assert.strictEqual(camSystem.mode, CameraSystem.MODES.DRONE);

      // Camera should immediately snap near the aircraft (500, 150, 0), NOT dragging from origin
      const distToAircraft = camera.position.distanceTo(aircraft.position);
      assert.ok(distToAircraft < 50.0, `Camera should be close to aircraft (${distToAircraft}m), not lagging at origin`);
    });
  });

  describe('DemoFlightDirector (Pre-flight & Post-flight Drone Orbit)', () => {
    function createMockSimulator() {
      const camera = new THREE.PerspectiveCamera();
      const mockDom = { addEventListener: () => {} };
      const cameraSystem = new CameraSystem(camera, mockDom);

      const controls = {
        throttle: 0,
        elevator: 0,
        aileron: 0,
        rudder: 0,
        brakes: 0,
        virtualInputs: {},
        setVirtualInput(k, v) { this.virtualInputs[k] = v; },
        clearVirtualInputs() { this.virtualInputs = {}; }
      };

      const engines = new EngineModel();

      const gear = new LandingGear();

      const aero = new Aerodynamics();

      const sky = {
        timeOfDay: 12,
        setTimeOfDay(t) { this.timeOfDay = t; },
        getSunDirection: () => new THREE.Vector3(0, 1, 0)
      };

      const water = {
        setSunDirection: () => {}
      };

      return {
        cameraSystem,
        controls,
        engines,
        gear,
        aero,
        sky,
        water,
        position: new THREE.Vector3(-1350, 14.15, 0),
        linearVelocity: new THREE.Vector3(0, 0, 0),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        telemetry: {
          iasKnots: 0,
          altitudeFt: 14,
          radioAltFt: 0,
          pitchDeg: 0,
          rollDeg: 0,
          headingDeg: 90,
          onGround: true,
          gearState: 1.0,
          isTransit: false
        },
        setPreset(preset, isDemo) {},
        showToast(msg) {}
      };
    }

    it('should start demo in PREFLIGHT_ORBIT stage with DRONE camera mode and brakes held', () => {
      const sim = createMockSimulator();
      const director = new DemoFlightDirector(sim);

      director.start();
      assert.strictEqual(director.isActive, true);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.PREFLIGHT_ORBIT);
      assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.DRONE);
      assert.strictEqual(sim.controls.virtualInputs['brakes'], 1.0);
      assert.strictEqual(sim.controls.virtualInputs['throttle'], 0.0);
      assert.strictEqual(sim.aero.flapsIndex, 2); // Flaps 5
    });

    it('should transition from PREFLIGHT_ORBIT to TAKEOFF_ROLL and COCKPIT mode after 6 seconds', () => {
      const sim = createMockSimulator();
      const director = new DemoFlightDirector(sim);

      director.start();
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.PREFLIGHT_ORBIT);

      // Step 3 seconds: should stay in PREFLIGHT_ORBIT
      director.update(3.0);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.PREFLIGHT_ORBIT);

      // Step another 3.1 seconds (total 6.1s): should transition to TAKEOFF_ROLL
      director.update(3.1);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.TAKEOFF_ROLL);
      assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.COCKPIT);
      assert.strictEqual(sim.controls.virtualInputs['throttle'], 1.0);
      assert.strictEqual(sim.controls.virtualInputs['brakes'], 0.0);
    });

    it('should transition to POSTFLIGHT_ORBIT with DRONE mode upon safe touchdown rollout stop', () => {
      const sim = createMockSimulator();
      const director = new DemoFlightDirector(sim);

      director.start();
      // Fast-forward to TOUCHDOWN_ROLLOUT
      director.setStage(DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT);
      assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.GEAR);

      // Simulate a genuine stop: every wheel on the pavement and the airframe
      // still, held for two seconds.
      for (const contact of sim.gear.contacts) contact.isGrounded = true;
      sim.telemetry.iasKnots = 2.0;
      director.update(1.0);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT,
        'a single still frame is not a stop');
      director.update(1.0);

      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.POSTFLIGHT_ORBIT);
      assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.DRONE);
      assert.strictEqual(sim.controls.virtualInputs['brakes'], 1.0);
      assert.strictEqual(sim.controls.virtualInputs['throttle'], 0.0);

      // After 7 seconds in POSTFLIGHT_ORBIT, should complete and handover control
      director.update(7.1);
      assert.strictEqual(director.isActive, false);
      assert.strictEqual(director.currentStage, DemoFlightDirector.STAGES.IDLE);
    });

    it('should allow closing, opening, and toggling demo banner UI without stopping demo', () => {
      const sim = createMockSimulator();
      const director = new DemoFlightDirector(sim);

      const mockBanner = { style: { display: 'none' } };
      const mockOpenBtn = { style: { display: 'none' } };
      const mockTitle = { textContent: '' };
      const mockDesc = { textContent: '' };
      const mockPillText = { textContent: '' };

      director.bannerEl = mockBanner;
      director.openBtn = mockOpenBtn;
      director.titleEl = mockTitle;
      director.descEl = mockDesc;
      director.pillTextEl = mockPillText;

      // Start demo
      director.start();
      assert.strictEqual(director.isActive, true);
      assert.strictEqual(director.isBannerMinimized, false);
      assert.strictEqual(mockBanner.style.display, 'flex');
      assert.strictEqual(mockOpenBtn.style.display, 'none');

      // Close / minimize banner
      director.closeBanner();
      assert.strictEqual(director.isActive, true, 'Demo should remain active when banner is closed');
      assert.strictEqual(director.isBannerMinimized, true);
      assert.strictEqual(mockBanner.style.display, 'none');
      assert.strictEqual(mockOpenBtn.style.display, 'inline-flex');

      // Update banner should update title, desc, and pill text
      director.updateBanner('🛫 [2/8] 활주로 이륙 활주', 'TOGA 가속');
      assert.strictEqual(mockTitle.textContent, '🛫 [2/8] 활주로 이륙 활주');
      assert.strictEqual(mockPillText.textContent, '🎬 AUTO DEMO [2/8] [안내 열기 ▾]');

      // Reopen banner
      director.openBanner();
      assert.strictEqual(director.isBannerMinimized, false);
      assert.strictEqual(mockBanner.style.display, 'flex');
      assert.strictEqual(mockOpenBtn.style.display, 'none');

      // Toggle banner
      director.toggleBanner();
      assert.strictEqual(director.isBannerMinimized, true);
      assert.strictEqual(mockBanner.style.display, 'none');
      assert.strictEqual(mockOpenBtn.style.display, 'inline-flex');

      director.toggleBanner();
      assert.strictEqual(director.isBannerMinimized, false);
      assert.strictEqual(mockBanner.style.display, 'flex');

      // Stopping demo should hide both banner and open button
      director.stop();
      assert.strictEqual(director.isActive, false);
      assert.strictEqual(director.isBannerMinimized, false);
      assert.strictEqual(mockBanner.style.display, 'none');
      assert.strictEqual(mockOpenBtn.style.display, 'none');
    });
  });
});
