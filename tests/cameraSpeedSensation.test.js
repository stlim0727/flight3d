import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

function createMockAircraft() {
  const mesh = new THREE.Group();
  mesh.position.set(0, 100, 0);
  mesh.quaternion.set(0, 0, 0, 1);
  return mesh;
}

describe('CameraSystem Physical Speed Sensation & Dynamics', () => {
  it('should initialize speed sensation state variables with zero defaults', () => {
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);

    assert.equal(cam.speedFov, 0, 'initial speedFov should be 0');
    assert.equal(cam.chaseSpeedLag, 0, 'initial chaseSpeedLag should be 0');
    assert.equal(cam.vibrationOffset.length(), 0, 'initial vibrationOffset should be 0');
    assert.equal(cam.chaseVibration.length(), 0, 'initial chaseVibration should be 0');
  });

  it('should expand optical flow FOV smoothly as airspeed increases in CHASE mode', () => {
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.CHASE);
    const aircraft = createMockAircraft();

    // At rest (0 knots): FOV should remain at base 54°
    cam.update(0.1, aircraft, { iasKnots: 0, groundSpeedKnots: 0, onGround: false });
    const atRestFov = cam.applyBaseFov(54);
    assert.ok(Math.abs(atRestFov - 54) < 0.05, `at rest FOV should be ~54°, got ${atRestFov}`);

    // High speed flight (360 knots): FOV should expand towards ~60.5° (+6.5°)
    for (let i = 0; i < 60; i++) {
      cam.update(0.05, aircraft, { iasKnots: 360, groundSpeedKnots: 360, onGround: false });
    }
    assert.ok(cam.speedFov > 5.5 && cam.speedFov <= 6.6, `speedFov should converge near +6.5°, got ${cam.speedFov}`);
    const highSpeedFov = cam.applyBaseFov(54);
    assert.ok(highSpeedFov > 59.5 && highSpeedFov < 61.0, `zoomed base FOV should be ~60.5°, got ${highSpeedFov}`);
  });

  it('should apply subtle FOV expansion in COCKPIT mode to preserve instrument readability', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.COCKPIT);
    const aircraft = createMockAircraft();

    for (let i = 0; i < 60; i++) {
      cam.update(0.05, aircraft, { iasKnots: 360, groundSpeedKnots: 360, onGround: false });
    }
    assert.ok(cam.speedFov > 3.0 && cam.speedFov <= 3.6, `cockpit speedFov should cap around +3.5°, got ${cam.speedFov}`);
    const cockpitFov = cam.applyBaseFov(60);
    assert.ok(cockpitFov > 63.0 && cockpitFov < 64.0, `cockpit base FOV should expand subtly to ~63.5°, got ${cockpitFov}`);
  });

  it('should NOT expand speed FOV in fixed-vantage TOWER or DRONE views', () => {
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    const aircraft = createMockAircraft();

    cam.setMode(CameraSystem.MODES.TOWER);
    for (let i = 0; i < 30; i++) {
      cam.update(0.05, aircraft, { iasKnots: 360, groundSpeedKnots: 360, onGround: false });
    }
    assert.equal(cam.speedFov, 0, 'tower view should have 0 speed FOV expansion');

    cam.setMode(CameraSystem.MODES.DRONE);
    for (let i = 0; i < 30; i++) {
      cam.update(0.05, aircraft, { iasKnots: 360, groundSpeedKnots: 360, onGround: false });
    }
    assert.equal(cam.speedFov, 0, 'drone view should have 0 speed FOV expansion');
  });

  it('should increase chase camera trailing distance with speed (inertial lag)', () => {
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.CHASE);
    const aircraft = createMockAircraft();

    // At rest: lag is 0
    cam.update(0.1, aircraft, { iasKnots: 0, onGround: false });
    assert.equal(cam.chaseSpeedLag, 0);

    // High-speed cruise: lag increases smoothly towards ~5.5m
    for (let i = 0; i < 60; i++) {
      cam.update(0.05, aircraft, { iasKnots: 360, onGround: false });
    }
    assert.ok(cam.chaseSpeedLag > 4.5 && cam.chaseSpeedLag <= 5.6, `chaseSpeedLag should be ~5.5m, got ${cam.chaseSpeedLag}`);

    // Slow down: lag returns towards 0
    for (let i = 0; i < 60; i++) {
      cam.update(0.05, aircraft, { iasKnots: 0, onGround: false });
    }
    assert.ok(cam.chaseSpeedLag < 0.2, `chaseSpeedLag should relax to ~0, got ${cam.chaseSpeedLag}`);
  });

  it('should generate runway roll high-frequency vibration during high-speed ground roll', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.COCKPIT);
    const aircraft = createMockAircraft();

    // Low speed taxi (5 knots): no runway rumble
    cam.update(0.05, aircraft, { onGround: true, groundSpeedKnots: 5 });
    assert.equal(cam.vibrationOffset.length(), 0, 'low taxi speed should not shake');

    // Takeoff roll (130 knots): high-frequency vibration generated
    cam.update(0.05, aircraft, { onGround: true, groundSpeedKnots: 130 });
    assert.ok(cam.vibrationOffset.length() > 0.0005, 'takeoff roll should produce physical runway rumble');
    assert.ok(Math.abs(cam.chaseVibration.y) > 0.005, 'exterior camera should have subtle runway roll tremor');
  });

  it('should generate aerodynamic buffeting at high IAS and with spoilers deployed', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.COCKPIT);
    const aircraft = createMockAircraft();

    // Gentle cruise (180 knots, clean): no aerodynamic buffeting
    cam.update(0.05, aircraft, { onGround: false, iasKnots: 180, spoilers: 0 });
    assert.equal(cam.vibrationOffset.length(), 0, 'clean mid-speed cruise should be vibration free');

    // High speed cruise (320 knots): aerodynamic jitter occurs across oscillation cycles
    let maxHighSpeedVibe = 0;
    for (let i = 0; i < 15; i++) {
      cam.update(0.016, aircraft, { onGround: false, iasKnots: 320, spoilers: 0 });
      maxHighSpeedVibe = Math.max(maxHighSpeedVibe, cam.vibrationOffset.length());
    }
    assert.ok(maxHighSpeedVibe > 0.0003, `high IAS should trigger aerodynamic airframe jitter, got max ${maxHighSpeedVibe}`);

    // Spoiler deployment at speed: turbulence buffet occurs
    let maxSpoilerVibe = 0;
    for (let i = 0; i < 15; i++) {
      cam.update(0.016, aircraft, { onGround: false, iasKnots: 220, spoilers: 0.8 });
      maxSpoilerVibe = Math.max(maxSpoilerVibe, cam.vibrationOffset.length());
    }
    assert.ok(maxSpoilerVibe > 0.0003, `spoiler extension should trigger turbulence buffet, got max ${maxSpoilerVibe}`);
  });

  it('should stop speed sensation and cockpit buffet while playback is parked', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.COCKPIT);
    const aircraft = createMockAircraft();
    const stalledHighSpeed = { onGround: false, iasKnots: 360, groundSpeedKnots: 360,
      isStalled: true, isPreStall: true, buffetVibration: 1, gForce: 2 };

    for (let i = 0; i < 30; i++) cam.update(0.05, aircraft, stalledHighSpeed);
    assert.ok(cam.speedFov > 3.0, 'the moving replay expands the cockpit FOV');
    assert.ok(cam.vibrationOffset.length() > 0, 'the moving replay shakes the cockpit');

    cam.setMotionFrozen(true);
    const frozenFov = cam.speedFov;
    assert.equal(cam.vibrationOffset.length(), 0, 'freezing clears the current shake');
    assert.equal(cam.chaseVibration.length(), 0);
    for (let i = 0; i < 30; i++) cam.update(0.05, aircraft, stalledHighSpeed);
    assert.equal(cam.speedFov, frozenFov, 'the parked frame keeps its FOV without drifting');
    assert.equal(cam.vibrationOffset.length(), 0, 'a frozen state cannot keep vibrating the cockpit');

    cam.setMotionFrozen(false);
    for (let i = 0; i < 30; i++) cam.update(0.05, aircraft, stalledHighSpeed);
    assert.ok(cam.vibrationOffset.length() > 0, 'resuming playback restarts the motion');
  });

  it('should reset all speed sensation state variables on resetLook()', () => {
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.1, 1000);
    const cam = new CameraSystem(camera, null);
    cam.setMode(CameraSystem.MODES.CHASE);
    const aircraft = createMockAircraft();

    for (let i = 0; i < 30; i++) {
      cam.update(0.05, aircraft, { onGround: true, groundSpeedKnots: 140, iasKnots: 300 });
    }
    assert.ok(cam.speedFov > 0);
    assert.ok(cam.chaseSpeedLag > 0);

    cam.resetLook();
    assert.equal(cam.speedFov, 0, 'speedFov should reset to 0');
    assert.equal(cam.chaseSpeedLag, 0, 'chaseSpeedLag should reset to 0');
    assert.equal(cam.vibrationOffset.length(), 0, 'vibrationOffset should reset to 0');
    assert.equal(cam.chaseVibration.length(), 0, 'chaseVibration should reset to 0');
  });
});
