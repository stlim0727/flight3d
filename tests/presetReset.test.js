import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { createPilotMissionSimulation } from './helpers/pilotMissionFlight.js';

test('fresh ordinary presets clear cached damage even after the global crash flag was cleared', () => {
  for (const aircraftId of ['B738', 'C172', 'F16']) {
    const sim = createPilotMissionSimulation({ aircraftId });
    for (const preset of ['runway', 'approach', 'cruise']) {
      sim.isCrashed = false;
      sim.aircraft.damaged = true;
      sim.aircraft.resetCrashVisuals = function() { this.damaged = false; };
      sim.aero.separation = 0.9;
      sim.physicsAccumulator = 0.05;
      sim.controls.setVirtualInput('elevator', 1);
      sim.setPreset(preset);
      assert.equal(sim.aircraft.damaged, false, `${aircraftId}/${preset}`);
      assert.equal(sim.isCrashed, false);
      assert.equal(sim.aero.separation, 0);
      assert.equal(sim.physicsAccumulator, 0);
      assert.equal(sim.controls.virtualElevator, null);
      assert.equal(sim.engines.failed.some(Boolean), false);
    }
  }
});

test('valley preset sets safe aloft coordinates and zero velocity', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'F16' });
  sim.activeAirport = 'valley';
  sim.isCrashed = true;
  sim.aircraft.damaged = true;
  sim.aircraft.resetCrashVisuals = function() { this.damaged = false; };
  sim.setPreset('valley');
  assert.equal(sim.isCrashed, false);
  assert.equal(sim.aircraft.damaged, false);
  assert.ok(sim.position.y >= 2200);
  assert.equal(sim.linearVelocity.length(), 0);
  assert.equal(sim.gear.gearState, 0);
});

test('preset reset and clearCrashState reset telemetry pilot physiology state', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'F16' });
  sim.telemetry.pilot = {
    isGLOC: true,
    consciousness: 0.0,
    blackout: 1.0,
    gZ: 8.0,
  };
  sim.clearCrashState();
  assert.equal(sim.telemetry.pilot.isGLOC, false);
  assert.equal(sim.telemetry.pilot.consciousness, 1.0);

  sim.telemetry.pilot = { isGLOC: true, consciousness: 0.0 };
  sim.setPreset('runway');
  assert.equal(sim.telemetry.pilot.isGLOC, false);
  assert.equal(sim.telemetry.pilot.consciousness, 1.0);
});

test('scenario preset reset restores default CHASE mode and clears residual look tilt when user has not selected a mode', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'B738' });
  const camera = new THREE.PerspectiveCamera();
  sim.camera = camera;
  sim.cameraSystem = new CameraSystem(camera, null);
  sim.cameraSystem.loadAircraftConfig(sim.currentAircraftConfig);

  // Simulate an automated demo cut leaving camera in GEAR mode with dragged look angles
  sim.cameraSystem.setMode(CameraSystem.MODES.GEAR); // automated (userModeSelected is false)
  sim.cameraSystem.chasePitch = 0.45;
  sim.cameraSystem.lookPitch = 0.35;
  sim.cameraSystem.lookYaw = 0.5;
  sim.cameraSystem.showTemporaryView(CameraSystem.MODES.WING, 5);

  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.WING); // temporary view
  assert.equal(sim.cameraSystem.userModeSelected, false);

  // Spawn an airborne scenario (approach)
  sim.setPreset('approach');

  // Should revert to default CHASE mode, clear temporary cuts and reset look offsets
  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.CHASE);
  assert.equal(sim.cameraSystem.temporaryViewTimer, 0);
  assert.equal(sim.cameraSystem.savedMode, null);
  assert.equal(sim.cameraSystem.chasePitch, 0);
  assert.equal(sim.cameraSystem.lookYaw, 0);
  assert.equal(sim.cameraSystem.userLookOverridden, false);
});

test('scenario preset reset preserves user-selected camera mode while clearing pan/tilt offsets', () => {
  const sim = createPilotMissionSimulation({ aircraftId: 'B738' });
  const camera = new THREE.PerspectiveCamera();
  sim.camera = camera;
  sim.cameraSystem = new CameraSystem(camera, null);
  sim.cameraSystem.loadAircraftConfig(sim.currentAircraftConfig);

  // User explicitly selects COCKPIT view
  sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT, true);
  sim.cameraSystem.lookPitch = 0.4;
  sim.cameraSystem.lookYaw = -0.3;

  assert.equal(sim.cameraSystem.userModeSelected, true);

  // Spawn cruise scenario
  sim.setPreset('cruise');

  // Mode should remain COCKPIT, but lookYaw should reset to forward and lookPitch to baseline
  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.COCKPIT);
  assert.equal(sim.cameraSystem.lookYaw, 0);
  assert.equal(sim.cameraSystem.lookPitch, sim.cameraSystem.aircraftLookPitch);
  assert.equal(sim.cameraSystem.userLookOverridden, false);
});

test('snapToTarget in CHASE mode immediately updates camera position and look direction', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, null);
  const mesh = new THREE.Object3D();
  mesh.position.set(200, 500, -300);
  mesh.updateMatrixWorld(true);

  system.setMode(CameraSystem.MODES.CHASE);
  system.snapToTarget(mesh);

  assert.ok(camera.position.distanceTo(mesh.position) > 10, 'camera should be placed away from mesh');
  assert.equal(system.chaseTargetInitialized, true);
  assert.ok(Math.abs(camera.position.z - (mesh.position.z + system.chaseDistance)) < 5);
});
